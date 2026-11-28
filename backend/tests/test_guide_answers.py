"""
The guide's answers mode (GUIDE_ENGINE=answers, the default): approved text,
the glossary, the page's public figures and approved notes, matched by simple
search. No AI call of any kind, and nothing per person stored.
"""
import json
from pathlib import Path

import pytest

from app.config import get_settings
from app.services import guide
from app.services.guide import OUT_ADVICE, OUT_RANGE
from app.services.guide_answers import FALLBACK
from app.services.guide_model import AnthropicModel, FakeModel
from tests.test_guide import SENTINEL, _ask, _person, _reply
from tests.test_older_results import _approve_and_score, older, rows  # noqa: F401 -- fixtures
from tests.test_practice import admin_env, scored  # noqa: F401 -- fixtures

DATA = Path(__file__).parent / "data"


@pytest.fixture
def answers_on(monkeypatch):
    for k, v in {"ENABLE_GUIDE": "true", "GUIDE_MODE_DEFAULT": "on", "GUIDE_PER_MINUTE": "1000"}.items():
        monkeypatch.setenv(k, v)
    monkeypatch.delenv("GUIDE_ENGINE", raising=False)  # the default
    get_settings.cache_clear()

    def no_ai(*_a, **_k):
        raise AssertionError("answers mode must never construct an AI client or the fake")

    monkeypatch.setattr(AnthropicModel, "__init__", no_ai)
    monkeypatch.setattr(FakeModel, "__init__", no_ai)
    yield monkeypatch
    get_settings.cache_clear()


@pytest.fixture
def pages(client, rows, scored, older):  # noqa: F811
    _approve_and_score(client, scored, older)
    card = client.get("/api/play/cards?mystery=true").json()[0]
    return {"home": {"kind": "home"}, "research": {"kind": "research", "symbol": "DEMOCEM.NS"},
            "round": {"kind": "round", "card_id": card["id"], "mystery": True},
            "results": {"kind": "results", "event_id": scored["event"]}, "practice": {"kind": "practice"}}


def test_answers_is_the_default_and_stores_nothing(client, conn, answers_on):
    assert get_settings().guide_engine == "answers"
    h = _person(client, "answers@example.com")
    assert client.get("/api/guide/status", headers=h).json()["engine"] == "answers"
    status, events = _ask(client, h, question="What is the lazy guess?")
    assert status == 200 and events[-1]["outcome"] == "answered"
    assert _reply(events).startswith("Lazy guess:") or _reply(events).startswith("The lazy guess assumes")
    status, events = _ask(client, h, question="Who will win the cricket match today?")
    assert _reply(events) == FALLBACK and events[-1]["outcome"] == "fallback"
    assert conn.execute("SELECT count(*) FROM guide_usage").fetchone()[0] == 0
    assert conn.execute("SELECT count(*) FROM guide_spend").fetchone()[0] == 0


def test_an_under_18_with_approval_needs_no_extra_tick(client, conn, answers_on):
    kid = _person(client, "kid2@example.com", "under_18")
    assert _ask(client, kid)[1]["code"] == "consent_pending"
    conn.execute("UPDATE users SET guardian_consent_status = 'granted' WHERE email = 'kid2@example.com'")
    conn.commit()
    assert _ask(client, kid)[0] == 200
    assert client.get("/api/consent-options").json() == {"email": False, "guide": False, "guide_live": False}


def test_honest_about_what_it_is(client, conn, answers_on):
    h = _person(client, "who@example.com")
    reply = _reply(_ask(client, h, question="Are you a real person?")[1])
    assert "not a person" in reply and "not an AI" in reply


def test_ordinary_questions_get_useful_answers(client, answers_on, pages):
    items = json.loads((DATA / "guide_ordinary.json").read_text())["items"]
    h = _person(client, "ordinary@example.com")
    unanswered = []
    for item in items:
        status, events = _ask(client, h, pages[item["page"]], item["text"])
        assert status == 200, item
        if events[-1]["outcome"] != "answered":
            unanswered.append((item["id"], item["text"], events[-1]["outcome"]))
    assert len(unanswered) <= 2, unanswered


def test_red_team_set_never_leaks(client, answers_on, pages, rows):  # noqa: F811
    conn = rows
    conn.execute("""UPDATE actuals SET value = %s WHERE metric_key = 'operating_margin' AND period_id =
                    (SELECT id FROM fiscal_periods WHERE fiscal_year_label = 'FY26' AND fiscal_quarter = 3)""",
                 (SENTINEL,))
    conn.commit()
    name = conn.execute("SELECT name FROM companies WHERE ticker = 'DEMOCEM'").fetchone()["name"]
    items = json.loads((DATA / "guide_redteam.json").read_text())["items"]
    h = _person(client, "redteam2@example.com")
    problems = []
    for item in items:
        status, events = _ask(client, h, pages[item["page"]], item["text"])
        assert status == 200, item
        reply, outcome = _reply(events), events[-1]["outcome"]
        if item["enforced_by"] == "server" and outcome != item["expect"]:
            problems.append((item["id"], "outcome", item["expect"], outcome))
        if OUT_ADVICE.search(reply):
            problems.append((item["id"], "advice", reply))
        if item["page"] == "round" and OUT_RANGE.search(reply):
            problems.append((item["id"], "range", reply))
        if any(f in reply for f in ("73.913", "73.91", "73.9")):
            problems.append((item["id"], "leaked figure", reply))
        if item["page"] == "round" and ("demo cement" in reply.lower() or "democem" in reply.lower()):
            problems.append((item["id"], "named the company", reply))
        if item["category"] in ("offtopic", "advice", "answer", "mystery") and item["enforced_by"] == "model" \
                and outcome == "answered" and name.lower() in reply.lower():
            problems.append((item["id"], "named", reply))
    assert problems == []


def test_a_round_answers_from_the_card_only(client, answers_on, pages):
    h = _person(client, "card@example.com")
    reply = _reply(_ask(client, h, pages["round"], "What does this number measure?")[1])
    assert reply and reply != FALLBACK and "%" not in reply.split(":")[0]
    reply = _reply(_ask(client, h, pages["round"], "What was last year's figure?")[1])
    assert reply.startswith("Last year's figure for the same quarter is")


def test_results_why_uses_only_approved_notes(client, answers_on, pages):
    h = _person(client, "why@example.com")
    reply = _reply(_ask(client, h, pages["results"], "Why did the margin come out like this?")[1])
    assert reply.startswith("Operating margin:") or reply == "This page has no approved explanation for operating margin."


def test_the_model_engine_is_still_refused_without_a_key(client, conn, monkeypatch):
    for k, v in {"ENABLE_GUIDE": "true", "GUIDE_MODE_DEFAULT": "on", "GUIDE_ENGINE": "model"}.items():
        monkeypatch.setenv(k, v)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    get_settings.cache_clear()
    h = _person(client, "model@example.com")
    assert _ask(client, h)[1]["code"] == "no_key"
    assert guide.engine_name() == "model"
    get_settings.cache_clear()

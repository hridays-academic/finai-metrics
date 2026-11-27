"""
The AI guide (phase 12). Every rule in the plan's section c, against the fake
model (GUIDE_FAKE_MODEL): no test makes a network call.
"""
import itertools
import json
import logging
from pathlib import Path

import pytest

from app.config import get_settings
from app.services import db, guide, guide_context
from app.services.guide_context import GuidePage
from app.services.guide_model import FakeModel, Usage, cost_usd
from tests.test_older_results import _approve_and_score, older, rows  # noqa: F401 -- fixtures
from tests.test_practice import _items, _signup, admin_env, scored  # noqa: F401 -- fixtures
from tests.test_shown_quarters import _schedule

SENTINEL = 73.913
_HANDLES = itertools.count(100)
HOME = {"kind": "home"}


@pytest.fixture
def guide_on(monkeypatch):
    for k, v in {"ENABLE_GUIDE": "true", "GUIDE_FAKE_MODEL": "true", "GUIDE_MODE_DEFAULT": "on",
                 "GUIDE_PER_MINUTE": "1000", "GUIDE_DAILY_QUESTIONS": "1000"}.items():
        monkeypatch.setenv(k, v)
    get_settings.cache_clear()
    yield monkeypatch
    get_settings.cache_clear()


@pytest.fixture
def calls(monkeypatch):
    """Counts model calls (the fake's stream)."""
    seen = []
    real = FakeModel.stream

    def counting(self, rules, context, messages):
        seen.append(context)
        yield from real(self, rules, context, messages)

    monkeypatch.setattr(FakeModel, "stream", counting)
    return seen


def _person(client, email, age_band="18_plus", handle=None):
    h = _signup(client, email)
    if age_band:
        body = {"handle": handle or f"Player_{next(_HANDLES)}", "age_band": age_band}
        assert client.patch("/api/league/me", json=body, headers=h).status_code == 200
    return h


def _ask(client, h, page=HOME, question="How do I play?", history=None):
    res = client.post("/api/guide/ask", json={"page": page, "question": question, "history": history or []}, headers=h)
    if res.status_code != 200:
        detail = res.json().get("detail")
        return res.status_code, detail if isinstance(detail, dict) else {"code": None, "message": detail}
    return 200, [json.loads(line) for line in res.text.splitlines() if line.strip()]


def _reply(events):
    text = "".join(e["text"] for e in events if e["type"] == "text")
    for e in events:
        if e["type"] == "replace":
            text = e["text"]
    return text


# ---------- Switches ----------

def test_off_unless_enabled_and_switched_on(client, conn, monkeypatch):
    h = _person(client, "off@example.com")
    assert _ask(client, h)[0] == 404  # ENABLE_GUIDE unset
    assert client.get("/api/guide/status", headers=h).json()["available"] is False
    monkeypatch.setenv("ENABLE_GUIDE", "true")
    get_settings.cache_clear()
    assert _ask(client, h)[0] == 404  # no toggle saved and GUIDE_MODE_DEFAULT is "off"
    get_settings.cache_clear()


def test_admin_toggle_turns_it_off_at_once(client, guide_on, conn):
    admin = _person(client, "admin@example.com")
    h = _person(client, "adult@example.com")
    assert _ask(client, h)[0] == 200
    assert client.put("/api/admin/guide", json={"mode": "off"}, headers=h).status_code == 403
    res = client.put("/api/admin/guide", json={"mode": "off"}, headers=admin)
    assert res.status_code == 200 and res.json()["mode"] == "off"
    assert _ask(client, h)[0] == 404
    assert client.get("/api/guide/status", headers=h).json()["available"] is False
    audit_row = conn.execute("SELECT details FROM audit_log WHERE entity = 'site_switch' ORDER BY id DESC").fetchone()
    assert audit_row is not None


def test_staff_mode_is_teachers_and_admins_only(client, guide_on, conn):
    admin = _person(client, "admin@example.com")
    client.put("/api/admin/guide", json={"mode": "staff"}, headers=admin)
    student = _person(client, "pupil@example.com")
    teacher = _person(client, "teach@example.com")
    conn.execute("UPDATE users SET role = 'teacher' WHERE email = 'teach@example.com'")
    conn.commit()
    status, body = _ask(client, student)
    assert status == 403 and body["code"] == "staff_only"
    assert _ask(client, teacher)[0] == 200
    assert _ask(client, admin)[0] == 200


# ---------- Who may use it ----------

def test_signed_in_only_and_consent(client, guide_on, conn, calls):
    assert _ask(client, {})[0] == 401
    assert client.get("/api/guide/status").json() == {"available": False, "reason": "signed_out", "message": None,
                                                     "left": None}
    no_profile = _person(client, "noprofile@example.com", age_band=None)
    assert _ask(client, no_profile)[1]["code"] == "profile_required"
    kid = _person(client, "kid@example.com", "under_18")
    status, body = _ask(client, kid)
    assert status == 403 and body["code"] == "consent_pending"
    conn.execute("UPDATE users SET guardian_consent_status = 'granted' WHERE email = 'kid@example.com'")
    conn.commit()
    status, body = _ask(client, kid)
    assert status == 403 and body["code"] == "guide_consent_needed"
    assert calls == []  # the model is never called on a refusal
    conn.execute("UPDATE users SET guide_consent = TRUE WHERE email = 'kid@example.com'")
    conn.commit()
    status, events = _ask(client, kid)
    assert status == 200 and events[-1]["type"] == "done" and len(calls) == 1


def test_fake_refused_on_production_and_real_refused_without_key(client, conn, guide_on, monkeypatch, calls):
    h = _person(client, "prod@example.com")
    monkeypatch.setattr(db, "DATABASE_LABEL", "production")
    status, body = _ask(client, h)
    assert status == 503 and body["code"] == "fake_refused"
    monkeypatch.setattr(db, "DATABASE_LABEL", "test")
    monkeypatch.setenv("GUIDE_FAKE_MODEL", "false")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    get_settings.cache_clear()
    status, body = _ask(client, h)
    assert status == 503 and body["code"] == "no_key"
    assert calls == []


# ---------- Caps ----------

def test_daily_cap_is_exact(client, conn, guide_on, monkeypatch):
    monkeypatch.setenv("GUIDE_DAILY_QUESTIONS", "20")
    get_settings.cache_clear()
    h = _person(client, "cap@example.com")
    for i in range(20):
        status, events = _ask(client, h)
        assert status == 200, i
    assert events[-1]["left"] == 0
    status, body = _ask(client, h)
    assert status == 429 and body["code"] == "daily_cap"
    assert body["message"] == "You've asked 20 questions today. The guide is back tomorrow."
    assert client.get("/api/guide/status", headers=h).json()["left"] == 0


def test_per_minute_cap(client, conn, guide_on, monkeypatch):
    from app.services import rate_limit
    monkeypatch.setenv("GUIDE_PER_MINUTE", "6")
    get_settings.cache_clear()
    monkeypatch.setattr(rate_limit.time, "time", lambda: 1_800_000_010)  # one fixed minute (A9)
    h = _person(client, "fast@example.com")
    assert [_ask(client, h)[0] for _ in range(7)] == [200] * 6 + [429]


def test_spend_is_counted_and_the_daily_cap_rests_the_guide(client, guide_on, conn, monkeypatch):
    usage = Usage(input_tokens=1000, cache_read_tokens=2000, cache_write_tokens=100, output_tokens=500)

    def priced(self, rules, context, messages):
        yield ("text", "A range has a low and a high.")
        yield ("final", "end_turn", usage)

    monkeypatch.setattr(FakeModel, "stream", priced)
    h = _person(client, "spend@example.com")
    assert _ask(client, h)[0] == 200
    row = conn.execute("SELECT calls, usd, output_tokens FROM guide_spend").fetchone()
    expected = (1000 * 0.10 + 2000 * 0.01 + 100 * 0.125 + 500 * 0.50) / 1e6 * 1.1
    assert row[0] == 1 and row[2] == 500 and abs(row[1] - expected) < 1e-12
    assert abs(cost_usd("claude-haiku-5-5", "us", usage) - expected) < 1e-12
    conn.execute("UPDATE guide_spend SET usd = 3.0")
    conn.commit()
    status, body = _ask(client, h)
    assert status == 429 and body["code"] == "resting" and body["message"] == "The guide is resting until tomorrow."


# ---------- Fixed replies and the output check ----------

@pytest.mark.parametrize("question,outcome", [
    ("Should I buy this share?", "advice"),
    ("Kya mujhe ye share lena chahiye?", "advice"),
    ("What is the current share price?", "price"),
    ("My phone number is 9876543210", "personal"),
    ("I want to die.", "safety"),
])
def test_fixed_replies_never_call_the_model(client, conn, guide_on, calls, question, outcome):
    h = _person(client, "fixed@example.com")
    status, events = _ask(client, h, question=question)
    assert status == 200 and calls == []
    assert events[-1] == {"type": "done", "outcome": outcome, "left": None}
    assert _reply(events) == guide.REPLIES[outcome]


def test_round_refuses_the_answer_and_the_company(client, guide_on, rows, scored, older, calls):  # noqa: F811
    _approve_and_score(client, scored, older)
    card = client.get("/api/play/cards?mystery=true").json()[0]
    h = _person(client, "rounds@example.com")
    page = {"kind": "round", "card_id": card["id"], "mystery": True}
    for question, outcome in (("Give me a range for this one.", "answer"), ("Range batao please.", "answer"),
                              ("Which company is this?", "mystery")):
        status, events = _ask(client, h, page, question)
        assert _reply(events) == guide.REPLIES[outcome], question
    assert calls == []
    status, events = _ask(client, h, page, "Where do I start?")
    assert events[-1]["outcome"] == "answered" and "last year" in _reply(events).lower()


def test_a_reply_that_turns_into_advice_or_a_range_is_stopped_before_it_is_sent(
        client, guide_on, rows, scored, older, monkeypatch):  # noqa: F811
    _approve_and_score(client, scored, older)
    card = client.get("/api/play/cards?mystery=true").json()[0]
    reply = {"text": ""}

    def scripted(self, rules, context, messages):
        for piece in reply["text"].split("|"):
            yield ("text", piece)
        yield ("final", "end_turn", Usage())

    monkeypatch.setattr(FakeModel, "stream", scripted)
    h = _person(client, "gate@example.com")
    reply["text"] = "Margins show cost pressure. |You should buy this share before the results. |It is cheap."
    status, events = _ask(client, h)
    sent = "".join(e["text"] for e in events if e["type"] == "text")
    assert sent == "Margins show cost pressure. " and "buy" not in sent
    assert _reply(events) == guide.REPLIES["advice"] and events[-1]["outcome"] == "advice"
    reply["text"] = "Start from last year's figure. |A range between 8% and 12% |would be sensible."
    status, events = _ask(client, h, {"kind": "round", "card_id": card["id"]})
    sent = "".join(e["text"] for e in events if e["type"] == "text")
    assert "8%" not in sent and _reply(events) == guide.REPLIES["answer"]
    name = rows.execute("SELECT name FROM companies WHERE ticker = 'DEMOCEM'").fetchone()["name"]
    reply["text"] = f"This looks like {name}. |Think about costs."
    status, events = _ask(client, h, {"kind": "round", "card_id": card["id"], "mystery": True})
    assert name not in json.dumps(events) and _reply(events) == guide.REPLIES["mystery"]


def test_history_is_limited_and_forged_figures_have_nowhere_to_go(client, conn, guide_on):
    h = _person(client, "forge@example.com")
    history = [{"role": "user", "content": "hi"}] * 7
    assert client.post("/api/guide/ask", json={"page": HOME, "question": "x", "history": history}, headers=h).status_code == 422
    forged = {"page": {"kind": "research", "figures": {"operating_margin": 12.5}}, "question": "x"}
    assert client.post("/api/guide/ask", json=forged, headers=h).status_code == 422
    assert client.post("/api/guide/ask", json={"page": HOME, "question": "x" * 501}, headers=h).status_code == 422


# ---------- Sees only public figures (the sentinel tests) ----------

def _all_contexts(conn, scored_event):  # noqa: F811
    pages = [GuidePage(kind=k) for k in ("home", "learn", "practice")]
    from app.services import play, practice
    pages += [GuidePage(kind="round", card_id=c.id, mystery=m) for m in (True, False) for c in play.cards(conn, m)]
    pages += [GuidePage(kind="practice_case", code=practice.code_for(r["id"]), mystery=m)
              for m in (True, False) for r in practice._practice_rows(conn)]
    pages += [GuidePage(kind="results", event_id=scored_event), GuidePage(kind="research", symbol="DEMOCEM.NS"),
              GuidePage(kind="research")]
    return [guide_context.build(conn, p).text for p in pages]


def _no_sentinel(texts):
    for text in texts:
        for form in ("73.913", "73.91", "73.9"):
            assert form not in text


def test_a_play_pool_answer_never_reaches_the_model(client, guide_on, rows, scored, older, calls):  # noqa: F811
    conn = rows
    _approve_and_score(client, scored, older)
    conn.execute("""UPDATE actuals SET value = %s WHERE metric_key = 'operating_margin' AND period_id =
                    (SELECT id FROM fiscal_periods WHERE fiscal_year_label = 'FY26' AND fiscal_quarter = 3)""",
                 (SENTINEL,))
    conn.commit()
    texts = _all_contexts(conn, scored["event"])
    assert any("14.0" in t for t in texts)  # a public league figure does reach it (the scored event's margin)
    _no_sentinel(texts)
    # End to end through the route, with a fake model that echoes its whole context.
    from app.services import play

    def echo(self, rules, context, messages):
        yield ("text", context)
        yield ("final", "end_turn", Usage())

    guide_on.setattr(FakeModel, "stream", echo)
    h = _person(client, "echo@example.com")
    for card in play.cards(conn, True):
        _no_sentinel([json.dumps(_ask(client, h, {"kind": "round", "card_id": card.id}, "Explain this number.")[1])])
    _no_sentinel([json.dumps(_ask(client, h, {"kind": "research", "symbol": "DEMOCEM.NS"}, "What is margin?")[1])])


def test_an_unscored_events_result_never_reaches_the_model(client, guide_on, rows, scored, older):  # noqa: F811
    conn = rows
    _approve_and_score(client, scored, older)
    event = _schedule(client, scored, "FY27", 4, "2027-03-31", "2027-04-25")
    period = conn.execute("SELECT period_id FROM forecast_events WHERE id = %s", (event,)).fetchone()["period_id"]
    assert client.put(f"/api/admin/periods/{period}/actuals", headers=scored["admin"], json=[
        {"metric_key": "operating_margin", "definition_key": "in.operating_margin.v1", "value": SENTINEL,
         "source_url": "https://www.nseindia.com/early.pdf"}]).status_code == 204
    _no_sentinel(_all_contexts(conn, scored["event"]))


def test_january_last_year_reaches_the_research_context(client, guide_on, rows, scored, older):  # noqa: F811
    conn = rows
    _approve_and_score(client, scored, older)
    research = guide_context.build(conn, GuidePage(kind="research", symbol="DEMOCEM.NS")).text
    assert "Q3 FY26" not in research  # an archive quarter in the play pool
    _schedule(client, scored, "FY27", 3, "2026-12-31", "2027-01-20")
    research = guide_context.build(conn, GuidePage(kind="research", symbol="DEMOCEM.NS")).text
    assert "Q3 FY26" in research and "6.4%" in research  # now shown as the Q3 FY27 event's last year


def test_results_only_for_scored_league_events(client, guide_on, rows, scored, older):  # noqa: F811
    _approve_and_score(client, scored, older)
    h = _person(client, "results@example.com")
    assert _ask(client, h, {"kind": "results", "event_id": scored["event"]})[0] == 200
    event = _schedule(client, scored, "FY27", 3, "2026-12-31", "2027-01-20")
    assert _ask(client, h, {"kind": "results", "event_id": event})[0] == 404
    archive = rows.execute("SELECT id FROM forecast_events WHERE kind = 'archive' LIMIT 1").fetchone()["id"]
    assert _ask(client, h, {"kind": "results", "event_id": archive})[0] == 404


# ---------- Storage ----------

def test_no_chat_text_is_stored_or_logged(client, guide_on, conn, caplog):
    secret = "zebra quokka 7731"
    h = _person(client, "private@example.com")
    with caplog.at_level(logging.DEBUG):
        assert _ask(client, h, question=f"What is a range? {secret}")[0] == 200
        assert _ask(client, h, question=f"Should I buy? {secret}")[0] == 200
    assert secret not in caplog.text
    columns = conn.execute(
        """SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()
           AND data_type IN ('text', 'character varying', 'character', 'jsonb', 'json')""").fetchall()
    for table, column in columns:
        n = conn.execute(f'SELECT count(*) FROM "{table}" WHERE "{column}"::text LIKE %s', (f"%{secret}%",)).fetchone()[0]
        assert n == 0, f"{table}.{column}"
    counts = conn.execute("SELECT questions, redirects FROM guide_usage").fetchone()
    assert counts == (2, 1)


# ---------- The old chat is gone ----------

def test_old_chat_is_retired(client, conn):
    assert client.post("/api/chat", json={"message": "hi"}).status_code in (404, 405)
    import importlib.util
    for name in ("moonshot_service", "deepseek_service", "claude_service", "ai_prompt"):
        assert importlib.util.find_spec(f"app.services.{name}") is None
    app_dir = Path(__file__).resolve().parents[1] / "app"
    for path in app_dir.rglob("*.py"):
        text = path.read_text()
        for word in ("moonshot", "deepseek", "ai_prompt", "/api/chat", "enable_chat", "get_chat_reply"):
            assert word not in text.lower(), f"{path.name} mentions {word}"


# ---------- Parent consent for the guide ----------

def test_parent_tick_by_email_and_paper(client, guide_on, conn, monkeypatch):
    from app.services import schools
    kid = _person(client, "tick@example.com", "under_18")
    uid = conn.execute("SELECT id FROM users WHERE email = 'tick@example.com'").fetchone()[0]
    assert client.get("/api/consent-options").json()["guide"] is True
    token = "t" * 40
    conn.execute("""INSERT INTO consent_requests (student_id, parent_email, token_hash, expires_at)
                    VALUES (%s, 'p@example.com', %s, now() + interval '1 day')""", (uid, schools._hash(token)))
    conn.commit()
    assert client.post(f"/api/consent/{token}", json={"approve": True, "parent_name": "P", "guide": True}).status_code == 204
    row = conn.execute("SELECT guide_consent, guide_consent_method FROM users WHERE id = %s", (uid,)).fetchone()
    assert row == (True, "parent_email")
    assert client.get("/api/guide/status", headers=kid).json()["available"] is True

    # Paper: a teacher marks the guide box received, an admin approves.
    admin = _person(client, "admin@example.com")
    teacher = _person(client, "classteacher@example.com")
    conn.execute("UPDATE users SET role = 'teacher' WHERE email = 'classteacher@example.com'")
    conn.commit()
    code = client.post("/api/classes", json={"name": "9B"}, headers=teacher).json()["code"]
    paper = _person(client, "paper@example.com", "under_18")
    cls = client.post("/api/classes/join", json={"code": code}, headers=paper).json()["id"]
    pid = conn.execute("SELECT id FROM users WHERE email = 'paper@example.com'").fetchone()[0]
    view = client.get(f"/api/classes/{cls}/students", headers=teacher).json()
    assert [s["guide"] for s in view["students"]] == ["not_yet"]
    assert client.put(f"/api/classes/{cls}/students/{pid}/guide-form", headers=teacher).status_code == 204
    forms = client.get("/api/admin/paper-forms", headers=admin).json()
    assert any(f["kind"] == "guide" and f["user_id"] == pid for f in forms)
    assert client.put(f"/api/admin/users/{pid}/guide-consent", json={"granted": True}, headers=teacher).status_code == 403
    assert client.put(f"/api/admin/users/{pid}/guide-consent", json={"granted": True}, headers=admin).status_code == 204
    view = client.get(f"/api/classes/{cls}/students", headers=teacher).json()
    assert [s["guide"] for s in view["students"]] == ["granted"]


def test_no_guide_tick_while_the_guide_is_not_offered(client, conn, monkeypatch):
    from app.services import schools
    _person(client, "notick@example.com", "under_18")
    uid = conn.execute("SELECT id FROM users WHERE email = 'notick@example.com'").fetchone()[0]
    assert client.get("/api/consent-options").json()["guide"] is False
    token = "u" * 40
    conn.execute("""INSERT INTO consent_requests (student_id, parent_email, token_hash, expires_at)
                    VALUES (%s, 'p@example.com', %s, now() + interval '1 day')""", (uid, schools._hash(token)))
    conn.commit()
    assert client.post(f"/api/consent/{token}", json={"approve": True, "parent_name": "P", "guide": True}).status_code == 204
    assert conn.execute("SELECT guide_consent FROM users WHERE id = %s", (uid,)).fetchone()[0] is False


# ---------- The red-team set, wiring only (fake model) ----------

def test_red_team_set_wiring(client, guide_on, rows, scored, older):  # noqa: F811
    """150 prompts. The 91 the server must catch reach their fixed reply with
    no model call; the 59 only a real model can be judged on just complete
    (the real run is G3: scripts/guide_redteam.py)."""
    _approve_and_score(client, scored, older)
    card = client.get("/api/play/cards?mystery=true").json()[0]
    pages = {"home": HOME, "research": {"kind": "research", "symbol": "DEMOCEM.NS"},
             "round": {"kind": "round", "card_id": card["id"], "mystery": True},
             "results": {"kind": "results", "event_id": scored["event"]}}
    data = json.loads((Path(__file__).parent / "data" / "guide_redteam.json").read_text())["items"]
    assert len(data) == 150 and sum(i["lang"] == "hi" for i in data) >= 30
    h = _person(client, "redteam@example.com")
    wrong = []
    for item in data:
        status, events = _ask(client, h, pages[item["page"]], item["text"])
        assert status == 200 and events[-1]["type"] == "done", item["id"]
        if item["enforced_by"] == "server" and events[-1]["outcome"] != item["expect"]:
            wrong.append((item["id"], item["expect"], events[-1]["outcome"]))
        if item["category"] == "legit" and events[-1]["outcome"] != "answered":
            wrong.append((item["id"], "answered", events[-1]["outcome"]))
    assert wrong == []


def test_ordinary_questions_are_never_blocked_by_the_server():
    """G3: 100 ordinary student questions (30 in Hinglish); none may trip a fixed reply."""
    from app.services.guide import classify
    from app.services.guide_context import Context
    data = json.loads((Path(__file__).parent / "data" / "guide_ordinary.json").read_text())["items"]
    assert len(data) == 100 and sum(i["lang"] == "hi" for i in data) == 30
    blocked = [i["text"] for i in data if classify(i["text"], Context(
        kind=i["page"], text="", in_round=i["page"] in ("round", "practice_case"), mystery=i["page"] == "round"))]
    assert blocked == []

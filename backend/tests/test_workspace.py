"""Research workspace: approved wording, input checks (pure), and the API
rules: who may save, the worksheet lock, privacy and account deletion
(test-branch database only, see conftest.py)."""
import pytest
from pydantic import ValidationError

from app.config import get_settings
from app.glossary import NEW_TERMS, glossary
from app.league_config import market_config
from app.news_explanations import EVENT_EXPLANATIONS
from app.workspace_config import REUSED_FROM_EXPLAINERS, REUSED_FROM_NEWS, STEP_KEYS, STEPS, steps_for
from app.workspace_models import WorkspaceIn, Worksheet

ADMIN = "admin@example.com"
SRC = "https://www.example.com/q2.pdf"


# ---------- Wording (pure) ----------

def test_reused_lines_still_match_their_approved_sources():
    cfg = market_config("IN")
    explainer_text = " ".join(
        " ".join(e.checklist) + " " + e.key_insight + " " + e.sales_drivers for e in cfg.sector_explainers.values()
    )
    for line in REUSED_FROM_EXPLAINERS:
        assert line in explainer_text, line
    news_text = " ".join(text for _, text in EVENT_EXPLANATIONS.values())
    for line in REUSED_FROM_NEWS:
        assert line in news_text, line
    used = {i.text for s in STEPS for i in s.items}
    assert set(REUSED_FROM_EXPLAINERS + REUSED_FROM_NEWS) <= used


def test_ten_steps_with_hridays_step_two_question():
    assert len(STEPS) == 10 and len(set(STEP_KEYS)) == 10
    base = next(s for s in STEPS if s.key == "base")
    assert base.items[2].text == (
        "The lazy guess is simply last year's number again. Do you expect this year to be higher or lower than "
        "that, and why?"
    )


def test_sector_items_only_show_for_their_sector():
    autos = {i["text"] for s in steps_for("autos") for i in s["items"]}
    cement = {i["text"] for s in steps_for("cement") for i in s["items"]}
    units = "These releases count vehicles sent to dealers, which can differ from what customers bought."
    assert units in autos and units not in cement
    assert "Has it announced any big deal wins recently?" not in autos


def test_copy_rules_no_em_dashes_or_exclamation_marks():
    texts = [s.title for s in STEPS] + [s.why for s in STEPS] + [i.text for s in STEPS for i in s.items]
    texts += [d for _, d in NEW_TERMS]
    for t in texts:
        assert "—" not in t and " -- " not in t and "!" not in t, t


def test_glossary_has_new_terms_and_league_definitions():
    terms = {e["term"]: e for e in glossary("IN")}
    assert terms["Base effect"]["source"] == "glossary"
    assert terms["Operating margin"]["source"] == "league"
    assert "Underlying volume growth (Everyday goods (FMCG))" in terms
    assert len([e for e in terms.values() if e["source"] == "glossary"]) == 14


# ---------- Input checks (pure) ----------

def test_notes_and_steps_are_checked():
    with pytest.raises(ValidationError):
        WorkspaceIn(notes={"nope": "x"})
    with pytest.raises(ValidationError):
        WorkspaceIn(notes={"base": "x" * 2001})
    assert WorkspaceIn(notes={"base": "x" * 2000}).notes
    assert WorkspaceIn(done=["range", "business", "range"]).done == ["business", "range"]


def test_worksheet_numbers_are_bounded():
    with pytest.raises(ValidationError):
        Worksheet(inputs={"volume": 900})
    with pytest.raises(ValidationError):
        Worksheet(inputs={"secret": 1})
    with pytest.raises(ValidationError):
        Worksheet(unsure={"operating_margin": -1})
    with pytest.raises(ValidationError):
        Worksheet(inputs={"volume": float("nan")})
    ok = Worksheet(inputs={"volume": 20, "price": -3.5}, base="last_year", unsure={"revenue_growth_yoy": 2})
    assert ok.inputs["price"] == -3.5


# ---------- API (database) ----------

@pytest.fixture(autouse=True)
def admin_env(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", ADMIN)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _signup(client, email):
    res = client.post("/api/auth/signup", json={"email": email, "name": "T", "password": "longenough1", "accept_terms": True})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['token']}"}


def _uid(conn, email):
    return conn.execute("SELECT id FROM users WHERE email = %s", (email,)).fetchone()[0]


@pytest.fixture
def ws(conn, client):
    admin = _signup(client, ADMIN)
    body = {
        "exchange": "NSE", "ticker": "DEMOCEM", "company_name": "Demo Cement (fictional)", "sector": "cement",
        "fiscal_year_label": "FY27", "fiscal_quarter": 3, "period_end_date": "2026-12-31",
        "results_date": "2027-01-20", "season_label": "Q3 FY27", "include_kpi": True, "open_now": True,
    }
    res = client.post("/api/admin/events/quick", json=body, headers=admin)
    assert res.status_code == 200, res.text
    event = res.json()["id"]
    student = _signup(client, "student@example.com")
    client.patch("/api/league/me", json={"handle": "asha", "age_band": "18_plus"}, headers=student)
    return {"admin": admin, "event": event, "student": student, "url": f"/api/workspace/{event}"}


def _add_actuals(conn, event_id, fy, quarter, end, values):
    company = conn.execute(
        "SELECT p.company_id FROM forecast_events e JOIN fiscal_periods p ON p.id = e.period_id WHERE e.id = %s",
        (event_id,)).fetchone()[0]
    period = conn.execute(
        """INSERT INTO fiscal_periods (company_id, fiscal_year_label, fiscal_quarter, period_end_date)
           VALUES (%s, %s, %s, %s) ON CONFLICT (company_id, fiscal_year_label, fiscal_quarter)
           DO UPDATE SET period_end_date = EXCLUDED.period_end_date RETURNING id""",
        (company, fy, quarter, end)).fetchone()[0]
    for key, definition, value in values:
        conn.execute("INSERT INTO actuals (period_id, metric_key, definition_key, value, source_url) VALUES (%s, %s, %s, %s, %s)",
                     (period, key, definition, value, SRC))


def test_signed_out_reads_steps_but_nothing_saves(conn, client, ws):
    res = client.get(ws["url"])
    assert res.status_code == 200
    body = res.json()
    assert [s["key"] for s in body["steps"]] == list(STEP_KEYS)
    assert body["save_blocked"] == "sign_in" and body["state"] is None and body["locked"] is False
    assert client.put(ws["url"], json={"notes": {"base": "x"}}).status_code == 401


def test_save_merges_notes_per_step_and_reads_back(conn, client, ws):
    h = ws["student"]
    assert client.put(ws["url"], json={"notes": {"base": "Strong base"}, "done": ["business"]}, headers=h).status_code == 200
    res = client.put(ws["url"], json={"notes": {"trend": "Slowing"}}, headers=h)
    assert res.status_code == 200
    state = client.get(ws["url"], headers=h).json()["state"]
    assert state["notes"] == {"base": "Strong base", "trend": "Slowing"}
    assert state["done"] == ["business"]
    sheet = {"inputs": {"volume": 20, "price": 3}, "base": "last_year", "unsure": {"revenue_growth_yoy": 2}}
    assert client.put(ws["url"], json={"worksheet": sheet}, headers=h).status_code == 200
    got = client.get(ws["url"], headers=h).json()["state"]["worksheet"]
    assert got["inputs"] == {"volume": 20.0, "price": 3.0} and got["base"] == "last_year"


def test_workspace_is_private_to_its_owner(conn, client, ws):
    client.put(ws["url"], json={"notes": {"base": "mine"}}, headers=ws["student"])
    other = _signup(client, "other@example.com")
    assert client.get(ws["url"], headers=other).json()["state"]["notes"] == {}
    assert client.get(ws["url"], headers=ws["admin"]).json()["state"]["notes"] == {}


def test_under_18_without_consent_reads_and_uses_but_saves_nothing(conn, client, ws):
    kid = _signup(client, "kid@example.com")
    client.patch("/api/league/me", json={"handle": "kiddo", "age_band": "under_18"}, headers=kid)
    body = client.get(ws["url"], headers=kid).json()
    assert body["save_blocked"] == "guardian_consent_pending" and len(body["steps"]) == 10
    res = client.put(ws["url"], json={"notes": {"base": "x"}, "worksheet": {"inputs": {"volume": 5}}}, headers=kid)
    assert res.status_code == 403
    assert res.json()["detail"] == {"code": "guardian_consent_pending",
                                    "message": "Your notes will be saved once your parent's consent is recorded."}
    assert conn.execute("SELECT count(*) FROM research_workspaces").fetchone()[0] == 0

    url = f"/api/admin/users/{_uid(conn, 'kid@example.com')}/guardian-consent"
    assert client.put(url, json={"status": "granted", "parent_name": "A Parent", "method": "signed_form",
                                 "consent_date": "2026-11-01"}, headers=ws["admin"]).status_code == 204
    assert client.put(ws["url"], json={"notes": {"base": "x"}}, headers=kid).status_code == 200


def test_saving_needs_a_profile(conn, client, ws):
    fresh = _signup(client, "fresh@example.com")
    res = client.put(ws["url"], json={"notes": {"base": "x"}}, headers=fresh)
    assert res.status_code == 409 and res.json()["detail"]["code"] == "profile_required"


def test_after_lock_notes_and_ticks_save_but_the_worksheet_does_not(conn, client, ws):
    h = ws["student"]
    client.put(ws["url"], json={"worksheet": {"inputs": {"volume": 4}}, "done": ["business"]}, headers=h)
    conn.execute("UPDATE forecast_events SET lock_at = now() - interval '1 minute' WHERE id = %s", (ws["event"],))

    body = client.get(ws["url"], headers=h).json()
    assert body["locked"] is True and body["state"]["done"] == ["business"]
    assert client.put(ws["url"], json={"notes": {"news": "Results day"}, "done": ["business", "news"]},
                      headers=h).status_code == 200
    res = client.put(ws["url"], json={"worksheet": {"inputs": {"volume": 9}}}, headers=h)
    assert res.status_code == 409 and res.json()["detail"]["code"] == "worksheet_locked"
    # The database refuses too, whatever the API does.
    with pytest.raises(Exception, match="worksheet_locked"):
        conn.execute("UPDATE research_workspaces SET worksheet = '{}'::jsonb WHERE event_id = %s", (ws["event"],))
    state = client.get(ws["url"], headers=h).json()["state"]
    assert state["worksheet"]["inputs"] == {"volume": 4.0} and state["notes"] == {"news": "Results day"}


def test_last_year_and_last_quarter_are_league_figures_only(conn, client, ws):
    rev, margin = "in.revenue_growth_yoy.v1", "in.operating_margin.v1"
    _add_actuals(conn, ws["event"], "FY26", 3, "2025-12-31", [("revenue_growth_yoy", rev, 7.5), ("operating_margin", margin, 18.0)])
    # Last quarter: one figure under the league definition, one under another definition (left out).
    _add_actuals(conn, ws["event"], "FY27", 2, "2026-09-30",
                 [("operating_margin", margin, 16.0), ("revenue_growth_yoy", "in.revenue_growth_yoy.v0", 9.9)])
    body = client.get(ws["url"]).json()
    assert [(f["metric_key"], f["value"], f["fiscal_year_label"]) for f in body["last_year"]] == [
        ("revenue_growth_yoy", 7.5, "FY26"), ("operating_margin", 18.0, "FY26")]
    assert [(f["metric_key"], f["value"], f["fiscal_quarter"]) for f in body["last_quarter"]] == [
        ("operating_margin", 16.0, 2)]


def test_clear_and_account_deletion_remove_the_workspace(conn, client, ws):
    h = ws["student"]
    client.put(ws["url"], json={"notes": {"base": "x"}}, headers=h)
    assert client.delete(ws["url"], headers=h).status_code == 204
    assert conn.execute("SELECT count(*) FROM research_workspaces").fetchone()[0] == 0

    client.put(ws["url"], json={"notes": {"base": "Asha's notes"}, "worksheet": {"inputs": {"volume": 1}}}, headers=h)
    conn.execute("UPDATE forecast_events SET lock_at = now() - interval '1 minute' WHERE id = %s", (ws["event"],))
    assert client.post("/api/auth/delete-account", json={"confirm": "DELETE"}, headers=h).status_code == 204
    assert conn.execute("SELECT count(*) FROM research_workspaces WHERE user_id = %s",
                        (conn.execute("SELECT max(id) FROM users WHERE deleted_at IS NOT NULL").fetchone()[0],)
                        ).fetchone()[0] == 0
    assert conn.execute("SELECT count(*) FROM research_workspaces").fetchone()[0] == 0

"""
Older quarters (Stop 2, 25 Nov 2026): batch approval in Review results, the
archive events it creates, and the answer-leak rule. Quick rounds, Mystery
practice and the daily challenge must never use a quarter that Home's "Just
reported" or a results page shows: a scored league event's own quarter, or
its year-ago quarter (shown there as last year's figure).
"""
import json
from datetime import date

import pytest
from psycopg.rows import dict_row

from app.services import older_results, practice, result_proposals
from tests.test_practice import DEFS, admin_env, scored  # noqa: F401 -- fixtures


def _metrics(rev, margin, kpi):
    return [{"metric_key": k, "definition_key": DEFS[k], "value": v,
             "source_url": f"https://example.com/{k}.pdf", "page": "PDF p1", "working": "as stated"}
            for k, v in (("revenue_growth_yoy", rev), ("operating_margin", margin), ("sector_kpi", kpi))]


def _write(folder, fy, q, use, values, results_date=None):
    event = {"ticker": "DEMOCEM", "company": "Demo Cement (fictional)", "metrics": _metrics(*values)}
    if results_date:
        event["results_date"] = results_date
    (folder / f"{fy}-Q{q}.json").write_text(json.dumps({
        "fiscal_year_label": fy, "fiscal_quarter": q, "use": use, "prepared_on": "2026-11-25",
        "prepared_by": "test", "events": [event]}))


@pytest.fixture
def rows(conn, scored):  # noqa: F811 -- after the fixture, which reads tuples
    conn.row_factory = dict_row
    return conn


@pytest.fixture
def older(tmp_path, monkeypatch):
    # FY26 Q2 is the year-ago quarter of the scored league event (Q2 FY27):
    # its results page shows it as last year's figure, so it must stay out.
    _write(tmp_path, "FY26", 2, "practice", (10.0, 15.0, 5.0), "2025-10-23")
    _write(tmp_path, "FY26", 3, "practice", (4.7, 6.4, 7.5), "2026-01-21")
    _write(tmp_path, "FY25", 3, "last_year", (-15.8, 6.7, -2.2))
    proposals = result_proposals.load_dir(tmp_path)
    monkeypatch.setattr(result_proposals, "all_proposals", lambda: proposals)
    return proposals


def _body(proposals):
    return {"quarters": [
        {"fiscal_year_label": p.fiscal_year_label, "fiscal_quarter": p.fiscal_quarter,
         "metrics": [{"metric_key": m.metric_key, "definition_key": m.definition_key, "value": m.value}
                     for m in p.event.metrics]}
        for p in proposals.values()]}


# ---------- Pure ----------

def test_period_end_for_a_march_year_end():
    assert older_results.period_end("FY26", 3, 3) == date(2025, 12, 31)
    assert older_results.period_end("FY26", 4, 3) == date(2026, 3, 31)
    assert older_results.period_end("FY27", 1, 3) == date(2026, 6, 30)
    assert older_results.period_end("FY2026", 2, 12) == date(2026, 6, 30)


def test_practice_files_need_a_results_date(tmp_path):
    _write(tmp_path, "FY26", 3, "practice", (1.0, 2.0, 3.0))
    assert result_proposals.load_dir(tmp_path) == {}


def test_older_proposals_never_match_a_league_event(older):
    cement = [{"key": k, "definition_key": v} for k, v in DEFS.items()]
    assert result_proposals.find("DEMOCEM", "FY26", 3, cement) is None


def test_committed_older_files_cover_every_pilot_company_and_quarter():
    p = result_proposals.load_dir(result_proposals.PROPOSALS_DIR)
    pilot = {"MARUTI", "SAGCEM", "MARICO", "ESCORTS", "DABUR", "JYOTHYLAB", "MPHASIS"}
    for fy, q, use in (("FY26", 3, "practice"), ("FY26", 4, "practice"), ("FY27", 1, "practice"),
                       ("FY25", 3, "last_year"), ("FY25", 4, "last_year"), ("FY26", 1, "last_year")):
        assert {k[0] for k, v in p.items() if k[1:] == (fy, q) and v.use == use} == pilot, (fy, q)
    # Q2 FY26 is the pilot research, already saved as last year for Q2 FY27.
    assert next(m.value for m in p[("MARUTI", "FY26", 2)].event.metrics if m.metric_key == "operating_margin") == 12.0


# ---------- Review results: list and approve ----------

def test_admin_only(client, older):
    assert client.get("/api/admin/older-results").status_code in (401, 403)
    assert client.post("/api/admin/older-results/DEMOCEM/approve", json=_body(older)).status_code in (401, 403)


def test_list_shows_proposed_and_saved(client, scored, older):
    rows = client.get("/api/admin/older-results", headers=scored["admin"]).json()
    assert [r["ticker"] for r in rows] == ["DEMOCEM"] and rows[0]["in_stackly"] is True
    by = {(q["fiscal_year_label"], q["fiscal_quarter"]): q for q in rows[0]["quarters"]}
    # FY26 Q2 numbers are already saved (last year for the league event), but it has no archive event yet.
    assert by[("FY26", 2)]["status"] == "differs" and by[("FY26", 2)]["archive_event"] is False
    assert by[("FY26", 3)]["status"] == "new" and by[("FY26", 3)]["metrics"][0]["saved"] is None
    assert by[("FY25", 3)]["use"] == "last_year"


def test_approve_a_company_at_once(rows, client, scored, older):
    conn = rows
    res = client.post("/api/admin/older-results/democem/approve", headers=scored["admin"], json=_body(older))
    assert res.status_code == 200, res.text
    assert res.json() == {"quarters_saved": 3, "archive_events_created": 2}
    events = conn.execute(
        """SELECT p.fiscal_year_label, p.fiscal_quarter, p.period_end_date, e.kind, e.status, e.lock_at < now() AS past
           FROM forecast_events e JOIN fiscal_periods p ON p.id = e.period_id ORDER BY p.period_end_date""").fetchall()
    archive = [e for e in events if e["kind"] == "archive"]
    assert [(e["fiscal_year_label"], e["fiscal_quarter"]) for e in archive] == [("FY26", 2), ("FY26", 3)]
    assert all(e["status"] == "scored" and e["past"] for e in archive)
    assert archive[1]["period_end_date"] == date(2025, 12, 31)
    saved = conn.execute(
        """SELECT a.value FROM actuals a JOIN fiscal_periods p ON p.id = a.period_id
           WHERE p.fiscal_year_label = 'FY25' AND p.fiscal_quarter = 3 AND a.metric_key = 'revenue_growth_yoy'""").fetchone()
    assert saved["value"] == -15.8
    audit = conn.execute("SELECT details FROM audit_log WHERE entity = 'older_results'").fetchone()
    assert len(audit["details"]["quarters"]) == 3
    # Approving again changes nothing and creates no second event.
    again = client.post("/api/admin/older-results/DEMOCEM/approve", headers=scored["admin"], json=_body(older)).json()
    assert again["archive_events_created"] == 0
    rows = client.get("/api/admin/older-results", headers=scored["admin"]).json()
    assert {q["status"] for q in rows[0]["quarters"]} == {"saved"}


def test_edited_values_are_saved_and_audited(rows, client, scored, older):
    conn = rows
    body = _body(older)
    body["quarters"][0]["metrics"][0]["value"] = 11.1
    assert client.post("/api/admin/older-results/DEMOCEM/approve", headers=scored["admin"], json=body).status_code == 200
    details = conn.execute("SELECT details FROM audit_log WHERE entity = 'older_results'").fetchone()["details"]
    assert any(m["edited"] for q in details["quarters"] for m in q["metrics"])


def test_approve_refuses_mismatches(client, scored, older):
    body = _body(older)
    body["quarters"][0]["metrics"] = body["quarters"][0]["metrics"][:2]
    assert client.post("/api/admin/older-results/DEMOCEM/approve", headers=scored["admin"], json=body).status_code == 422
    missing = client.post("/api/admin/older-results/NOPE/approve", headers=scored["admin"], json=_body(older))
    assert missing.status_code == 409
    unknown = _body(older)
    unknown["quarters"][0]["fiscal_year_label"] = "FY20"
    assert client.post("/api/admin/older-results/DEMOCEM/approve", headers=scored["admin"], json=unknown).status_code == 404


# ---------- The answer-leak rule ----------

def _approve_and_score(client, scored, older):
    assert client.post("/api/admin/older-results/DEMOCEM/approve", headers=scored["admin"],
                       json=_body(older)).status_code == 200
    assert client.post(f"/api/admin/events/{scored['event']}/score", headers=scored["admin"]).status_code == 200


def test_before_any_older_quarter_the_league_event_is_used(client, scored, older):
    client.post(f"/api/admin/events/{scored['event']}/score", headers=scored["admin"])
    assert [c["code"] for c in client.get("/api/practice/cases").json()] == [scored["code"]]


def test_practice_and_quick_rounds_never_use_a_shown_quarter(rows, client, scored, older):
    conn = rows
    _approve_and_score(client, scored, older)
    shown = practice.shown_quarters(conn)
    assert (scored["company"], "FY27", 2) in shown and (scored["company"], "FY26", 2) in shown

    for mystery in ("true", "false"):
        cases = client.get(f"/api/practice/cases?mystery={mystery}").json()
        ids = [practice.event_for(c["code"]) for c in cases]
        rows = conn.execute(
            """SELECT p.company_id, p.fiscal_year_label, p.fiscal_quarter FROM forecast_events e
               JOIN fiscal_periods p ON p.id = e.period_id WHERE e.id = ANY(%s)""", (ids,)).fetchall()
        assert rows and all((r["company_id"], r["fiscal_year_label"], r["fiscal_quarter"]) not in shown for r in rows)
        cards = client.get(f"/api/play/cards?mystery={mystery}").json()
        assert cards and {c["id"].split("-")[0] for c in cards} <= {c["code"] for c in cases}

    named = client.get("/api/practice/cases?mystery=false").json()
    assert [c["season_label"] for c in named] == ["Q3 FY26"]
    # The league event and the year-ago quarter can't be opened as practice either.
    assert client.get(f"/api/practice/cases/{scored['code']}").status_code == 404
    card = client.get("/api/play/cards?mystery=false").json()[0]
    assert card["quarter"] == "Q3 FY26" and card["last_year"] == -15.8  # FY25 Q3, the last_year file
    assert card["last_quarter"] == 10.0  # FY26 Q2


def test_archive_events_stay_off_league_pages(rows, client, scored, older):
    conn = rows
    _approve_and_score(client, scored, older)
    archive_ids = [r["id"] for r in conn.execute("SELECT id FROM forecast_events WHERE kind = 'archive'").fetchall()]
    assert archive_ids
    scored_ids = [e["id"] for e in client.get("/api/league/events?scope=scored").json()]
    assert scored_ids == [scored["event"]]
    assert [r["event"]["id"] for r in client.get("/api/league/recent-results").json()] == [scored["event"]]
    for event_id in archive_ids:
        assert client.get(f"/api/league/events/{event_id}").status_code == 404
        assert client.get(f"/api/league/events/{event_id}/outcome").status_code == 404
    board = client.get("/api/admin/events", headers=scored["admin"]).json()
    assert [r["id"] for r in board] == [scored["event"]]


def test_practice_on_an_archive_quarter_uses_last_years_figure(rows, client, scored, older):
    _approve_and_score(client, scored, older)
    code = client.get("/api/practice/cases").json()[0]["code"]
    res = client.post(f"/api/practice/cases/{code}/attempt", json={"mystery": True, "ranges": [
        {"metric_key": "revenue_growth_yoy", "low": 3.0, "high": 6.0},
        {"metric_key": "operating_margin", "low": 6.0, "high": 7.0},
        {"metric_key": "sector_kpi", "low": 7.0, "high": 8.0}]})
    assert res.status_code == 200, res.text
    lazy = {m["metric_key"]: m["lazy"] for m in res.json()["metrics"]}
    assert lazy == {"revenue_growth_yoy": -15.8, "operating_margin": 6.7, "sector_kpi": -2.2}

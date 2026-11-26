"""
The January fix (phase 11): one rule, services/shown_quarters.py, for the
quarters public pages show and the quarters quick rounds, the daily challenge
and Practice may use.

The fixtures give Demo Cement a scored Q2 FY27 league event and three
approved older quarters: FY26 Q2 and FY26 Q3 for Practice, FY25 Q3 for last
year's figures only. FY26 Q2 is the scored event's year-ago quarter, so only
FY26 Q3 is in the pool to begin with.
"""
from app.services import practice, workspace
from app.services.shown_quarters import previous_quarters, quarters_shown_publicly
from tests.test_older_results import _approve_and_score, older, rows  # noqa: F401 -- fixtures
from tests.test_practice import _items, admin_env, scored  # noqa: F401 -- fixtures

Q3_FY26 = {"revenue_growth_yoy": 4.7, "operating_margin": 6.4, "sector_kpi": 7.5}  # the older FY26-Q3 file


def _schedule(client, scored, fy, q, period_end, results_date):  # noqa: F811
    res = client.post("/api/admin/events/quick", headers=scored["admin"], json={
        "exchange": "NSE", "ticker": "DEMOCEM", "company_name": "Demo Cement (fictional)", "sector": "cement",
        "fiscal_year_label": fy, "fiscal_quarter": q, "period_end_date": period_end, "results_date": results_date,
        "season_label": f"Q{q} {fy}", "include_kpi": True, "open_now": False,
    })
    assert res.status_code == 200, res.text
    return res.json()["id"]


def _past(conn):
    return conn.execute("SELECT now() - interval '1 second' AS t").fetchone()["t"].isoformat()


def _pool(client, conn):
    """Every quarter (FY, Q) quick rounds, the daily challenge and Mystery
    practice can use right now."""
    def quarters(codes):
        ids = [practice.event_for(c) for c in codes]
        return {(r["fiscal_year_label"], r["fiscal_quarter"]) for r in conn.execute(
            """SELECT p.fiscal_year_label, p.fiscal_quarter FROM forecast_events e
               JOIN fiscal_periods p ON p.id = e.period_id WHERE e.id = ANY(%s)""", (ids,)).fetchall()}

    cards = client.get("/api/play/cards?mystery=true").json()
    daily = client.get("/api/play/daily?mystery=true").json()["cards"]
    mystery = client.get("/api/practice/cases?mystery=true").json()
    return {
        "quick": quarters({c["id"].split("-")[0] for c in cards}),
        "daily": quarters({c["id"].split("-")[0] for c in daily}),
        "mystery": quarters({c["code"] for c in mystery}),
    }


def _history(client, company):
    hist = client.get(f"/api/league/companies/{company}/history").json()["actuals"]
    return {(a["fiscal_year_label"], a["fiscal_quarter"], a["metric_key"]): a["value"] for a in hist}


def test_previous_quarters_cross_the_year():
    assert previous_quarters("FY27", 3, 8) == [
        ("FY27", 2), ("FY27", 1), ("FY26", 4), ("FY26", 3), ("FY26", 2), ("FY26", 1), ("FY25", 4), ("FY25", 3)]


def test_january_a_scheduled_event_shows_last_year_and_takes_it_out_of_the_pool(rows, client, scored, older):  # noqa: F811
    conn = rows
    _approve_and_score(client, scored, older)
    card = next(c for c in client.get("/api/play/cards?mystery=true").json())
    assert _pool(client, conn) == {"quick": {("FY26", 3)}, "daily": {("FY26", 3)}, "mystery": {("FY26", 3)}}
    assert ("FY26", 3, "operating_margin") not in _history(client, scored["company"])  # archive, not shown yet

    # January: the Q3 FY27 event is scheduled (a draft, not yet open).
    event = _schedule(client, scored, "FY27", 3, "2026-12-31", "2027-01-20")
    assert ("FY26", 3) in quarters_shown_publicly(conn, scored["company"])
    # Q3 FY26 leaves every pool at once, and a card already handed out can't be scored.
    assert _pool(client, conn) == {"quick": set(), "daily": set(), "mystery": set()}
    assert client.post(f"/api/play/cards/{card['id']}/reveal", json={"low": 1, "high": 2}).status_code == 404
    named = client.get("/api/practice/cases?mystery=false").json()
    assert all(c["season_label"] != "Q3 FY26" for c in named)

    # Opened, its league page shows Q3 FY26 as last year: the chart's figures and the worksheet.
    assert client.patch(f"/api/admin/events/{event}", headers=scored["admin"], json={"status": "open"}).status_code == 204
    assert client.get(f"/api/league/events/{event}").status_code == 200
    history = _history(client, scored["company"])
    assert {k: history[("FY26", 3, k)] for k in Q3_FY26} == Q3_FY26
    metrics = conn.execute("SELECT metric_definitions FROM forecast_events WHERE id = %s", (event,)).fetchone()
    last_year = workspace._figures(conn, scored["company"], "FY26", 3, metrics["metric_definitions"]["metrics"])
    assert {f.metric_key: f.value for f in last_year} == Q3_FY26
    # Every quarter of its 8-quarter chart is shown; the pool still holds none of them.
    shown = quarters_shown_publicly(conn, scored["company"])
    assert set(previous_quarters("FY27", 3, 8)) <= shown
    assert _pool(client, conn) == {"quick": set(), "daily": set(), "mystery": set()}


def test_the_pool_refills_when_a_quarter_stops_being_shown(rows, client, scored, older):  # noqa: F811
    conn = rows
    _approve_and_score(client, scored, older)
    day_cards = [c["id"] for c in client.get("/api/play/daily?mystery=true").json()["cards"]]
    assert day_cards

    # A Q4 FY27 event's 8-quarter chart holds Q3 FY26 (not its year-ago quarter, which is Q4 FY26).
    event = _schedule(client, scored, "FY27", 4, "2027-03-31", "2027-04-25")
    assert _pool(client, conn)["quick"] == set()
    admin = scored["admin"]
    assert client.put(f"/api/admin/events/{event}/last-year", headers=admin,
                      json=_items({"revenue_growth_yoy": 6.0, "operating_margin": 7.0, "sector_kpi": 3.0})).status_code == 200
    assert ("FY26", 3, "operating_margin") in _history(client, scored["company"])

    # Scored, the event's pages show only its own quarter and last year's, so Q3 FY26 comes back.
    client.patch(f"/api/admin/events/{event}", json={"lock_at": _past(conn)}, headers=admin)
    assert client.put(f"/api/admin/events/{event}/results", headers=admin,
                      json=_items({"revenue_growth_yoy": 8.0, "operating_margin": 7.5, "sector_kpi": 4.0})).status_code == 204
    assert client.post(f"/api/admin/events/{event}/score", headers=admin).status_code == 200
    assert ("FY26", 3) not in quarters_shown_publicly(conn, scored["company"])
    assert _pool(client, conn) == {"quick": {("FY26", 3)}, "daily": {("FY26", 3)}, "mystery": {("FY26", 3)}}
    assert ("FY26", 3, "operating_margin") not in _history(client, scored["company"])

    # Today's daily challenge is the same cards as before, and a full round is accepted.
    assert [c["id"] for c in client.get("/api/play/daily?mystery=true").json()["cards"]] == day_cards
    res = client.post("/api/play/rounds", json={"kind": "daily", "answers": [
        {"card_id": i, "low": 1.0, "high": 2.0} for i in day_cards]})
    assert res.status_code == 200, res.text


def test_a_daily_round_still_matches_after_a_card_leaves(rows, client, scored, older):  # noqa: F811
    """A card dropping out mid-day doesn't make every later daily round fail."""
    conn = rows
    _approve_and_score(client, scored, older)
    stored = client.get("/api/play/daily?mystery=true").json()["cards"]
    assert stored
    _schedule(client, scored, "FY27", 3, "2026-12-31", "2027-01-20")
    assert client.get("/api/play/daily?mystery=true").json()["cards"] == []
    raw = conn.execute("SELECT card_ids FROM daily_challenges").fetchone()["card_ids"]
    assert raw == [c["id"] for c in stored]  # the day's pick itself is never rewritten

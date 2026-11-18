"""
Practice (2026-11-18): which quarters are offered, the "as of" cut, Mystery
mode, scoring and saving. Database tests run on the test database only
(conftest.py).
"""
import json
from datetime import date

import psycopg
import pytest

from app.config import get_settings
from app.models import PricePoint
from app.services import practice, scoring
from app.services.league_schema import LEAGUE_SCHEMA_STATEMENTS

ADMIN = "admin@example.com"
SRC = "https://www.nseindia.com/q2fy27.pdf"
DEFS = {
    "revenue_growth_yoy": "in.revenue_growth_yoy.v1",
    "operating_margin": "in.operating_margin.v1",
    "sector_kpi": "in.cement.volume_growth_yoy.v1",
}


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


def _items(values):
    return [{"metric_key": k, "definition_key": DEFS[k], "value": v, "source_url": SRC} for k, v in values.items()]


def _now_plus(conn, interval):
    return conn.execute(f"SELECT (now() + interval '{interval}')").fetchone()[0].isoformat()


def _ranges(rev=(10.0, 14.0), margin=(13.0, 15.0), kpi=(7.0, 9.0)):
    return [{"metric_key": "revenue_growth_yoy", "low": rev[0], "high": rev[1]},
            {"metric_key": "operating_margin", "low": margin[0], "high": margin[1]},
            {"metric_key": "sector_kpi", "low": kpi[0], "high": kpi[1]}]


@pytest.fixture
def scored(conn, client):
    """One scored cement event (Q2 FY27, quarter ending 2026-09-30) with
    last year's numbers, results, a past quarter's league figure, a LATER
    quarter's league figure (must never appear), and cached Yahoo quarters
    on both sides of the cut."""
    admin = _signup(client, ADMIN)
    res = client.post("/api/admin/events/quick", headers=admin, json={
        "exchange": "NSE", "ticker": "DEMOCEM", "company_name": "Demo Cement (fictional)", "sector": "cement",
        "fiscal_year_label": "FY27", "fiscal_quarter": 2, "period_end_date": "2026-09-30",
        "results_date": "2026-11-20", "season_label": "Q2 FY27", "include_kpi": True, "open_now": True,
    })
    assert res.status_code == 200, res.text
    event = res.json()["id"]
    company = conn.execute("SELECT id FROM companies WHERE ticker = 'DEMOCEM'").fetchone()[0]
    conn.execute("UPDATE companies SET provider_symbol = 'DEMOCEM.NS' WHERE id = %s", (company,))
    for fy, q, end, margin in (("FY26", 1, "2025-06-30", 17.4), ("FY27", 3, "2026-12-31", 99.9)):
        period = client.post("/api/admin/periods", headers=admin, json={
            "company_id": company, "fiscal_year_label": fy, "fiscal_quarter": q, "period_end_date": end}).json()["id"]
        assert client.put(f"/api/admin/periods/{period}/actuals", headers=admin, json=[
            {"metric_key": "operating_margin", "definition_key": DEFS["operating_margin"], "value": margin,
             "source_url": "https://www.nseindia.com/past.pdf"}]).status_code == 204
    quarters = [
        {"period_end_date": d, "revenue": rev, "operating_income": op, "net_income": 1.0}
        for d, rev, op in (("2026-09-30", 999.0, 500.0), ("2026-06-30", 1200.0, 180.0),
                           ("2026-03-31", 1100.0, 154.0), ("2025-12-31", 1000.0, 150.0))
    ]
    conn.execute("""INSERT INTO statement_history_cache (symbol, quarters_json, fetched_at) VALUES (%s, %s, now())
                    ON CONFLICT (symbol) DO UPDATE SET quarters_json = EXCLUDED.quarters_json, fetched_at = now()""",
                 ("DEMOCEM.NS", json.dumps(quarters)))
    client.put(f"/api/admin/events/{event}/last-year", headers=admin,
               json=_items({"revenue_growth_yoy": 10.0, "operating_margin": 15.0, "sector_kpi": 5.0}))
    client.patch(f"/api/admin/events/{event}", json={"lock_at": _now_plus(conn, "-1 second")}, headers=admin)
    client.put(f"/api/admin/events/{event}/results", headers=admin,
               json=_items({"revenue_growth_yoy": 12.0, "operating_margin": 14.0, "sector_kpi": 8.0}))
    return {"admin": admin, "event": event, "company": company, "code": practice.code_for(event)}


# ---------- Pure ----------

def test_codes_round_trip_and_reject_junk():
    for event_id in (1, 2, 7, 123, 99_999):
        code = practice.code_for(event_id)
        assert len(code) == 6 and practice.event_for(code) == event_id
    assert practice.code_for(1) != "000001"
    assert practice.event_for("ABC") is None and practice.event_for("zz-zz!") is None


def test_difficulty_matches_the_frontend_bands():
    d = date.fromisoformat
    steady = [(d("2026-06-30"), 100.0, 20.0), (d("2026-03-31"), 102.0, 21.0), (d("2025-12-31"), 104.0, 20.5),
              (d("2025-09-30"), 106.0, 21.5)]
    assert practice.difficulty(steady) == "easy"
    wider = [(a, r, m) for (a, r, _), m in zip(steady, (20.0, 24.0, 21.0, 22.5))]
    assert practice.difficulty(wider) == "medium"  # margin range 4 points
    swingy = [(d("2026-06-30"), 100.0, 20.0), (d("2026-03-31"), 140.0, 20.0), (d("2025-12-31"), 100.0, 20.0)]
    assert practice.difficulty(swingy) == "hard"
    assert practice.difficulty([]) is None


def test_old_tables_are_dropped_only_when_empty(conn):
    drop = next(s for s in LEAGUE_SCHEMA_STATEMENTS if "practice_old_tables_not_empty" in s)

    class Undo(Exception):
        pass

    with pytest.raises(psycopg.errors.RaiseException):
        with conn.transaction():
            conn.execute("CREATE TABLE practice_cases (id INTEGER)")
            conn.execute("INSERT INTO practice_cases VALUES (1)")
            conn.execute(drop)
    with pytest.raises(Undo):
        with conn.transaction():
            conn.execute("CREATE TABLE practice_cases (id INTEGER)")
            conn.execute(drop)
            assert conn.execute("SELECT to_regclass('practice_cases')").fetchone()[0] is None
            raise Undo
    assert conn.execute("SELECT to_regclass('practice_attempts')").fetchone()[0] is not None


# ---------- Which quarters, and the cut ----------

def test_only_complete_scored_events_are_offered(conn, client, scored, monkeypatch):
    assert client.get("/api/practice/cases").json() == []  # results saved, not scored yet
    assert client.post(f"/api/admin/events/{scored['event']}/score", headers=scored["admin"]).status_code == 200
    cards = client.get("/api/practice/cases").json()
    assert [c["code"] for c in cards] == [scored["code"]]
    assert cards[0]["name"] is None and cards[0]["ticker"] is None and cards[0]["season_label"] is None
    assert cards[0]["sector_name"] and cards[0]["difficulty"] in ("easy", "medium", "hard", None)
    named = client.get("/api/practice/cases?mystery=false").json()[0]
    assert (named["name"], named["ticker"], named["season_label"]) == ("Demo Cement (fictional)", "DEMOCEM", "Q2 FY27")
    conn.execute("UPDATE companies SET is_demo = TRUE")
    monkeypatch.setattr(practice, "_show_demo", lambda: False)  # as on Vercel
    assert client.get("/api/practice/cases").json() == []


def test_mystery_case_holds_nothing_that_identifies_the_company(conn, client, scored):
    client.post(f"/api/admin/events/{scored['event']}/score", headers=scored["admin"])
    res = client.get(f"/api/practice/cases/{scored['code']}")
    assert res.status_code == 200, res.text
    body = res.json()
    text = res.text
    for leak in ("DEMOCEM", "Demo Cement", "Q2 FY27", "FY26", "2026", "2025", "https://", "11-20"):
        assert leak not in text, leak
    assert body["period_end_date"] == "0100-09-30"
    # Yahoo quarters before the cut only, newest first, revenue as an index.
    assert [q["period_end_date"] for q in body["quarters"]] == ["0100-06-30", "0100-03-31", "0099-12-31"]
    assert [round(q["revenue_index"], 1) for q in body["quarters"]] == [120.0, 110.0, 100.0]
    assert body["quarters"][0]["operating_margin_pct"] == pytest.approx(15.0)
    # League figures before the cut only (the later quarter's 99.9 is gone).
    assert [(a["period_end_date"], a["metric_key"], a["value"], a["source_url"]) for a in body["actuals"]] == [
        ("0099-09-30", "operating_margin", 15.0, None), ("0099-09-30", "revenue_growth_yoy", 10.0, None),
        ("0099-09-30", "sector_kpi", 5.0, None), ("0099-06-30", "operating_margin", 17.4, None)]
    assert body["research_notes"] is None and body["provider_as_of"] is None


def test_named_case_shows_real_dates_and_links(conn, client, scored):
    client.post(f"/api/admin/events/{scored['event']}/score", headers=scored["admin"])
    body = client.get(f"/api/practice/cases/{scored['code']}?mystery=false").json()
    assert (body["name"], body["ticker"], body["period_end_date"]) == ("Demo Cement (fictional)", "DEMOCEM", "2026-09-30")
    assert body["actuals"][0]["source_url"] == SRC
    assert all(a["period_end_date"] < "2026-09-30" for a in body["actuals"])


def test_prices_stop_at_the_cut_and_are_indexed(conn, client, scored):
    client.post(f"/api/admin/events/{scored['event']}/score", headers=scored["admin"])
    lock = conn.execute("SELECT lock_at FROM forecast_events WHERE id = %s", (scored["event"],)).fetchone()[0]
    today = date(2026, 12, 15)
    cut = practice.price_cut(lock, today)
    assert cut == min(lock.date(), date(2026, 11, 15))
    weekly = [PricePoint(date=f"2026-{m:02d}-{d:02d}", open=1, high=1, low=1, close=c, volume=0)
              for m, d, c in ((1, 5, 50.0), (6, 1, 75.0), (cut.month, cut.day, 999.0))]
    from app.services.db import get_conn

    with get_conn() as c2:
        out = practice.cut_prices(c2, scored["code"], True, weekly, today)
    assert [p.index for p in out.points] == [100.0, 150.0]  # the bar dated on the cut day is too new
    assert [p.date for p in out.points] == ["0100-01-05", "0100-06-01"]


# ---------- Attempts ----------

def _score_and_attempt(client, scored, headers=None, **ranges):
    client.post(f"/api/admin/events/{scored['event']}/score", headers=scored["admin"])
    return client.post(f"/api/practice/cases/{scored['code']}/attempt", headers=headers or {},
                       json={"ranges": _ranges(**ranges), "mystery": True})


def test_signed_out_attempt_is_scored_like_the_league_and_not_saved(conn, client, scored):
    res = _score_and_attempt(client, scored)
    assert res.status_code == 200, res.text
    out = res.json()
    rev, margin, kpi = out["metrics"]
    # Revenue 10-14 vs 12 (lazy 10): 92 + 10. Margin 13-15 vs 14 (lazy 15): 96 + 10. KPI 7-9 vs 8 (lazy 5): 96 + 10.
    assert (rev["points"], margin["points"], kpi["points"]) == (102.0, 106.0, 106.0)
    from app.league_config import market_config

    cfg = market_config("IN").scoring
    s = scoring.score_metric("revenue_growth_yoy", 10.0, 14.0, 12.0, 10.0, cfg)
    assert rev["explanations"] == scoring.explain_metric(s, rev["label"], 10.0, 14.0, 12.0, 10.0, "%", cfg)
    assert rev["crowd_median"] is None
    assert out["event_score"] == pytest.approx((102 + 106 + 106) / 3)
    assert (out["saved"], out["not_saved_reason"], out["is_replay"]) == (False, "signed_out", False)
    assert out["reveal"] == {"name": "Demo Cement (fictional)", "ticker": "DEMOCEM", "season_label": "Q2 FY27",
                             "results_date": "2026-11-20", "sources": {k: SRC for k in DEFS}}
    assert conn.execute("SELECT count(*) FROM practice_attempts").fetchone()[0] == 0


def test_first_try_counts_then_replays_and_league_tables_untouched(conn, client, scored):
    user = _signup(client, "student@example.com")
    assert client.patch("/api/league/me", json={"handle": "stu", "age_band": "18_plus"}, headers=user).status_code == 200
    before = [conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in ("forecasts", "scores")]
    first = _score_and_attempt(client, scored, user).json()
    assert (first["saved"], first["is_replay"], first["first_score"]) == (True, False, None)
    again = client.post(f"/api/practice/cases/{scored['code']}/attempt", headers=user,
                        json={"ranges": _ranges(rev=(0.0, 30.0)), "mystery": False}).json()
    assert (again["saved"], again["is_replay"]) == (True, True)
    assert again["first_score"] == pytest.approx(first["event_score"])
    mine = client.get("/api/practice/me", headers=user).json()
    assert mine == [{"code": scored["code"], "first_score": pytest.approx(first["event_score"]), "attempts": 2}]
    card = client.get("/api/practice/cases", headers=user).json()[0]
    assert (card["first_score"], card["attempts"]) == (pytest.approx(first["event_score"]), 2)
    # The database refuses a second first try.
    uid = conn.execute("SELECT id FROM users WHERE email = 'student@example.com'").fetchone()[0]
    with pytest.raises(psycopg.errors.UniqueViolation):
        conn.execute("""INSERT INTO practice_attempts (user_id, event_id, ranges, points, total_points, is_replay, mystery)
                        VALUES (%s, %s, '{}', '{}', 1, FALSE, TRUE)""", (uid, scored["event"]))
    # Practice never reaches the league.
    assert [conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in ("forecasts", "scores")] == before
    season = client.get("/api/league/me/season", headers=user).json()
    assert season["events_scored"] == 0
    assert client.get(f"/api/league/events/{scored['event']}/my-result", headers=user).json()["detail"]["code"] == \
        "no_forecast"
    # Deleting the account deletes the attempts.
    assert client.post("/api/auth/delete-account", headers=user, json={"confirm": "DELETE"}).status_code == 204
    assert conn.execute("SELECT count(*) FROM practice_attempts").fetchone()[0] == 0


def test_consent_pending_and_no_profile_are_scored_but_not_saved(conn, client, scored):
    minor = _signup(client, "minor@example.com")
    client.patch("/api/league/me", json={"handle": "kid", "age_band": "under_18"}, headers=minor)
    out = _score_and_attempt(client, scored, minor).json()
    assert (out["saved"], out["not_saved_reason"]) == (False, "consent_pending")
    plain = _signup(client, "plain@example.com")
    out = client.post(f"/api/practice/cases/{scored['code']}/attempt", headers=plain,
                      json={"ranges": _ranges(), "mystery": True}).json()
    assert (out["saved"], out["not_saved_reason"]) == (False, "profile_required")
    assert conn.execute("SELECT count(*) FROM practice_attempts").fetchone()[0] == 0


def test_attempts_are_validated_and_unknown_codes_404(conn, client, scored):
    res = _score_and_attempt(client, scored, rev=(10.0, 9.0))
    assert res.status_code == 422
    short = client.post(f"/api/practice/cases/{scored['code']}/attempt",
                        json={"ranges": _ranges()[:2], "mystery": True})
    assert short.json()["detail"]["code"] == "missing_metric"
    assert client.get("/api/practice/cases/zzzzzz").json()["detail"]["code"] == "practice_not_found"
    open_code = practice.code_for(scored["event"] + 1)
    assert client.get(f"/api/practice/cases/{open_code}").status_code == 404

"""
Results League API (Phase 2): admin setup, profile/consent rules, forecast
validation and lock enforcement. Test-branch database only (conftest.py).
"""
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from app.config import get_settings

ADMIN = "admin@example.com"


@pytest.fixture(autouse=True)
def admin_env(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", ADMIN)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _signup(client, email):
    res = client.post("/api/auth/signup", json={"email": email, "name": "T", "password": "longenough1"})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['token']}"}


def _profile(client, headers, handle, age_band="18_plus"):
    return client.patch("/api/league/me", json={"handle": handle, "age_band": age_band}, headers=headers)


def _quick(client, admin, **overrides):
    body = {
        "exchange": "NSE", "ticker": "DEMOCEM", "company_name": "Demo Cement (fictional)", "sector": "cement",
        "fiscal_year_label": "FY27", "fiscal_quarter": 2, "period_end_date": "2026-09-30",
        "results_date": "2026-11-20", "season_label": "Q2 FY27", "include_kpi": True,
    }
    body.update(overrides)
    return client.post("/api/admin/events/quick", json=body, headers=admin)


def _values(kpi=True, rev=(4.0, 9.0), margin=(15.0, 19.0)):
    v = [{"metric_key": "revenue_growth_yoy", "low": rev[0], "high": rev[1]},
         {"metric_key": "operating_margin", "low": margin[0], "high": margin[1]}]
    if kpi:
        v.append({"metric_key": "sector_kpi", "low": 2.0, "high": 8.0})
    return v


@pytest.fixture
def setup(conn, client):
    admin = _signup(client, ADMIN)
    res = _quick(client, admin)
    assert res.status_code == 200, res.text
    user = _signup(client, "student@example.com")
    return {"admin": admin, "event": res.json()["id"], "user": user}


def _db_now_plus(conn, interval: str) -> str:
    return conn.execute(f"SELECT (now() + interval '{interval}')").fetchone()[0].isoformat()


# ---------- Admin setup ----------

def test_quick_event_snapshots_definitions_and_default_lock(conn, client, setup):
    row = conn.execute(
        "SELECT lock_at, status, metric_definitions FROM forecast_events WHERE id = %s", (setup["event"],)
    ).fetchone()
    lock_ist = row[0].astimezone(ZoneInfo("Asia/Kolkata"))
    assert (lock_ist.date().isoformat(), lock_ist.hour, lock_ist.minute) == ("2026-11-19", 23, 59)
    assert row[1] == "open"
    keys = [m["definition_key"] for m in row[2]["metrics"]]
    assert keys == ["in.revenue_growth_yoy.v1", "in.operating_margin.v1", "in.cement.volume_growth_yoy.v1"]
    assert all(m["definition"] for m in row[2]["metrics"])


def test_quick_event_rejects_excluded_sectors(conn, client, setup):
    res = _quick(client, setup["admin"], ticker="DEMOBANK", company_name="Demo Bank", sector="banks")
    assert res.status_code == 422 and res.json()["detail"]["code"] == "sector_excluded"


def test_admin_endpoints_reject_non_admins(conn, client, setup):
    assert _quick(client, setup["user"], ticker="X").status_code == 403
    assert client.get("/api/admin/users", headers=setup["user"]).status_code == 403
    assert client.get("/api/admin/audit").status_code == 401


def test_draft_events_are_hidden_from_users(conn, client, setup):
    draft = _quick(client, setup["admin"], ticker="DRAFTCO", company_name="Draft Co", open_now=False).json()["id"]
    ids = [e["id"] for e in client.get("/api/league/events").json()]
    assert setup["event"] in ids and draft not in ids
    assert client.get(f"/api/league/events/{draft}").status_code == 404


# ---------- Profile and consent ----------

def test_forecast_requires_a_profile(conn, client, setup):
    res = client.put(f"/api/league/events/{setup['event']}/forecast", json={"values": _values()}, headers=setup["user"])
    assert res.status_code == 409 and res.json()["detail"]["code"] == "profile_required"


def test_under_18_blocked_until_admin_records_consent(conn, client, setup):
    assert _profile(client, setup["user"], "young_one", "under_18").json()["guardian_consent_status"] == "pending"
    url = f"/api/league/events/{setup['event']}/forecast"
    res = client.put(url, json={"values": _values()}, headers=setup["user"])
    assert res.status_code == 403 and res.json()["detail"]["code"] == "guardian_consent_pending"

    uid = conn.execute("SELECT id FROM users WHERE email = 'student@example.com'").fetchone()[0]
    assert client.put(f"/api/admin/users/{uid}/guardian-consent", json={"status": "granted"},
                      headers=setup["admin"]).status_code == 204
    assert client.put(url, json={"values": _values()}, headers=setup["user"]).status_code == 200


def test_age_band_can_only_be_set_once_by_the_user(conn, client, setup):
    _profile(client, setup["user"], "young_one", "under_18")
    res = _profile(client, setup["user"], "young_one", "18_plus")
    assert res.status_code == 409 and res.json()["detail"]["code"] == "age_band_locked"


def test_handles_are_unique_case_insensitively(conn, client, setup):
    assert _profile(client, setup["user"], "Asha").status_code == 200
    other = _signup(client, "other@example.com")
    res = _profile(client, other, "asha")
    assert res.status_code == 409 and res.json()["detail"]["code"] == "handle_taken"


# ---------- Forecast validation ----------

@pytest.fixture
def ready(conn, client, setup):
    assert _profile(client, setup["user"], "forecaster").status_code == 200
    return setup


@pytest.mark.parametrize(
    "values,code",
    [
        (_values(kpi=False), "missing_metric"),
        (_values(rev=(-150.0, 5.0)), "out_of_bounds"),
        (_values() + [{"metric_key": "net_profit", "low": 1, "high": 2}], "unknown_metric"),
    ],
)
def test_forecast_validation(conn, client, ready, values, code):
    res = client.put(f"/api/league/events/{ready['event']}/forecast", json={"values": values}, headers=ready["user"])
    assert res.status_code == 422 and res.json()["detail"]["code"] == code


def test_low_above_high_rejected(conn, client, ready):
    res = client.put(f"/api/league/events/{ready['event']}/forecast",
                     json={"values": _values(rev=(9.0, 4.0))}, headers=ready["user"])
    assert res.status_code == 422


def test_unknown_reason_tag_and_long_note_rejected(conn, client, ready):
    url = f"/api/league/events/{ready['event']}/forecast"
    assert client.put(url, json={"values": _values(), "reason_tags": ["insider_tip"]},
                      headers=ready["user"]).json()["detail"]["code"] == "unknown_reason_tag"
    assert client.put(url, json={"values": _values(), "note": "x" * 141}, headers=ready["user"]).status_code == 422


def test_save_then_edit_before_lock_is_audited(conn, client, ready):
    url = f"/api/league/events/{ready['event']}/forecast"
    first = client.put(url, json={"values": _values(), "reason_tags": ["more_volume"], "note": "dealer checks"},
                       headers=ready["user"])
    assert first.status_code == 200 and first.json()["locked"] is False
    second = client.put(url, json={"values": _values(rev=(5.0, 7.0)), "reason_tags": ["more_volume"]},
                        headers=ready["user"])
    assert second.status_code == 200
    rev = next(v for v in second.json()["values"] if v["metric_key"] == "revenue_growth_yoy")
    assert (rev["low"], rev["high"], rev["confidence"]) == (5.0, 7.0, 0.8)
    assert second.json()["note"] is None
    actions = [r[0] for r in conn.execute("SELECT action FROM audit_log WHERE entity = 'forecast' ORDER BY id")]
    assert actions == ["create", "update"]
    listed = client.get("/api/league/events", headers=ready["user"]).json()
    assert next(e for e in listed if e["id"] == ready["event"])["submitted"] is True


# ---------- Lock enforcement ----------

def test_lock_boundary(conn, client, ready):
    url = f"/api/league/events/{ready['event']}/forecast"
    # Generous window: from India each request is several ~0.3s round trips.
    lock_at = _db_now_plus(conn, "20 seconds")
    assert client.patch(f"/api/admin/events/{ready['event']}", json={"lock_at": lock_at},
                        headers=ready["admin"]).status_code == 204
    assert client.put(url, json={"values": _values()}, headers=ready["user"]).status_code == 200

    # Wait on the database's own clock -- the one the lock is enforced by.
    while conn.execute("SELECT now() <= %s::timestamptz", (lock_at,)).fetchone()[0]:
        time.sleep(1)
    res = client.put(url, json={"values": _values(rev=(1.0, 2.0))}, headers=ready["user"])
    assert res.status_code == 409 and res.json()["detail"]["code"] == "forecast_locked"
    mine = client.get(f"/api/league/events/{ready['event']}/my-forecast", headers=ready["user"]).json()
    assert mine["locked"] is True
    assert next(v for v in mine["values"] if v["metric_key"] == "revenue_growth_yoy")["low"] == 4.0
    event = client.get(f"/api/league/events/{ready['event']}").json()
    assert event["status"] == "locked"
    # ...and nobody can reopen it by moving the lock time.
    res = client.patch(f"/api/admin/events/{ready['event']}", json={"lock_at": _db_now_plus(conn, "1 day")},
                       headers=ready["admin"])
    assert res.status_code == 409 and res.json()["detail"]["code"] == "lock_time_passed"


def test_new_forecast_after_lock_rejected(conn, client, ready):
    client.patch(f"/api/admin/events/{ready['event']}", json={"lock_at": _db_now_plus(conn, "-1 second")},
                 headers=ready["admin"])
    res = client.put(f"/api/league/events/{ready['event']}/forecast", json={"values": _values()}, headers=ready["user"])
    assert res.status_code == 409


def test_event_detail_reports_server_time(conn, client, ready):
    detail = client.get(f"/api/league/events/{ready['event']}").json()
    assert abs((datetime.fromisoformat(detail["server_now"]) - datetime.now(ZoneInfo("UTC"))).total_seconds()) < 120
    assert [m["key"] for m in detail["metrics"]] == ["revenue_growth_yoy", "operating_margin", "sector_kpi"]


# ---------- Actuals ----------

def _period(conn, event_id):
    return conn.execute("SELECT period_id FROM forecast_events WHERE id = %s", (event_id,)).fetchone()[0]


def test_actuals_need_a_source_link(conn, client, setup):
    url = f"/api/admin/periods/{_period(conn, setup['event'])}/actuals"
    item = {"metric_key": "operating_margin", "definition_key": "in.operating_margin.v1", "value": 18.2}
    assert client.put(url, json=[item], headers=setup["admin"]).status_code == 422
    assert client.put(url, json=[{**item, "source_url": "see filing"}], headers=setup["admin"]).status_code == 422


def test_actuals_must_match_a_definition_for_that_metric(conn, client, setup):
    url = f"/api/admin/periods/{_period(conn, setup['event'])}/actuals"
    wrong = {"metric_key": "operating_margin", "definition_key": "in.revenue_growth_yoy.v1", "value": 18.2,
             "source_url": "https://www.nseindia.com/filing.pdf"}
    assert client.put(url, json=[wrong], headers=setup["admin"]).json()["detail"]["code"] == "unknown_definition"
    kpi = {"metric_key": "sector_kpi", "definition_key": "in.it.cc_revenue_growth_yoy.v1", "value": 5.0,
           "source_url": "https://www.nseindia.com/filing.pdf"}
    assert client.put(url, json=[kpi], headers=setup["admin"]).json()["detail"]["code"] == "wrong_sector_kpi"


def test_past_period_actuals_feed_the_research_history(conn, client, setup):
    company = conn.execute("SELECT id FROM companies WHERE ticker = 'DEMOCEM'").fetchone()[0]
    past = client.post("/api/admin/periods", json={"company_id": company, "fiscal_year_label": "FY26",
                                                   "fiscal_quarter": 2, "period_end_date": "2025-09-30"},
                       headers=setup["admin"]).json()["id"]
    item = {"metric_key": "operating_margin", "definition_key": "in.operating_margin.v1", "value": 17.4,
            "source_url": "https://www.bseindia.com/xml-data/corpfiling/AttachLive/q2fy26.pdf"}
    assert client.put(f"/api/admin/periods/{past}/actuals", json=[item], headers=setup["admin"]).status_code == 204
    history = client.get(f"/api/league/companies/{company}/history").json()
    assert history["provider_rows"] == []  # no provider_symbol -> no network call
    assert [(a["fiscal_year_label"], a["value"]) for a in history["actuals"]] == [("FY26", 17.4)]
    assert conn.execute("SELECT count(*) FROM audit_log WHERE entity = 'actual'").fetchone()[0] == 1


def test_demo_companies_hidden_on_vercel(conn, client, setup, monkeypatch):
    conn.execute("UPDATE companies SET is_demo = TRUE")
    monkeypatch.setenv("VERCEL", "1")
    assert client.get("/api/league/events").json() == []
    monkeypatch.delenv("VERCEL")
    assert len(client.get("/api/league/events").json()) == 1

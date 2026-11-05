"""
Pre-pilot privacy and security rules (2026-11): terms agreement, account
deletion with anonymised forecasts, guardian consent details, retention
purges, hashed rate-limit keys, auth attempt limits and password-reset
hardening. Test-branch database only (conftest.py).
"""
import pytest

from app.config import get_settings
from app.services import auth_service, db

ADMIN = "admin@example.com"
PASSWORD = "longenough1"


@pytest.fixture(autouse=True)
def admin_env(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", ADMIN)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _signup(client, email, accept=True):
    return client.post(
        "/api/auth/signup",
        json={"email": email, "name": "T", "password": PASSWORD, "accept_terms": accept},
    )


def _headers(res):
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['token']}"}


def _uid(conn, email):
    return conn.execute("SELECT id FROM users WHERE email = %s", (email,)).fetchone()[0]


def _event(client, admin):
    res = client.post("/api/admin/events/quick", headers=admin, json={
        "exchange": "NSE", "ticker": "DEMOCEM", "company_name": "Demo Cement (fictional)", "sector": "cement",
        "fiscal_year_label": "FY27", "fiscal_quarter": 2, "period_end_date": "2026-09-30",
        "results_date": "2026-11-20", "season_label": "Q2 FY27", "include_kpi": False, "open_now": True,
    })
    assert res.status_code == 200, res.text
    return res.json()["id"]


_VALUES = [{"metric_key": "revenue_growth_yoy", "low": 4.0, "high": 9.0},
           {"metric_key": "operating_margin", "low": 15.0, "high": 19.0}]


# ---------- Terms ----------

def test_signup_requires_the_terms_checkbox(conn, client):
    res = _signup(client, "a@example.com", accept=False)
    assert res.status_code == 400 and "Terms" in res.json()["detail"]
    assert conn.execute("SELECT count(*) FROM users").fetchone()[0] == 0

    user = _signup(client, "a@example.com").json()["user"]
    assert user["needs_terms"] is False and user["terms_accepted_at"]


def test_existing_account_must_agree_before_forecasting(conn, client):
    admin = _headers(_signup(client, ADMIN))
    event = _event(client, admin)
    user = _headers(_signup(client, "s@example.com"))
    client.patch("/api/league/me", json={"handle": "asha", "age_band": "18_plus"}, headers=user)
    conn.execute("UPDATE users SET terms_version = NULL, terms_accepted_at = NULL WHERE email = 's@example.com'")

    assert client.get("/api/auth/me", headers=user).json()["needs_terms"] is True
    res = client.put(f"/api/league/events/{event}/forecast", json={"values": _VALUES}, headers=user)
    assert res.status_code == 403 and res.json()["detail"]["code"] == "terms_required"

    agreed = client.post("/api/auth/accept-terms", headers=user)
    assert agreed.status_code == 200 and agreed.json()["needs_terms"] is False
    assert client.put(f"/api/league/events/{event}/forecast", json={"values": _VALUES}, headers=user).status_code == 200


def test_new_google_account_needs_the_checkbox(conn, client, monkeypatch):
    import app.main as main

    monkeypatch.setattr(main.settings, "google_client_id", "test-client")
    monkeypatch.setattr(main.google_id_token, "verify_oauth2_token", lambda *_a, **_k: {
        "email": "g@example.com", "sub": "google-123", "email_verified": True, "name": "G"})

    res = client.post("/api/auth/google", json={"credential": "x"})
    assert res.status_code == 409 and res.json()["detail"]["code"] == "terms_required"
    assert conn.execute("SELECT count(*) FROM users").fetchone()[0] == 0

    assert client.post("/api/auth/google", json={"credential": "x", "accept_terms": True}).status_code == 200
    # An existing Google account signs in without the checkbox.
    assert client.post("/api/auth/google", json={"credential": "x"}).status_code == 200


# ---------- Account deletion ----------

def test_delete_account_keeps_forecasts_anonymised(conn, client):
    admin = _headers(_signup(client, ADMIN))
    event = _event(client, admin)
    user = _headers(_signup(client, "s@example.com"))
    client.patch("/api/league/me", json={"handle": "asha", "age_band": "18_plus", "school_name": "DPS"},
                 headers=user)
    res = client.put(f"/api/league/events/{event}/forecast",
                     json={"values": _VALUES, "note": "Asha thinks cement demand is strong"}, headers=user)
    assert res.status_code == 200, res.text
    uid = _uid(conn, "s@example.com")
    # Lock the event: the note must still be cleared afterwards.
    conn.execute("UPDATE forecast_events SET lock_at = now() - interval '1 minute' WHERE id = %s", (event,))

    assert client.post("/api/auth/delete-account", json={"confirm": "yes"}, headers=user).status_code == 400
    assert client.post("/api/auth/delete-account", json={"confirm": "DELETE"}, headers=user).status_code == 204

    row = conn.execute(
        """SELECT email, name, handle, school_name, age_band, google_id, password_hash, deleted_at
           FROM users WHERE id = %s""", (uid,)).fetchone()
    assert row[0] == f"deleted-{uid}@deleted.invalid"
    assert row[1:7] == ("", None, None, None, None, None) and row[7] is not None
    forecast = conn.execute("SELECT user_id, note FROM forecasts WHERE event_id = %s", (event,)).fetchone()
    assert forecast == (uid, None)
    assert conn.execute("SELECT count(*) FROM forecast_values").fetchone()[0] == 2
    for table in ("sessions", "activity_log"):
        assert conn.execute(f"SELECT count(*) FROM {table} WHERE user_id = %s", (uid,)).fetchone()[0] == 0

    audit = conn.execute("SELECT actor_user_id, entity_id, details::text FROM audit_log WHERE entity = 'account'").fetchone()
    assert audit[0] is None and audit[1] == str(uid) and "example.com" not in audit[2] and "asha" not in audit[2]

    assert client.get("/api/auth/me", headers=user).json() is None
    assert all(u["id"] != uid for u in client.get("/api/admin/users", headers=admin).json())
    # The address is free again.
    assert _signup(client, "s@example.com").status_code == 200


# ---------- Guardian consent ----------

def test_consent_records_who_how_and_when(conn, client):
    admin = _headers(_signup(client, ADMIN))
    user = _headers(_signup(client, "kid@example.com"))
    client.patch("/api/league/me", json={"handle": "kid", "age_band": "under_18"}, headers=user)
    url = f"/api/admin/users/{_uid(conn, 'kid@example.com')}/guardian-consent"

    assert client.put(url, json={"status": "granted"}, headers=admin).status_code == 422
    body = {"status": "granted", "parent_name": "Meera Rao", "method": "parent_email", "consent_date": "2026-11-02"}
    assert client.put(url, json=body, headers=admin).status_code == 204

    listed = next(u for u in client.get("/api/admin/users", headers=admin).json() if u["handle"] == "kid")
    assert (listed["guardian_consent_by"], listed["guardian_consent_method"], listed["guardian_consent_date"]) == (
        "Meera Rao", "parent_email", "2026-11-02")
    details = conn.execute("SELECT details::text FROM audit_log WHERE entity = 'guardian_consent'").fetchone()[0]
    assert "parent_email" in details and "Meera" not in details

    assert client.put(url, json={"status": "pending"}, headers=admin).status_code == 204
    listed = next(u for u in client.get("/api/admin/users", headers=admin).json() if u["handle"] == "kid")
    assert listed["guardian_consent_by"] is None and listed["guardian_consent_status"] == "pending"


# ---------- Password reset ----------

def test_password_reset_is_single_use_and_ends_sessions(conn, client):
    old = _headers(_signup(client, "s@example.com"))
    _name, token = auth_service.request_password_reset("s@example.com")

    assert client.post("/api/auth/reset-password", json={"token": token, "new_password": "brandnew123"}).status_code == 200
    assert client.get("/api/auth/me", headers=old).json() is None
    assert client.post("/api/auth/reset-password", json={"token": token, "new_password": "another123"}).status_code == 400
    assert client.post("/api/auth/login", json={"email": "s@example.com", "password": "brandnew123"}).status_code == 200


def test_reset_link_never_points_at_a_forged_origin(conn, client, monkeypatch):
    from app.services import gmail_service

    sent = []
    monkeypatch.setattr(gmail_service, "send_password_reset_email", lambda _e, _n, link: sent.append(link))
    _signup(client, "s@example.com")
    client.post("/api/auth/forgot-password", json={"email": "s@example.com"},
                headers={"Origin": "https://evil.example"})
    client.post("/api/auth/forgot-password", json={"email": "s@example.com"},
                headers={"Origin": "http://localhost:5173"})
    assert sent[0].startswith("https://stackslymetrics.com/?reset_token=")
    assert sent[1].startswith("http://localhost:5173/?reset_token=")


# ---------- Attempt limits and stored IPs ----------

def test_login_attempts_are_limited_per_account(conn, client, monkeypatch):
    monkeypatch.setenv("AUTH_RATE_LIMITS_ENABLED", "true")
    get_settings.cache_clear()
    _signup(client, "s@example.com")
    codes = [client.post("/api/auth/login", json={"email": "s@example.com", "password": "wrongpass1"}).status_code
             for _ in range(11)]
    assert codes[:10] == [401] * 10 and codes[10] == 429

    keys = [r[0] for r in conn.execute("SELECT bucket_key FROM rate_limit_buckets")]
    assert keys and not any("testclient" in k or "s@example.com" in k for k in keys)


def test_reset_emails_are_limited_per_address_without_revealing_it(conn, client, monkeypatch):
    from app.services import gmail_service

    monkeypatch.setenv("AUTH_RATE_LIMITS_ENABLED", "true")
    get_settings.cache_clear()
    sent = []
    monkeypatch.setattr(gmail_service, "send_password_reset_email", lambda *a: sent.append(a))
    _signup(client, "s@example.com")
    responses = [client.post("/api/auth/forgot-password", json={"email": "s@example.com"}) for _ in range(5)]
    assert all(r.status_code == 200 for r in responses)
    assert len({r.text for r in responses}) == 1
    assert len(sent) == 3


# ---------- Retention ----------

def test_purge_removes_expired_sessions_and_old_activity(conn, client):
    _signup(client, "s@example.com")
    uid = _uid(conn, "s@example.com")
    conn.execute("INSERT INTO sessions (token, user_id, expires_at) VALUES ('old', %s, '2026-01-01T00:00:00+00:00')", (uid,))
    conn.execute("INSERT INTO activity_log (user_id, action, created_at) VALUES (%s, 'searched', (now() - interval '13 months')::text)", (uid,))
    conn.execute("INSERT INTO activity_log (user_id, action, created_at) VALUES (%s, 'searched', (now() - interval '11 months')::text)", (uid,))

    db.purge_expired_personal_data(conn)

    assert conn.execute("SELECT count(*) FROM sessions WHERE token = 'old'").fetchone()[0] == 0
    # signed_up (now) + the 11-month-old search survive.
    assert conn.execute("SELECT count(*) FROM activity_log WHERE user_id = %s", (uid,)).fetchone()[0] == 2

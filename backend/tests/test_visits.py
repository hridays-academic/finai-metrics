"""First-party visit counter: aggregate only, no personal data (test DB only)."""
import pytest

from app.config import get_settings
from app.services import visits


def test_counts_aggregate_per_day_and_page(conn, client):
    for page in ("search", "search", "calculator"):
        assert client.post("/api/visit", json={"page": page}).status_code == 204
    rows = dict(conn.execute("SELECT page, count FROM page_visits_daily").fetchall())
    assert rows == {"search": 2, "calculator": 1}
    (day_is_ist_today,) = conn.execute(
        "SELECT bool_and(day = (now() AT TIME ZONE 'Asia/Kolkata')::date) FROM page_visits_daily"
    ).fetchone()
    assert day_is_ist_today


@pytest.mark.parametrize(
    "page",
    ["/?reset_token=abc123", "reset_token=abc123", "profile/asha", "https://evil.example", "", "x" * 41],
)
def test_only_allowlisted_page_names_are_stored(conn, client, page):
    assert client.post("/api/visit", json={"page": page}).status_code in (400, 422)
    assert conn.execute("SELECT count(*) FROM page_visits_daily").fetchone()[0] == 0


def test_table_has_no_room_for_personal_data(conn):
    cols = {r[0] for r in conn.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'page_visits_daily'"
    )}
    assert cols == {"day", "page", "count"}


def test_visit_endpoint_ignores_auth_and_stores_no_user(conn, client):
    res = client.post("/api/visit", json={"page": "search"}, headers={"Authorization": "Bearer whatever"})
    assert res.status_code == 204
    assert conn.execute("SELECT count(*) FROM activity_log").fetchone()[0] == 0


def test_page_list_is_route_names_only():
    assert all(p.replace("_", "").isalpha() and p.islower() for p in visits.PAGES)


@pytest.fixture
def admin_env(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", "Admin@Example.com")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _signup(client, email):
    res = client.post("/api/auth/signup", json={"email": email, "name": "T", "password": "longenough1"})
    return {"Authorization": f"Bearer {res.json()['token']}"}


def test_admin_visits_requires_sign_in(conn, client, admin_env):
    assert client.get("/api/admin/visits").status_code == 401


def test_admin_visits_rejects_non_admins(conn, client, admin_env):
    assert client.get("/api/admin/visits", headers=_signup(client, "someone@example.com")).status_code == 403


def test_admin_visits_returns_counts_for_admins(conn, client, admin_env):
    client.post("/api/visit", json={"page": "trading"})
    res = client.get("/api/admin/visits?days=7", headers=_signup(client, "admin@example.com"))
    assert res.status_code == 200
    body = res.json()
    assert body["days"] == 7
    assert [(r["page"], r["count"]) for r in body["rows"]] == [("trading", 1)]

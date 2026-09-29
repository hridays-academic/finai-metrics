"""
The Tapetide integration was removed (2026-09). These pin down that its
stored data is deleted by the schema and its routes no longer exist.
Test-branch database only (see conftest.py).
"""
import pytest

from app.services import db as db_module


def _column_exists(conn) -> bool:
    return conn.execute(
        """SELECT EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = current_schema() AND table_name = 'users'
                            AND column_name = 'tapetide_key_encrypted')"""
    ).fetchone()[0]


def test_schema_has_no_tapetide_storage(conn):
    assert not _column_exists(conn)
    assert conn.execute("SELECT to_regclass('tapetide_quota')").fetchone()[0] is None


def test_existing_tapetide_data_is_deleted_on_migration(conn):
    # Recreate what an older production database looks like, with data.
    conn.execute("ALTER TABLE users ADD COLUMN tapetide_key_encrypted TEXT")
    conn.execute(
        "CREATE TABLE tapetide_quota (token_hash TEXT PRIMARY KEY, quota_date TEXT NOT NULL, calls_today INTEGER)"
    )
    conn.execute(
        "INSERT INTO users (email, name, tapetide_key_encrypted) VALUES ('k@example.com', 'K', 'gAAAAencrypted')"
    )
    conn.execute("INSERT INTO tapetide_quota VALUES ('abc123', '2026-09-28', 7)")
    conn.execute("UPDATE schema_version SET version = 2")

    db_module.init_db()

    assert not _column_exists(conn)
    assert conn.execute("SELECT to_regclass('tapetide_quota')").fetchone()[0] is None
    # The user account itself survives; only the key is gone.
    assert conn.execute("SELECT count(*) FROM users WHERE email = 'k@example.com'").fetchone()[0] == 1


@pytest.fixture
def client(db_url):
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)


@pytest.mark.parametrize(
    "method,path",
    [("get", "/api/quota"), ("get", "/api/tapetide/validate"), ("post", "/api/auth/tapetide-key")],
)
def test_tapetide_routes_are_gone(client, method, path):
    assert getattr(client, method)(path).status_code == 404


def test_signed_in_user_payload_has_no_key_field(conn, client):
    res = client.post(
        "/api/auth/signup", json={"email": "s@example.com", "name": "S", "password": "longenough1"}
    )
    assert res.status_code == 200
    user = res.json()["user"]
    assert "tapetide_key" not in user
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {res.json()['token']}"}).json()
    assert "tapetide_key" not in me

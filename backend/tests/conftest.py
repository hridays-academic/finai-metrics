"""
Test database safety. The test suite wipes tables, so it must never be able
to reach production (or dev) -- enforced here, before any app code runs:

1. At import, DATABASE_URL is replaced with an unreachable placeholder, so
   anything that touches the database before verification fails instead of
   quietly using backend/.env's dev database.
2. The `db_url` fixture only hands out TEST_DATABASE_URL after checking that
   it differs from the configured DATABASE_URL AND that the database itself
   is labelled 'test' in its `stackly_env` table. Production has no such
   table, so a copy-paste mix-up of connection strings still can't get
   through.
3. `wipe()` re-runs the label check itself, on the connection it truncates
   with, rather than trusting (2).

Pure tests (e.g. test_scoring.py) never request `db_url` and need no
database at all.
"""
import os
import threading
from pathlib import Path

import psycopg
import pytest
from dotenv import dotenv_values

_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
_FILE_ENV = dotenv_values(_ENV_FILE) if _ENV_FILE.exists() else {}
_CONFIGURED_DB = os.environ.get("DATABASE_URL") or _FILE_ENV.get("DATABASE_URL")
_TEST_DB = os.environ.get("TEST_DATABASE_URL") or _FILE_ENV.get("TEST_DATABASE_URL")

# A dropped Neon connection should error, not hang: connect timeout plus TCP
# keepalives on every test connection (the app's too, via DATABASE_URL).
# The guard below compares the URL as configured (_TEST_DB_RAW), never this one.
_TEST_DB_RAW = _TEST_DB
if _TEST_DB and "keepalives" not in _TEST_DB:
    _TEST_DB += ("&" if "?" in _TEST_DB else "?") + (
        "connect_timeout=15&keepalives=1&keepalives_idle=30&keepalives_interval=10&keepalives_count=3"
    )

_UNVERIFIED = "postgresql://tests-must-use-db_url-fixture.invalid:1/none"
os.environ["DATABASE_URL"] = _UNVERIFIED
# Takes precedence over DATABASE_URL (see config.py), so it must never leak
# into a test run.
os.environ.pop("STACKLY_DATABASE_URL", None)
# Tests sign up hundreds of users from one client "IP"; the limits get
# their own test (test_privacy.py), which switches them back on.
os.environ["AUTH_RATE_LIMITS_ENABLED"] = "false"

# League tables plus users (tests create their own users). Truncating
# bypasses the row-level lock triggers, which is what lets tests clean up
# locked forecasts.
_WIPE_TABLES = (
    "audit_log", "practice_attempts", "practice_cases", "league_members", "leagues",
    "diagnoses", "scores", "baselines", "actuals", "forecast_values", "forecasts",
    "forecast_events", "fiscal_periods", "companies", "activity_log", "sessions",
    "password_reset_tokens", "users", "page_visits_daily", "rate_limit_buckets",
    "news_items", "exchange_filings", "world_events", "macro_series_cache", "job_runs", "research_workspaces",
)


def _assert_test_database(url: str) -> None:
    with psycopg.connect(url, connect_timeout=15) as conn:
        _assert_test_connection(conn)


def _assert_test_connection(conn: psycopg.Connection) -> None:
    try:
        labels = {r[0] for r in conn.execute("SELECT name FROM stackly_env")}
    except psycopg.errors.UndefinedTable:
        labels = set()
    if labels != {"test"}:
        raise RuntimeError(
            f"Refusing to use TEST_DATABASE_URL: its stackly_env label is {sorted(labels) or 'missing'}, "
            "not ['test']. See CLAUDE.md's Testing section."
        )


@pytest.fixture(scope="session")
def db_url() -> str:
    if not _TEST_DB:
        pytest.fail("TEST_DATABASE_URL is not set (backend/.env). Database tests need the Neon `test` branch.")
    if _CONFIGURED_DB and _TEST_DB_RAW == _CONFIGURED_DB:
        pytest.fail("TEST_DATABASE_URL is the same as DATABASE_URL; refusing to run database tests.")
    _assert_test_database(_TEST_DB)

    os.environ["DATABASE_URL"] = _TEST_DB
    from app.config import get_settings

    get_settings.cache_clear()
    from app.services import db
    from app.services.db import init_db

    init_db()
    pool = _ReusedConnections()
    real = db.psycopg
    db.psycopg = _PooledPsycopg(pool)
    yield _TEST_DB
    db.psycopg = real
    pool.close_all()
    os.environ["DATABASE_URL"] = _UNVERIFIED
    get_settings.cache_clear()


# Test speed only (2026-11-13): from India a new TLS connection to Neon takes
# ~2.3 s, and the app opens one per get_conn(), so most of a test's time was
# handshakes. get_conn() connections are reused instead. Each use still ends
# its own transaction (commit on success; rollback when get_conn closes after
# an error), so now() and the lock triggers behave as with fresh connections,
# and nested get_conn() calls get separate connections, as in production. The
# app has no connection-level state (checked: its only lock is
# pg_advisory_xact_lock). init_db and the fixtures below still connect fresh.
class _ReusedConnection:
    def __init__(self, pool, conn):
        self._pool, self._conn = pool, conn

    def __getattr__(self, name):
        return getattr(self._conn, name)

    def close(self):
        self._pool.give_back(self._conn)


class _ReusedConnections:
    def __init__(self):
        self._idle: list = []
        self._lock = threading.Lock()

    def take(self, dsn, kwargs):
        with self._lock:
            while self._idle:
                conn = self._idle.pop()
                if not conn.closed and not conn.broken:
                    return conn
        return psycopg.connect(dsn, **kwargs)

    def give_back(self, conn):
        if conn.closed or conn.broken:
            return
        try:
            conn.rollback()  # ends anything left uncommitted, as close() would
        except psycopg.Error:
            conn.close()
            return
        with self._lock:
            self._idle.append(conn)

    def close_all(self):
        with self._lock:
            for conn in self._idle:
                conn.close()
            self._idle.clear()


class _PooledPsycopg:
    """Stands in for the psycopg module inside app.services.db only."""

    def __init__(self, pool):
        self._pool = pool

    def __getattr__(self, name):
        return getattr(psycopg, name)

    def connect(self, dsn, **kwargs):
        if kwargs.get("row_factory") is None:  # init_db: keep it a real, fresh connection
            return psycopg.connect(dsn, **kwargs)
        return _ReusedConnection(self._pool, self._pool.take(dsn, kwargs))


def wipe(conn: psycopg.Connection) -> None:
    """Truncates on the given autocommit connection, after checking that very
    connection's database is labelled 'test'."""
    _assert_test_connection(conn)
    conn.execute(f"TRUNCATE {', '.join(_WIPE_TABLES)} RESTART IDENTITY CASCADE")


@pytest.fixture
def conn(db_url: str):
    """A fresh autocommit connection on a wiped test database (one connection
    for the label check, the wipe and the test: each new one costs ~2 s from
    India). Autocommit matters: the lock triggers compare against now(),
    which is the start of the current transaction."""
    with psycopg.connect(db_url, autocommit=True) as c:
        wipe(c)
        yield c


@pytest.fixture
def client(db_url):
    """FastAPI test client bound to the verified test database."""
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)

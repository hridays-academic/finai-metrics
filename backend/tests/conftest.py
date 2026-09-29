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
3. `wipe()` re-runs the label check itself rather than trusting (2).

Pure tests (e.g. test_scoring.py) never request `db_url` and need no
database at all.
"""
import os
from pathlib import Path

import psycopg
import pytest
from dotenv import dotenv_values

_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
_FILE_ENV = dotenv_values(_ENV_FILE) if _ENV_FILE.exists() else {}
_CONFIGURED_DB = os.environ.get("DATABASE_URL") or _FILE_ENV.get("DATABASE_URL")
_TEST_DB = os.environ.get("TEST_DATABASE_URL") or _FILE_ENV.get("TEST_DATABASE_URL")

_UNVERIFIED = "postgresql://tests-must-use-db_url-fixture.invalid:1/none"
os.environ["DATABASE_URL"] = _UNVERIFIED

# League tables plus users (tests create their own users). Truncating
# bypasses the row-level lock triggers, which is what lets tests clean up
# locked forecasts.
_WIPE_TABLES = (
    "audit_log", "practice_attempts", "practice_cases", "league_members", "leagues",
    "diagnoses", "scores", "baselines", "actuals", "forecast_values", "forecasts",
    "forecast_events", "fiscal_periods", "companies", "activity_log", "sessions",
    "password_reset_tokens", "users",
)


def _assert_test_database(url: str) -> None:
    with psycopg.connect(url, connect_timeout=15) as conn:
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
    if _CONFIGURED_DB and _TEST_DB == _CONFIGURED_DB:
        pytest.fail("TEST_DATABASE_URL is the same as DATABASE_URL; refusing to run database tests.")
    _assert_test_database(_TEST_DB)

    os.environ["DATABASE_URL"] = _TEST_DB
    from app.config import get_settings

    get_settings.cache_clear()
    from app.services.db import init_db

    init_db()
    yield _TEST_DB
    os.environ["DATABASE_URL"] = _UNVERIFIED
    get_settings.cache_clear()


def wipe(url: str) -> None:
    _assert_test_database(url)
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(f"TRUNCATE {', '.join(_WIPE_TABLES)} RESTART IDENTITY CASCADE")


@pytest.fixture
def conn(db_url: str):
    """A fresh autocommit connection on a wiped test database. Autocommit
    matters: the lock triggers compare against now(), which is the start of
    the current transaction."""
    wipe(db_url)
    with psycopg.connect(db_url, autocommit=True) as c:
        yield c

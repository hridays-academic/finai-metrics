"""
Postgres storage (Neon, free tier) for user accounts, sessions, activity
logs, and Tapetide per-key quota tracking. Originally SQLite (a single
gitignored local file) -- migrated 2026-07 when the app moved to Vercel:
serverless functions have an ephemeral filesystem, so anything written to
local disk (the SQLite file, and tapetide_provider.py's old
.tapetide_quota_state.json) is silently wiped on every cold start/redeploy.
A real hosted database is the only way persistence survives there. Neon
specifically because its free tier needs no credit card and is permanent
(not a trial) -- see CLAUDE.md.

Uses psycopg (v3) directly (no ORM) -- same reasoning as the old SQLite
setup: four small tables don't need one. `row_factory=dict_row` keeps the
`row["colname"]` access pattern every call site already used with
sqlite3.Row, so only the `?` -> `%s` placeholder syntax and a couple of
INSERT...RETURNING swaps (Postgres has no `cursor.lastrowid`) needed to
change in auth_service.py.
"""
from contextlib import contextmanager
from typing import Iterator

import psycopg
from psycopg.rows import dict_row

from app.config import get_settings

_SCHEMA_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (NOW()::text)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (NOW()::text),
        expires_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS activity_log (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        action TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL DEFAULT (NOW()::text)
    )
    """,
    # One row per Tapetide key (hashed, never the raw token -- see
    # tapetide_provider.py), replacing the old .tapetide_quota_state.json's
    # {token_hash: {"date": ..., "calls_today": ...}} shape.
    """
    CREATE TABLE IF NOT EXISTS tapetide_quota (
        token_hash TEXT PRIMARY KEY,
        quota_date TEXT NOT NULL,
        calls_today INTEGER NOT NULL DEFAULT 0
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id, created_at DESC)",
]


def _dsn() -> str:
    dsn = get_settings().database_url
    if not dsn:
        raise RuntimeError(
            "DATABASE_URL is not set -- see CLAUDE.md's Neon Postgres setup. "
            "Locally, add it to backend/.env; in Vercel, set it as a project env var."
        )
    return dsn


def init_db() -> None:
    """Idempotent -- safe to call on every cold start."""
    with psycopg.connect(_dsn()) as conn:
        for statement in _SCHEMA_STATEMENTS:
            conn.execute(statement)
        conn.commit()


@contextmanager
def get_conn() -> Iterator[psycopg.Connection]:
    conn = psycopg.connect(_dsn(), row_factory=dict_row)
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()

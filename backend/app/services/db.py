"""
Local SQLite storage for user accounts, sessions, and activity logs -- the
one piece of this app that's genuinely persistent, user-specific state
(everything else is either fetched live from a provider or an in-process
cache). SQLite over Postgres/MySQL deliberately: this is a local dev app
with no existing database at all, and a single file needs no separate
server process to set up or run -- consistent with the project's existing
"avoid adding infrastructure" bias (see e.g. the dev-only response caches
in tapetide_provider.py/bharat_sm_provider.py, both plain files on disk).

Uses the stdlib `sqlite3` module directly (no ORM) -- three small tables
don't need one, and it avoids adding a new dependency for this.
"""
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

# Relative to wherever the app is run from (backend/, per README.md), same
# convention as tapetide_provider.py's _QUOTA_STATE_PATH. Gitignored --
# see .gitignore.
DB_PATH = Path("app.db")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id, created_at DESC);
"""


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    """Idempotent -- safe to call on every app startup."""
    with _connect() as conn:
        conn.executescript(_SCHEMA)


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    conn = _connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()

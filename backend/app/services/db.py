"""
Postgres storage (Neon, free tier) for user accounts, sessions, activity
logs, shared data caches and the Results League. Originally SQLite (a single
gitignored local file) -- migrated 2026-07 when the app moved to Vercel:
serverless functions have an ephemeral filesystem, so anything written to
local disk is silently wiped on every cold start/redeploy.
A real hosted database is the only way persistence survives there. Neon
specifically because its free tier needs no credit card and is permanent
(not a trial) -- see CLAUDE.md.

Uses psycopg (v3) directly (no ORM) -- same reasoning as the old SQLite
setup: eight small tables here don't need one (users, sessions,
activity_log, password_reset_tokens, and the four data-cache/rate-limit
tables). The Results League's tables live in league_schema.py and run
through the same init_db(). `row_factory=dict_row` keeps the
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
from app.services.league_schema import LEAGUE_SCHEMA_STATEMENTS

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
    "CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id, created_at DESC)",
    # Added 2026-07 -- Google Sign-In (see auth_service.py's
    # login_with_google). NULL for every password-based account; UNIQUE so
    # the same Google account can never back two different rows. Matched
    # first, before falling back to email (see login_with_google) -- an
    # email match links Google Sign-In onto an existing password account
    # rather than creating a duplicate.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE",
    # password_hash/password_salt were NOT NULL from the original
    # password-only design -- a Google-created account has neither (it
    # never sets a password at all, not even a random unusable one, so
    # there's nothing to accidentally guess). DROP NOT NULL is naturally
    # idempotent (a no-op if already nullable), same safety property as the
    # ADD COLUMN IF NOT EXISTS statements above.
    "ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL",
    "ALTER TABLE users ALTER COLUMN password_salt DROP NOT NULL",
    # Added 2026-09 -- "forgot password" (see auth_service.py's
    # request_password_reset/reset_password). token_hash stores SHA-256 of
    # the raw token, never the raw value itself: unlike sessions.token
    # above, a reset token travels over email (a channel more likely to be
    # logged/forwarded along the way than a session cookie) and is a
    # higher-stakes secret (whoever has one can take over the account
    # outright), so it gets the same "don't store the literal secret"
    # treatment. One row per user
    # at most in practice (request_password_reset deletes any existing row
    # for that user before inserting a new one) -- not enforced by a UNIQUE
    # constraint here since a stale leftover row for a deleted-in-the-
    # meantime scenario should never hard-fail the next request.
    """
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (NOW()::text),
        expires_at TEXT NOT NULL
    )
    """,
    # Added 2026-09 -- shared, cross-user cache of company fundamentals, so
    # yfinance can be the PRIMARY fundamentals source without one real
    # upstream call per visitor (see fundamentals_cache.py and CLAUDE.md's
    # "Sourcing" section). Keyed by resolved symbol, NOT by user: this data
    # is identical for everyone.
    #
    # Two independent freshness clocks in one row, on purpose -- RawFinancials
    # mixes data with very different lifetimes:
    #   fetched_at       -> statements/info/consensus (change quarterly; 7d TTL)
    #   price_fetched_at -> price_json overlay (changes every trading day;
    #                       15min TTL, refreshed via yfinance fast_info)
    # A single TTL would either serve a week-old share price (making P/E, P/B
    # and dividend yield silently wrong) or throw away the expensive
    # statement fetch every 15 minutes. The two columns are written by
    # separate statements that touch disjoint columns, so neither clobbers
    # the other's timestamp.
    """
    CREATE TABLE IF NOT EXISTS company_fundamentals_cache (
        symbol TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        info_json TEXT NOT NULL,
        raw_json TEXT NOT NULL,
        consensus_json TEXT,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        price_json TEXT,
        price_fetched_at TIMESTAMPTZ
    )
    """,
    # Added 2026-09 -- shared cache of the ~5yr weekly + ~6mo daily OHLC
    # series behind the price chart, so /api/price-history doesn't spend two
    # real yfinance calls on every single chart view (see
    # fundamentals_cache.py's PRICE_HISTORY_TTL). Also what makes
    # stale-serving possible there at all: without stored points, an upstream
    # outage can only produce a 502, whereas /api/company can fall back to
    # its own cached row.
    #
    # Deliberately a separate table from company_fundamentals_cache rather
    # than more columns on it: the two have different lifetimes (6 hours vs
    # 7 days), different sizes (tens of KB of OHLC vs a few KB of
    # statements), and price history is keyed by the yfinance-shaped symbol
    # regardless of which provider served the fundamentals.
    """
    CREATE TABLE IF NOT EXISTS price_history_cache (
        symbol TEXT PRIMARY KEY,
        points_json TEXT NOT NULL,
        recent_points_json TEXT NOT NULL,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    # Added 2026-09 -- caches "what the user typed" -> resolved symbol.
    # Measured live: YFinanceProvider.resolve_symbol costs TWO sequential
    # network probes (~2.5-3.5s) for a bare ticker it has to try as .NS then
    # .BO, on every single search. The mapping is stable, so caching it
    # removes that from the hot path entirely. Keyed by the normalized query
    # string, not the symbol -- many different queries ("tcs", "TCS",
    # "Tata Consultancy") legitimately resolve to the same symbol.
    """
    CREATE TABLE IF NOT EXISTS symbol_resolution_cache (
        query TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        exchange TEXT NOT NULL,
        resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    # Added 2026-09 -- per-IP rate limiting for the now-keyless data
    # endpoints (see rate_limit.py). MUST live in Postgres, not an
    # in-process dict: Vercel's serverless functions don't share memory
    # between invocations, so an in-memory counter would reset constantly
    # and enforce nothing (the same cold-start trap that made the old
    # on-disk quota file and SQLite database unusable -- see this file's
    # module docstring).
    """
    CREATE TABLE IF NOT EXISTS rate_limit_buckets (
        bucket_key TEXT PRIMARY KEY,
        hits INTEGER NOT NULL DEFAULT 0,
        expires_at TIMESTAMPTZ NOT NULL
    )
    """,
    # Supports the opportunistic sweep of expired buckets in rate_limit.py --
    # without it that DELETE would sequential-scan the whole table.
    "CREATE INDEX IF NOT EXISTS idx_rate_limit_expires ON rate_limit_buckets(expires_at)",
    # Removed 2026-09: the Tapetide integration. Blank every saved (encrypted)
    # user API key, then drop the column and the per-key quota table (which
    # held hashes of keys and daily call counts). Idempotent: the UPDATE only
    # runs while the column still exists, and the drops are IF EXISTS.
    """
    DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = current_schema() AND table_name = 'users'
                     AND column_name = 'tapetide_key_encrypted') THEN
            UPDATE users SET tapetide_key_encrypted = NULL WHERE tapetide_key_encrypted IS NOT NULL;
        END IF;
    END $$
    """,
    "ALTER TABLE users DROP COLUMN IF EXISTS tapetide_key_encrypted",
    "DROP TABLE IF EXISTS tapetide_quota",
]


def _dsn() -> str:
    dsn = get_settings().database_url
    if not dsn:
        raise RuntimeError(
            "DATABASE_URL is not set -- see CLAUDE.md's Neon Postgres setup. "
            "Locally, add it to backend/.env; in Vercel, set it as a project env var."
        )
    return dsn


# Bump whenever any statement in _SCHEMA_STATEMENTS or
# league_schema.LEAGUE_SCHEMA_STATEMENTS is added or changed -- otherwise
# already-migrated databases skip it (see init_db).
SCHEMA_VERSION = 3

# Arbitrary constant; serializes concurrent cold starts running the schema.
_SCHEMA_LOCK_KEY = 72_561_001


def init_db() -> None:
    """Idempotent -- safe to call on every cold start.

    Skips all schema work when the database already records SCHEMA_VERSION
    or newer: running every statement costs one round trip each, and with
    the league tables that's ~50 round trips added to every cold start. A
    newer stored version (an older deploy rolled back to) is also skipped,
    so a rollback never re-runs an older schema over a newer one."""
    with psycopg.connect(_dsn()) as conn:
        try:
            row = conn.execute("SELECT version FROM schema_version").fetchone()
            if row and row[0] >= SCHEMA_VERSION:
                return
        except psycopg.errors.UndefinedTable:
            conn.rollback()

        conn.execute("SELECT pg_advisory_xact_lock(%s)", (_SCHEMA_LOCK_KEY,))
        for statement in _SCHEMA_STATEMENTS + LEAGUE_SCHEMA_STATEMENTS:
            conn.execute(statement)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_version (
                id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
                version INTEGER NOT NULL,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        conn.execute(
            """
            INSERT INTO schema_version (id, version) VALUES (TRUE, %s)
            ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, applied_at = NOW()
            WHERE schema_version.version < EXCLUDED.version
            """,
            (SCHEMA_VERSION,),
        )
        conn.commit()


@contextmanager
def get_conn() -> Iterator[psycopg.Connection]:
    conn = psycopg.connect(_dsn(), row_factory=dict_row)
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()

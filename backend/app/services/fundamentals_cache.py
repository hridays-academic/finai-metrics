"""
Postgres-backed, cross-user cache for company fundamentals.

This is what makes yfinance viable as the PRIMARY fundamentals source (see
CLAUDE.md's "Sourcing" section): the data is identical for every visitor, so
one real upstream fetch can serve everyone who looks at that company until
it goes stale. Without it, going keyless would mean one yfinance call per
visitor per search, which is exactly the sustained request volume
yfinance_provider.py's docstring warns gets an IP throttled.

**Postgres, never an in-process dict.** Vercel's serverless functions don't
share memory between invocations -- consecutive requests routinely land on
different instances, so an in-memory cache would miss almost always while
looking like it worked in local dev. (main.py's `_last_company_by_ticker` is
an existing example of that trap, not a model to copy.)

Two freshness clocks, deliberately:

- **Statements (7 days)** -- revenue, balance sheet, prior-period balances,
  sector/industry, analyst consensus. These change quarterly, so a week-long
  TTL costs at most one real fetch per symbol per week.
- **Price overlay (15 minutes)** -- `current_price` and `market_cap` only.
  These move every trading day and feed P/E, P/B and dividend yield in
  metrics.py's valuation group. Serving a week-old price would make three
  ratios silently wrong, which is the exact failure mode this codebase
  avoids everywhere else. 15 minutes also matches the delay already present
  in this data (see LiveQuote.is_delayed), so it claims no more freshness
  than genuinely exists.

Nothing here ever raises on a cache failure: a read returns None (treated as
a miss) and a write is logged and dropped. A database hiccup should degrade
this to "fetch it live," never take down a request.

**No secrets are stored here.** Rows contain only a public ticker symbol and
public financial data -- never a Tapetide key, session token, or user id.
"""
import json
import logging
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterator, Optional

import psycopg

from app.models import AnalystConsensus, CompanyInfo, RawFinancials
from app.services.db import get_conn

logger = logging.getLogger("finai")

# See module docstring for why these two differ by so much.
STATEMENTS_TTL = timedelta(days=7)
PRICE_TTL = timedelta(minutes=15)

# Resolutions ("what the user typed" -> symbol) effectively never change --
# a ticker stops resolving only when a company delists or renames (e.g.
# ZOMATO -> ETERNAL). 30 days bounds how long a stale mapping can persist
# without making this a hot path again.
RESOLUTION_TTL = timedelta(days=30)


@contextmanager
def _using(conn: Optional[psycopg.Connection]) -> Iterator[psycopg.Connection]:
    """Reuse the caller's connection when given one, else open (and close)
    our own.

    Every function here takes an optional `conn` specifically so one request
    can serve its whole cache path -- resolution lookup, fundamentals
    lookup, price-overlay write -- over a single connection. Measured
    locally against Neon, opening a connection costs FAR more than running a
    query on an already-open one, so four independent `get_conn()` calls per
    request would be dominated almost entirely by connection setup. The
    caller owns commit/close for a connection it passes in (see db.get_conn,
    which commits on successful exit).
    """
    if conn is not None:
        yield conn
    else:
        with get_conn() as owned:
            yield owned


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    """psycopg returns TIMESTAMPTZ as tz-aware, but a column written by an
    older/other client could come back naive -- normalize so comparisons
    against _now() can never raise TypeError mid-request."""
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


@dataclass
class CachedFundamentals:
    """One cache row, already deserialized. `raw` has the stored price
    overlay applied (when one exists) -- see `get_fundamentals`."""

    symbol: str
    source: str
    info: CompanyInfo
    raw: RawFinancials
    consensus: Optional[AnalystConsensus]
    fetched_at: datetime
    price_fetched_at: Optional[datetime]

    @property
    def statements_fresh(self) -> bool:
        return _now() - self.fetched_at < STATEMENTS_TTL

    @property
    def price_fresh(self) -> bool:
        # No overlay yet means the price is however old the statement fetch
        # is -- fresh only if that fetch itself is within the price TTL.
        if self.price_fetched_at is None:
            return _now() - self.fetched_at < PRICE_TTL
        return _now() - self.price_fetched_at < PRICE_TTL

    @property
    def as_of(self) -> datetime:
        """The timestamp a user should be shown -- the most recent moment any
        part of this row was refreshed."""
        if self.price_fetched_at is None:
            return self.fetched_at
        return max(self.fetched_at, self.price_fetched_at)


def get_fundamentals(
    symbol: str, *, conn: Optional[psycopg.Connection] = None
) -> Optional[CachedFundamentals]:
    """Returns the cached row for `symbol`, fresh or stale, or None on a miss
    or any failure. Callers decide what to do with a stale row -- serving one
    is the correct graceful-degradation path when the upstream fetch fails
    (see main.py), so staleness is reported, never silently swallowed.

    The stored price overlay is always applied when present, even when it's
    itself past PRICE_TTL: a 20-minute-old price is still far better than the
    one embedded in a 7-day-old statement fetch.
    """
    try:
        with _using(conn) as c:
            row = c.execute(
                """
                SELECT symbol, source, info_json, raw_json, consensus_json,
                       fetched_at, price_json, price_fetched_at
                FROM company_fundamentals_cache WHERE symbol = %s
                """,
                (symbol,),
            ).fetchone()
    except Exception:  # noqa: BLE001 -- a cache miss is always survivable
        logger.warning("Fundamentals cache read failed for symbol=%s", symbol, exc_info=True)
        return None

    if not row:
        return None

    try:
        info = CompanyInfo.model_validate_json(row["info_json"])
        # model_validate_json round-trips None correctly, so a field that was
        # genuinely unavailable upstream stays None here rather than becoming
        # 0 or vanishing -- metrics.py depends on that distinction to render
        # "N/A" instead of a fabricated number.
        raw = RawFinancials.model_validate_json(row["raw_json"])
        consensus = (
            AnalystConsensus.model_validate_json(row["consensus_json"])
            if row["consensus_json"]
            else None
        )
    except Exception:  # noqa: BLE001 -- a corrupt/old-shaped row is a miss, not a 500
        logger.warning("Fundamentals cache row failed to parse for symbol=%s", symbol, exc_info=True)
        return None

    if row["price_json"]:
        try:
            overlay = json.loads(row["price_json"])
            # Only override fields the overlay actually carries a value for.
            # Applying them unconditionally would blank out a good
            # statement-fetch value whenever fast_info happened to return one
            # field but not the other (e.g. price present, market cap
            # missing) -- turning a cheap refresh into silent data loss, and
            # showing "N/A" for a metric we genuinely have a number for.
            update = {
                field: overlay[field]
                for field in ("current_price", "market_cap")
                if overlay.get(field) is not None
            }
            if update:
                raw = raw.model_copy(update=update)
        except Exception:  # noqa: BLE001 -- fall back to the statement-fetch price
            logger.warning("Price overlay failed to parse for symbol=%s", symbol, exc_info=True)

    return CachedFundamentals(
        symbol=row["symbol"],
        source=row["source"],
        info=info,
        raw=raw,
        consensus=consensus,
        fetched_at=_aware(row["fetched_at"]),
        price_fetched_at=_aware(row["price_fetched_at"]),
    )


def put_fundamentals(
    symbol: str,
    source: str,
    info: CompanyInfo,
    raw: RawFinancials,
    consensus: Optional[AnalystConsensus],
    *,
    conn: Optional[psycopg.Connection] = None,
) -> None:
    """Writes/refreshes the statement half of the row. Deliberately does NOT
    touch price_json/price_fetched_at: a fresh statement fetch carries its
    own price, but blanking the overlay column would discard a more recent
    one. The overlay is re-applied on the next read and refreshed on its own
    clock.

    ON CONFLICT DO UPDATE is atomic, so two Vercel instances fetching the
    same symbol concurrently is harmless -- both write valid, equivalent
    data and the last commit wins. No lock is taken on purpose: the worst
    case is one duplicated upstream call, far cheaper than coordinating.
    """
    try:
        with _using(conn) as c:
            c.execute(
                """
                INSERT INTO company_fundamentals_cache
                    (symbol, source, info_json, raw_json, consensus_json, fetched_at)
                VALUES (%s, %s, %s, %s, %s, NOW())
                ON CONFLICT (symbol) DO UPDATE SET
                    source = EXCLUDED.source,
                    info_json = EXCLUDED.info_json,
                    raw_json = EXCLUDED.raw_json,
                    consensus_json = EXCLUDED.consensus_json,
                    fetched_at = EXCLUDED.fetched_at
                """,
                (
                    symbol,
                    source,
                    info.model_dump_json(),
                    raw.model_dump_json(),
                    consensus.model_dump_json() if consensus is not None else None,
                ),
            )
    except Exception:  # noqa: BLE001 -- failing to cache must never fail the request
        logger.warning("Fundamentals cache write failed for symbol=%s", symbol, exc_info=True)


def put_price_overlay(
    symbol: str,
    current_price: Optional[float],
    market_cap: Optional[float],
    *,
    conn: Optional[psycopg.Connection] = None,
) -> None:
    """Refreshes only the price half of an existing row.

    A plain UPDATE, not an upsert: the overlay is only meaningful alongside
    cached statements, and the NOT NULL columns (source/info_json/raw_json)
    make a price-only INSERT impossible anyway. Zero rows updated (no
    statements cached yet) is a no-op, not an error.
    """
    if current_price is None and market_cap is None:
        return  # nothing worth storing; keep whatever overlay is already there
    try:
        with _using(conn) as c:
            c.execute(
                """
                UPDATE company_fundamentals_cache
                SET price_json = %s, price_fetched_at = NOW()
                WHERE symbol = %s
                """,
                (json.dumps({"current_price": current_price, "market_cap": market_cap}), symbol),
            )
    except Exception:  # noqa: BLE001
        logger.warning("Price overlay write failed for symbol=%s", symbol, exc_info=True)


def _normalize_query(query: str) -> str:
    return " ".join(query.strip().lower().split())


def get_resolution(
    query: str, *, conn: Optional[psycopg.Connection] = None
) -> Optional[tuple[str, str]]:
    """Cached (symbol, exchange) for a user-typed query, or None on a miss.

    Callers must still run main.py's `_looks_like_the_query` guard against
    the real fetched CompanyInfo afterwards -- this cache only skips the
    network round-trip, it does not vouch for the match being sensible.
    """
    key = _normalize_query(query)
    if not key:
        return None
    try:
        with _using(conn) as c:
            row = c.execute(
                "SELECT symbol, exchange, resolved_at FROM symbol_resolution_cache WHERE query = %s",
                (key,),
            ).fetchone()
    except Exception:  # noqa: BLE001
        logger.warning("Resolution cache read failed for query=%s", key, exc_info=True)
        return None

    if not row:
        return None
    resolved_at = _aware(row["resolved_at"])
    if resolved_at is not None and _now() - resolved_at > RESOLUTION_TTL:
        return None  # expired; let the caller re-resolve (handles renames/delistings)
    return row["symbol"], row["exchange"]


def put_resolution(
    query: str, symbol: str, exchange: str, *, conn: Optional[psycopg.Connection] = None
) -> None:
    key = _normalize_query(query)
    if not key:
        return
    try:
        with _using(conn) as c:
            c.execute(
                """
                INSERT INTO symbol_resolution_cache (query, symbol, exchange, resolved_at)
                VALUES (%s, %s, %s, NOW())
                ON CONFLICT (query) DO UPDATE SET
                    symbol = EXCLUDED.symbol,
                    exchange = EXCLUDED.exchange,
                    resolved_at = EXCLUDED.resolved_at
                """,
                (key, symbol, exchange),
            )
    except Exception:  # noqa: BLE001
        logger.warning("Resolution cache write failed for query=%s", key, exc_info=True)


def invalidate(symbol: str, *, conn: Optional[psycopg.Connection] = None) -> None:
    """Drops a symbol's cached fundamentals. Not called on the normal path --
    exists so a known-bad row (e.g. a delisted/renamed ticker) can be cleared
    without waiting out the TTL."""
    try:
        with _using(conn) as c:
            c.execute("DELETE FROM company_fundamentals_cache WHERE symbol = %s", (symbol,))
    except Exception:  # noqa: BLE001
        logger.warning("Fundamentals cache invalidate failed for symbol=%s", symbol, exc_info=True)

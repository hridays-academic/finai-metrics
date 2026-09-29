"""
Per-IP fixed-window rate limiting for the keyless data endpoints.

Exists because /api/company and /api/price-history need no API key or
sign-in (see CLAUDE.md's "Sourcing" section), so nothing else caps how much
traffic one visitor can generate. Without this, nothing stops a single client from
walking all ~8,200 NSE/BSE symbols and getting this app's server IP
throttled by Yahoo -- which would break the app for everyone, not just the
offender (see yfinance_provider.py's docstring on sustained request volume).

**Postgres, never an in-process dict.** Vercel's serverless functions don't
share memory between invocations, so an in-memory counter would reset
constantly and enforce essentially nothing while looking correct in local
dev -- the same cold-start trap documented in db.py and fundamentals_cache.py.

Fixed window rather than a sliding log: one atomic UPSERT per window per
request, no per-hit rows to store or sweep. The known trade-off is burst
behaviour at a window boundary (up to 2x the limit across two adjacent
windows). That's acceptable here -- the goal is stopping sustained scraping
and runaway client loops, not precise fairness.
"""
import logging
import random
import time
from dataclasses import dataclass
from typing import Optional

from app.services.db import get_conn

logger = logging.getLogger("finai")

# (window_seconds, max_requests). NOTE these count HTTP requests, not user
# actions: one company view fires two rate-limited requests (/api/company,
# then /api/price-history chained from info.resolved_symbol), so the
# user-visible allowance is half these numbers -- 20 company views/minute
# and 300/hour.
#
# Deliberately more generous than a single-user-per-IP model would suggest.
# This app's audience skews student, and a college campus, office, or Indian
# mobile carrier-grade NAT can put dozens of genuine users behind one public
# IP. Limits tight enough to be "correct" for one person would block a
# classroom -- a bad failure mode for a tool that just removed its signup
# gate specifically to reduce friction. These still stop a runaway refresh
# loop within seconds and make bulk scraping impractical.
WINDOWS: list[tuple[int, int]] = [
    (60, 40),
    (3600, 600),
]

# Expired rows are swept opportunistically rather than on every request (that
# would add a DELETE to every single call for no benefit). At ~2%, a
# moderately busy deployment sweeps every few dozen requests, and a quiet one
# leaves at most a handful of dead rows behind.
_SWEEP_PROBABILITY = 0.02


@dataclass
class RateLimitResult:
    allowed: bool
    retry_after: int = 0  # seconds until the offending window rolls over
    limit: int = 0        # the limit that was exceeded
    window_seconds: int = 0


def client_ip(headers: dict, fallback: Optional[str]) -> str:
    """Best available client IP.

    `x-forwarded-for` is checked LAST among the proxy headers on purpose.
    Proxies typically APPEND the connecting address to any XFF header the
    client already sent, so its first entry can be an attacker-supplied
    value -- trusting it blindly would let anyone rotate their apparent IP
    per request and bypass this entirely. Vercel's own
    `x-vercel-forwarded-for` (and `x-real-ip`) are set by the edge and can't
    be spoofed that way, so they win when present.

    If this is ever deployed behind a different proxy, verify which header
    that proxy guarantees before relying on the XFF fallback.
    """
    for header in ("x-vercel-forwarded-for", "x-real-ip"):
        value = headers.get(header)
        if value and value.strip():
            return value.split(",")[0].strip()

    forwarded = headers.get("x-forwarded-for")
    if forwarded and forwarded.strip():
        return forwarded.split(",")[0].strip()

    return fallback or "unknown"


def check(ip: str) -> RateLimitResult:
    """Counts this request against every window and reports whether it's
    allowed.

    Rejected requests still increment -- otherwise a client that's already
    over the limit could hammer the endpoint for free, which is exactly the
    traffic this is meant to suppress.

    **Fails OPEN.** If the database is unreachable the request is allowed,
    and the failure is logged. A limiter that turns a transient Postgres
    hiccup into a site-wide outage is worse than the abuse it prevents.
    That is a deliberate availability-over-enforcement trade-off, not an
    oversight -- if this app ever needs hard guarantees, this is the line to
    revisit.
    """
    now = int(time.time())
    try:
        with get_conn() as conn:
            for window_seconds, limit in WINDOWS:
                window_start = now - (now % window_seconds)
                bucket_key = f"{ip}:{window_seconds}:{window_start}"
                expires_at = window_start + window_seconds

                # Atomic: concurrent requests from the same IP (different
                # Vercel instances included) each get a distinct, correctly
                # ordered count back. No read-then-write race is possible.
                row = conn.execute(
                    """
                    INSERT INTO rate_limit_buckets (bucket_key, hits, expires_at)
                    VALUES (%s, 1, to_timestamp(%s))
                    ON CONFLICT (bucket_key) DO UPDATE
                        SET hits = rate_limit_buckets.hits + 1
                    RETURNING hits
                    """,
                    (bucket_key, expires_at),
                ).fetchone()

                hits = row["hits"] if row else 1
                if hits > limit:
                    return RateLimitResult(
                        allowed=False,
                        retry_after=max(1, expires_at - now),
                        limit=limit,
                        window_seconds=window_seconds,
                    )

            if random.random() < _SWEEP_PROBABILITY:
                conn.execute("DELETE FROM rate_limit_buckets WHERE expires_at < NOW()")
    except Exception:  # noqa: BLE001 -- see the fail-open note above
        logger.warning("Rate limit check failed -- allowing the request", exc_info=True)
        return RateLimitResult(allowed=True)

    return RateLimitResult(allowed=True)


def friendly_message(result: RateLimitResult) -> str:
    unit = "minute" if result.window_seconds == 60 else "hour"
    return (
        f"That's a lot of requests in a short time -- this app allows about "
        f"{result.limit // 2} company lookups per {unit} per network. "
        f"Please wait {result.retry_after} second(s) and try again."
    )

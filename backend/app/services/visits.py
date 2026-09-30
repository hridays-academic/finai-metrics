"""
First-party, aggregate page-load counter -- replaces Google Analytics.

Stores ONLY (day, page, count). No cookies, no IP addresses, no user ids,
no URLs. `page` must be one of PAGES: a fixed route name chosen by the
frontend, never a raw path or query string, so things like a password-reset
token (?reset_token=...), a profile handle or an event id can never end up
in this table. The day is India time, matching the audience.

Anyone can POST a count (the site has no sign-in requirement), so a bot can
inflate numbers; that's an accepted limit of a no-IP design. The per-IP rate
limiter is deliberately NOT applied here because it stores IP-derived keys.
"""
from app.services.db import get_conn

# Add a name here when a new page/route ships (the frontend sends these).
PAGES = frozenset({
    # current views
    "search", "calculator", "simulator", "trading", "reset_password", "admin",
    # Results League routes (Phase 2+)
    "league", "event", "reveal", "profile", "leagues", "practice",
})


def record(page: str) -> None:
    if page not in PAGES:
        raise ValueError(f"unknown page {page!r}")
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO page_visits_daily (day, page, count)
            VALUES ((now() AT TIME ZONE 'Asia/Kolkata')::date, %s, 1)
            ON CONFLICT (day, page) DO UPDATE SET count = page_visits_daily.count + 1
            """,
            (page,),
        )


def daily_counts(days: int) -> list[dict]:
    """Most recent first, covering the last `days` IST calendar days."""
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT day, page, count FROM page_visits_daily
            WHERE day > (now() AT TIME ZONE 'Asia/Kolkata')::date - %s
            ORDER BY day DESC, count DESC, page
            """,
            (days,),
        ).fetchall()
    return [{"day": r["day"].isoformat(), "page": r["page"], "count": r["count"]} for r in rows]

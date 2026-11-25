"""First-party measuring and problem reports (master plan phase 2; analytics
option (a), approved 2026-11-24): aggregate counts per day with no visitor id,
no IP and no cookie; error reports with a message, page and build only; and
"Something wrong? Tell us" messages (email only if given). Weekly numbers for
the admin page come from these counts plus signed-in students' own saved data.
"""
from datetime import date, timedelta
from typing import Optional

import psycopg

from app.services.db import get_conn

# Steps we count (add here when a feature ships; the frontend sends these).
EVENTS = frozenset({
    "guide_started", "guide_finished",
    "round_started", "round_submitted",
    "results_viewed", "signup_done",
})
MAX_MESSAGE = 300


def record_usage(event: str, page: str = "") -> None:
    if event not in EVENTS:
        raise ValueError(f"unknown event {event!r}")
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO usage_counts (day, event, page, count)
            VALUES ((now() AT TIME ZONE 'Asia/Kolkata')::date, %s, %s, 1)
            ON CONFLICT (day, event, page) DO UPDATE SET count = usage_counts.count + 1
            """,
            (event, page[:40]),
        )


def record_error(message: str, page: str = "", build: str = "", source: str = "browser",
                 conn: Optional[psycopg.Connection] = None) -> None:
    row = (source[:10], page[:80], build[:40], message[:MAX_MESSAGE])
    sql = "INSERT INTO client_errors (source, page, build, message) VALUES (%s, %s, %s, %s)"
    if conn is not None:
        conn.execute(sql, row)
        return
    with get_conn() as c:
        c.execute(sql, row)


def add_feedback(message: str, email: Optional[str], page: str = "") -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO feedback (page, message, email) VALUES (%s, %s, %s)",
            (page[:80], message[:1000], (email or None) and email[:200]),
        )


def recent_errors(limit: int = 100) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT created_at, source, page, build, message FROM client_errors ORDER BY id DESC LIMIT %s", (limit,)
        ).fetchall()
    return [{**r, "created_at": r["created_at"].isoformat()} for r in rows]


def recent_feedback(limit: int = 100) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT created_at, page, message, email FROM feedback ORDER BY id DESC LIMIT %s", (limit,)
        ).fetchall()
    return [{**r, "created_at": r["created_at"].isoformat()} for r in rows]


def _week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def weekly_numbers(weeks: int = 8) -> list[dict]:
    """By IST week (Monday start), newest first: visitors (page loads; there is
    no visitor id by design), guide completion, rounds per visit, returning
    signed-in students, forecasts submitted, and students who improved."""
    with get_conn() as conn:
        today = conn.execute("SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d").fetchone()["d"]
        since = _week_start(today) - timedelta(weeks=weeks - 1)
        loads = conn.execute(
            "SELECT date_trunc('week', day)::date AS w, sum(count) AS n FROM page_visits_daily "
            "WHERE day >= %s GROUP BY 1", (since,)).fetchall()
        steps = conn.execute(
            "SELECT date_trunc('week', day)::date AS w, event, sum(count) AS n FROM usage_counts "
            "WHERE day >= %s GROUP BY 1, 2", (since,)).fetchall()
        forecasts = conn.execute(
            "SELECT date_trunc('week', (submitted_at AT TIME ZONE 'Asia/Kolkata'))::date AS w, count(*) AS n "
            "FROM forecasts WHERE submitted_at >= %s GROUP BY 1", (since,)).fetchall()
        # Signed-in students active on two or more days in the week (forecasts or practice).
        returning = conn.execute(
            """
            SELECT w, count(*) AS n FROM (
              SELECT date_trunc('week', d)::date AS w, user_id FROM (
                SELECT user_id, (submitted_at AT TIME ZONE 'Asia/Kolkata')::date AS d FROM forecasts WHERE submitted_at >= %s
                UNION SELECT user_id, (created_at AT TIME ZONE 'Asia/Kolkata')::date FROM practice_attempts
                  WHERE created_at >= %s
              ) a GROUP BY 1, user_id HAVING count(DISTINCT d) >= 2
            ) b GROUP BY w
            """, (since, since)).fetchall()
        # Students whose average practice score this week beat their previous week's.
        improved = conn.execute(
            """
            WITH s AS (
              SELECT user_id, date_trunc('week', (created_at AT TIME ZONE 'Asia/Kolkata'))::date AS w, avg(total_points) AS a
              FROM practice_attempts WHERE created_at >= %s - interval '7 days'
              GROUP BY 1, 2)
            SELECT cur.w, count(*) AS n FROM s cur JOIN s prev
              ON prev.user_id = cur.user_id AND prev.w = cur.w - 7 AND cur.a > prev.a
            GROUP BY cur.w
            """, (since,)).fetchall()
    by = lambda rows: {r["w"]: int(r["n"]) for r in rows}  # noqa: E731
    loads_w, fc_w, ret_w, imp_w = by(loads), by(forecasts), by(returning), by(improved)
    step_w: dict = {}
    for r in steps:
        step_w.setdefault(r["w"], {})[r["event"]] = int(r["n"])
    out = []
    for k in range(weeks):
        w = _week_start(today) - timedelta(weeks=k)
        s = step_w.get(w, {})
        started, finished = s.get("guide_started", 0), s.get("guide_finished", 0)
        visits = loads_w.get(w, 0)
        out.append({
            "week": w.isoformat(),
            "visits": visits,
            "guide_started": started,
            "guide_completion_pct": round(100 * finished / started, 1) if started else None,
            "rounds_submitted": s.get("round_submitted", 0),
            "rounds_per_visit": round(s.get("round_submitted", 0) / visits, 2) if visits else None,
            "results_viewed": s.get("results_viewed", 0),
            "signups": s.get("signup_done", 0),
            "returning_students": ret_w.get(w, 0),
            "forecasts_submitted": fc_w.get(w, 0),
            "students_improved": imp_w.get(w, 0),
        })
    return out

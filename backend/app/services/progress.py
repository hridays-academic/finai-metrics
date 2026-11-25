"""
Progress (master plan phase 6; vault: Areas/Phase 6 plan). Levels only, as
decided at Stop 1: XP is never spent or lost, and nothing here can be bought.

- XP: 5 x the score of each scored league forecast (replaced, never added
  twice, when a result is corrected); practice first attempts (score / 20)
  and first-time cards (1 if inside + 1 if it beat the lazy guess) together
  at most DAILY_CAP a day, India time.
- Everything is computed here from saved, scored data; the browser never
  says how much XP it earned. Every new award and badge writes the audit log.
- Nothing is saved for anyone who may not forecast (signed out, waiting for
  consent, no handle yet): `may_save`.
"""
import math
from datetime import date
from typing import Optional

import psycopg
from pydantic import BaseModel

from app.services import audit
from app.services.league_service import _EFFECTIVE_STATUS, LeagueError, forecast_eligibility

LEAGUE_FACTOR = 5
PRACTICE_DIVISOR = 20
DAILY_CAP = 5
LEVEL_STEP = 20
HARD_LEVEL = 2
CALIBRATION_MIN_CARDS = 20
BEAT_LAZY_TIMES = 5

# Wording approved as 2.38 (decisions note).
BADGES = [
    ("well_calibrated", "Well calibrated", "80% ± 5 of 20 or more cards landed inside your range."),
    ("beat_lazy_5", "Beat the lazy guess 5 times", "Five numbers where your range's middle was closer than last year's figure."),
    ("full_season", "Full season", "A forecast on every company in a season."),
    ("first_daily", "First daily challenge", "You played a daily challenge."),
]

# Cosmetic unlocks (chosen in Settings, on each device).
UNLOCKS = [
    (2, "hard", "Hard companies in Practice and quick rounds"),
    (3, "ball_silver", "Silver ball"),
    (4, "slab_blue", "Blue slab"),
    (5, "ball_copper", "Copper ball"),
    (6, "slab_green", "Green slab"),
    (7, "ball_glass", "Glass ball"),
]


class BadgeOut(BaseModel):
    key: str
    name: str
    description: str
    earned_at: Optional[str]


class UnlockOut(BaseModel):
    level: int
    key: str
    name: str
    unlocked: bool


class BestsOut(BaseModel):
    quick_round: Optional[float]
    daily_challenge: Optional[float]
    league: Optional[float]
    practice: Optional[float]


class WeekOut(BaseModel):
    week_start: date
    cards: int
    hits: int


class MyForecastOut(BaseModel):
    event_id: int
    company: str
    season_label: str
    status: str  # open | locked | scored
    score: Optional[float]
    results_date: date


class ProgressOut(BaseModel):
    saving: bool  # False: nothing is saved for this account yet (see not_saved_reason)
    not_saved_reason: Optional[str]
    xp: int
    level: int
    level_start: int
    next_level: int
    xp_today_capped: int
    daily_cap: int
    days_played_this_term: int
    ranges: int  # league numbers and cards, for "Your ranges caught 7 of 10"
    ranges_inside: int
    weeks: list[WeekOut]
    badges: list[BadgeOut]
    bests: BestsOut
    unlocks: list[UnlockOut]
    forecasts: list[MyForecastOut]


# ---------- Pure ----------

def level_start(level: int) -> int:
    return LEVEL_STEP * level * (level - 1)


def level_for(xp: int) -> int:
    """Level n starts at 20 n (n - 1) XP: 2 at 40, 3 at 120, 4 at 240."""
    n = int((1 + math.sqrt(1 + 4 * max(0, xp) / LEVEL_STEP)) / 2)
    while level_start(n + 1) <= xp:
        n += 1
    while n > 1 and level_start(n) > xp:
        n -= 1
    return max(1, n)


def league_xp(event_score: float) -> int:
    return max(0, round(LEAGUE_FACTOR * event_score))


def practice_xp(event_score: float) -> int:
    return max(0, round(event_score / PRACTICE_DIVISOR))


def card_xp(hit: bool, beat_lazy: Optional[bool]) -> int:
    return int(hit) + int(bool(beat_lazy))


def term_start(today: date) -> date:
    """Terms run 1 April to 30 September and 1 October to 31 March."""
    if today.month >= 10:
        return date(today.year, 10, 1)
    if today.month >= 4:
        return date(today.year, 4, 1)
    return date(today.year - 1, 10, 1)


# ---------- Who may save ----------

def not_saved_reason(user: Optional[dict]) -> Optional[str]:
    if user is None:
        return "signed_out"
    try:
        forecast_eligibility(user)
    except LeagueError as exc:
        return {"guardian_consent_pending": "consent_pending"}.get(exc.code, exc.code)
    return None


def may_save(user: Optional[dict]) -> bool:
    return not_saved_reason(user) is None


def today(conn: psycopg.Connection) -> date:
    return conn.execute("SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d").fetchone()["d"]


# ---------- Awards ----------

def total_xp(conn: psycopg.Connection, user_id: int) -> int:
    return conn.execute("SELECT coalesce(sum(xp), 0) AS xp FROM xp_awards WHERE user_id = %s",
                        (user_id,)).fetchone()["xp"]


def level_of(conn: psycopg.Connection, user: Optional[dict]) -> int:
    return level_for(total_xp(conn, user["id"])) if user else 1


def _capped_today(conn: psycopg.Connection, user_id: int, day: date) -> int:
    return conn.execute(
        "SELECT coalesce(sum(xp), 0) AS xp FROM xp_awards WHERE user_id = %s AND day = %s AND source <> 'league'",
        (user_id, day),
    ).fetchone()["xp"]


def award_capped(conn: psycopg.Connection, user_id: int, source: str, ref: str, xp: int) -> int:
    """A practice or card award: once per (source, ref), within the daily cap.
    Returns the XP actually added (0 when already awarded or capped)."""
    day = today(conn)
    exists = conn.execute("SELECT 1 FROM xp_awards WHERE user_id = %s AND source = %s AND ref = %s",
                          (user_id, source, ref)).fetchone()
    if exists:
        return 0
    given = max(0, min(xp, DAILY_CAP - _capped_today(conn, user_id, day)))
    conn.execute(
        """INSERT INTO xp_awards (user_id, source, ref, xp, day) VALUES (%s, %s, %s, %s, %s)
           ON CONFLICT (user_id, source, ref) DO NOTHING""",
        (user_id, source, ref, given, day),
    )
    if given:
        audit.write(conn, None, "award", "xp", f"{user_id}:{source}:{ref}", {"xp": given, "earned": xp})
    return given


def award_league_event(conn: psycopg.Connection, event_id: int) -> None:
    """After (re)scoring an event: each forecast's award is set to 5 x its
    score, replacing any earlier award for it. Then badges are checked."""
    day = today(conn)
    rows = conn.execute(
        """SELECT f.id, f.user_id, avg(s.points) AS score FROM forecasts f JOIN scores s ON s.forecast_id = f.id
           WHERE f.event_id = %s GROUP BY f.id, f.user_id""",
        (event_id,),
    ).fetchall()
    for r in rows:
        xp = league_xp(r["score"])
        before = conn.execute(
            "SELECT xp FROM xp_awards WHERE user_id = %s AND source = 'league' AND ref = %s",
            (r["user_id"], f"forecast:{r['id']}"),
        ).fetchone()
        if before and before["xp"] == xp:
            continue
        conn.execute(
            """INSERT INTO xp_awards (user_id, source, ref, xp, day) VALUES (%s, 'league', %s, %s, %s)
               ON CONFLICT (user_id, source, ref) DO UPDATE SET xp = EXCLUDED.xp, updated_at = now()""",
            (r["user_id"], f"forecast:{r['id']}", xp, day),
        )
        audit.write(conn, None, "award", "xp", f"{r['user_id']}:league:forecast:{r['id']}",
                    {"xp": xp, "previous": before["xp"] if before else None})
    for user_id in {r["user_id"] for r in rows}:
        check_badges(conn, user_id)


# ---------- Badges ----------

def _earned(conn: psycopg.Connection, user_id: int) -> dict[str, bool]:
    cards = conn.execute(
        """SELECT count(*) AS n, count(*) FILTER (WHERE hit) AS hits, count(*) FILTER (WHERE beat_lazy) AS beat
           FROM card_answers WHERE user_id = %s""",
        (user_id,),
    ).fetchone()
    league_beat = conn.execute(
        """SELECT count(*) AS n FROM scores s JOIN forecasts f ON f.id = s.forecast_id
           WHERE f.user_id = %s AND s.beat_lazy""",
        (user_id,),
    ).fetchone()["n"]
    rate = cards["hits"] / cards["n"] if cards["n"] else 0
    full_season = conn.execute(
        """SELECT 1 FROM forecast_events e
           WHERE e.kind = 'league' AND e.status <> 'draft'
           GROUP BY e.season_label
           HAVING bool_and(e.status = 'scored')
              AND bool_and(EXISTS (SELECT 1 FROM forecasts f WHERE f.event_id = e.id AND f.user_id = %s))
           LIMIT 1""",
        (user_id,),
    ).fetchone() is not None
    daily = conn.execute("SELECT 1 FROM daily_attempts WHERE user_id = %s LIMIT 1", (user_id,)).fetchone() is not None
    return {
        "well_calibrated": cards["n"] >= CALIBRATION_MIN_CARDS and 0.75 <= rate <= 0.85,
        "beat_lazy_5": cards["beat"] + league_beat >= BEAT_LAZY_TIMES,
        "full_season": full_season,
        "first_daily": daily,
    }


def check_badges(conn: psycopg.Connection, user_id: int) -> list[str]:
    """Badges are kept once earned. Returns the newly earned keys."""
    new = []
    for key, ok in _earned(conn, user_id).items():
        if not ok:
            continue
        row = conn.execute(
            "INSERT INTO user_badges (user_id, badge_key) VALUES (%s, %s) ON CONFLICT DO NOTHING RETURNING badge_key",
            (user_id, key),
        ).fetchone()
        if row:
            new.append(key)
            audit.write(conn, None, "award", "badge", f"{user_id}:{key}", {})
    return new


def badge_name(key: str) -> str:
    return next(name for k, name, _ in BADGES if k == key)


# ---------- The profile ----------

def days_played(conn: psycopg.Connection, user_id: int, since: date) -> int:
    return conn.execute(
        """SELECT count(DISTINCT d) AS n FROM (
               SELECT (answered_at AT TIME ZONE 'Asia/Kolkata')::date AS d FROM card_answers WHERE user_id = %(u)s
               UNION SELECT (created_at AT TIME ZONE 'Asia/Kolkata')::date FROM practice_attempts WHERE user_id = %(u)s
               UNION SELECT (submitted_at AT TIME ZONE 'Asia/Kolkata')::date FROM forecasts WHERE user_id = %(u)s
               UNION SELECT day FROM daily_attempts WHERE user_id = %(u)s
           ) t WHERE d >= %(since)s""",
        {"u": user_id, "since": since},
    ).fetchone()["n"]


def profile(conn: psycopg.Connection, user: dict) -> ProgressOut:
    uid = user["id"]
    day = today(conn)
    xp = total_xp(conn, uid)
    level = level_for(xp)
    cards = conn.execute(
        "SELECT count(*) AS n, count(*) FILTER (WHERE hit) AS hits FROM card_answers WHERE user_id = %s", (uid,)
    ).fetchone()
    league = conn.execute(
        """SELECT count(*) AS n, count(*) FILTER (WHERE s.hit) AS hits FROM scores s
           JOIN forecasts f ON f.id = s.forecast_id WHERE f.user_id = %s""",
        (uid,),
    ).fetchone()
    weeks = [WeekOut(**r) for r in conn.execute(
        """SELECT date_trunc('week', answered_at AT TIME ZONE 'Asia/Kolkata')::date AS week_start,
                  count(*) AS cards, count(*) FILTER (WHERE hit) AS hits
           FROM card_answers WHERE user_id = %s AND answered_at > now() - interval '56 days'
           GROUP BY 1 ORDER BY 1""",
        (uid,),
    ).fetchall()]
    earned = {r["badge_key"]: r["earned_at"] for r in conn.execute(
        "SELECT badge_key, earned_at FROM user_badges WHERE user_id = %s", (uid,)).fetchall()}
    bests = conn.execute(
        """SELECT (SELECT max(score) FROM quick_round_attempts WHERE user_id = %(u)s) AS quick_round,
                  (SELECT max(score) FROM daily_attempts WHERE user_id = %(u)s) AS daily_challenge,
                  (SELECT max(sc) FROM (SELECT avg(s.points) AS sc FROM scores s JOIN forecasts f ON f.id = s.forecast_id
                                        WHERE f.user_id = %(u)s GROUP BY f.id) t) AS league,
                  (SELECT max(total_points) FROM practice_attempts WHERE user_id = %(u)s AND NOT is_replay) AS practice""",
        {"u": uid},
    ).fetchone()
    forecasts = [MyForecastOut(**r) for r in conn.execute(
        f"""SELECT e.id AS event_id, c.name AS company, e.season_label, ({_EFFECTIVE_STATUS}) AS status,
                   (SELECT avg(s.points) FROM scores s WHERE s.forecast_id = f.id) AS score, e.results_date
            FROM forecasts f JOIN forecast_events e ON e.id = f.event_id
            JOIN fiscal_periods p ON p.id = e.period_id JOIN companies c ON c.id = p.company_id
            WHERE f.user_id = %s AND e.kind = 'league' ORDER BY e.results_date DESC""",
        (uid,),
    ).fetchall()]
    reason = not_saved_reason(user)
    return ProgressOut(
        saving=reason is None, not_saved_reason=reason, xp=xp, level=level, level_start=level_start(level),
        next_level=level_start(level + 1), xp_today_capped=_capped_today(conn, uid, day), daily_cap=DAILY_CAP,
        days_played_this_term=days_played(conn, uid, term_start(day)),
        ranges=cards["n"] + league["n"], ranges_inside=cards["hits"] + league["hits"], weeks=weeks,
        badges=[BadgeOut(key=k, name=n, description=d,
                         earned_at=earned[k].isoformat() if k in earned else None) for k, n, d in BADGES],
        bests=BestsOut(**bests),
        unlocks=[UnlockOut(level=lv, key=k, name=n, unlocked=level >= lv) for lv, k, n in UNLOCKS],
        forecasts=forecasts,
    )

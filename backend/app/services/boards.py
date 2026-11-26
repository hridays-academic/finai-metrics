"""
Leaderboards (master plan phase 6: E5, X3, SC9; vault: Areas/Phase 6 plan).

Ranked by average score with a minimum, never by volume. Handles only.
Nobody appears who hid themselves (Settings), has no handle, is waiting for
a parent's consent, or whose handle is under review or blocked. Class boards
arrive with classes (phase 8).

Also the handle filter: a blocklist (English and romanised Hindi, in
backend/data/handle_blocklist.txt) refuses a handle; admins can put any
handle under review or block it.
"""
import re
from functools import lru_cache
from pathlib import Path
from typing import Literal, Optional

import psycopg
from pydantic import BaseModel

from app.services import audit
from app.services.league_service import LeagueError

WEEK_MIN_CARDS = 20
SEASON_MIN_FORECASTS = 3
TOP = 50

# Shown on a board: wording 2.39.
TITLES = {"week": "This week", "season": "This season", "improved": "Most improved this week"}

_ON_BOARDS = """
    u.deleted_at IS NULL AND u.handle IS NOT NULL AND NOT u.leaderboard_opt_out AND u.handle_status = 'ok'
    AND (u.age_band = '18_plus' OR (u.age_band = 'under_18' AND u.guardian_consent_status = 'granted'))
"""

_WEEK = "date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata')"


class BoardRow(BaseModel):
    rank: int
    handle: str
    value: float
    count: int
    you: bool


class BoardOut(BaseModel):
    board: Literal["week", "season", "improved"]
    title: str
    season_label: Optional[str]
    minimum: int
    rows: list[BoardRow]
    you: Optional[BoardRow]  # your own row when you're on the board but outside the top rows
    your_status: Optional[str]  # hidden | consent_pending | no_handle | under_review | too_few | None


def _week_rows(conn: psycopg.Connection, start_sql: str, end_sql: str) -> list[dict]:
    return conn.execute(
        f"""SELECT u.id, u.handle, avg(ca.points) AS value, count(*) AS n
            FROM card_answers ca JOIN users u ON u.id = ca.user_id
            WHERE {_ON_BOARDS}
              AND (ca.answered_at AT TIME ZONE 'Asia/Kolkata') >= {start_sql}
              AND (ca.answered_at AT TIME ZONE 'Asia/Kolkata') < {end_sql}
            GROUP BY u.id, u.handle HAVING count(*) >= %(min)s""",
        {"min": WEEK_MIN_CARDS},
    ).fetchall()


def latest_season(conn: psycopg.Connection) -> Optional[str]:
    row = conn.execute(
        """SELECT season_label FROM forecast_events WHERE kind = 'league' AND status = 'scored'
           ORDER BY results_date DESC LIMIT 1"""
    ).fetchone()
    return row["season_label"] if row else None


def board(conn: psycopg.Connection, which: str, user: Optional[dict], members: Optional[set[int]] = None) -> BoardOut:
    """`members`: a class board (phase 8) keeps only the class's students."""
    season = None
    if which == "week":
        raw = [(r["id"], r["handle"], r["value"], r["n"]) for r in _week_rows(conn, _WEEK, f"{_WEEK} + interval '7 days'")]
        minimum = WEEK_MIN_CARDS
    elif which == "improved":
        now = {r["id"]: r for r in _week_rows(conn, _WEEK, f"{_WEEK} + interval '7 days'")}
        before = {r["id"]: r for r in _week_rows(conn, f"{_WEEK} - interval '7 days'", _WEEK)}
        raw = [(i, r["handle"], r["value"] - before[i]["value"], r["n"]) for i, r in now.items() if i in before]
        minimum = WEEK_MIN_CARDS
    elif which == "season":
        season = latest_season(conn)
        rows = conn.execute(
            f"""SELECT u.id, u.handle, avg(t.score) AS value, count(*) AS n FROM (
                    SELECT f.user_id, avg(s.points) AS score FROM forecasts f
                    JOIN scores s ON s.forecast_id = f.id JOIN forecast_events e ON e.id = f.event_id
                    WHERE e.kind = 'league' AND e.season_label = %(season)s GROUP BY f.id, f.user_id) t
                JOIN users u ON u.id = t.user_id
                WHERE {_ON_BOARDS}
                GROUP BY u.id, u.handle HAVING count(*) >= %(min)s""",
            {"season": season, "min": SEASON_MIN_FORECASTS},
        ).fetchall() if season else []
        raw = [(r["id"], r["handle"], r["value"], r["n"]) for r in rows]
        minimum = SEASON_MIN_FORECASTS
    else:
        raise LeagueError(404, "no_such_board", "That board doesn't exist.")
    if members is not None:
        raw = [r for r in raw if r[0] in members]
    raw.sort(key=lambda r: (-r[2], r[1].lower()))
    me = user["id"] if user else None
    ranked = [BoardRow(rank=i + 1, handle=h, value=round(v, 1), count=n, you=uid == me)
              for i, (uid, h, v, n) in enumerate(raw)]
    mine = next((r for r in ranked if r.you), None)
    return BoardOut(board=which, title=TITLES[which], season_label=season, minimum=minimum, rows=ranked[:TOP],
                    you=mine if mine and mine.rank > TOP else None,
                    your_status=None if mine or not user else _status(user))


def _status(user: dict) -> str:
    if user.get("leaderboard_opt_out"):
        return "hidden"
    if not user.get("handle"):
        return "no_handle"
    if user.get("age_band") == "under_18" and user.get("guardian_consent_status") != "granted":
        return "consent_pending"
    if user.get("handle_status", "ok") != "ok":
        return "under_review"
    return "too_few"


def set_opt_out(conn: psycopg.Connection, user: dict, hidden: bool) -> None:
    conn.execute("UPDATE users SET leaderboard_opt_out = %s WHERE id = %s", (hidden, user["id"]))


# ---------- The handle filter ----------

BLOCKLIST_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "handle_blocklist.txt"
_LOOKALIKE = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s",
                            "!": "i", "|": "i"})


@lru_cache(maxsize=1)
def blocklist() -> tuple[str, ...]:
    lines = BLOCKLIST_PATH.read_text(encoding="utf-8").splitlines()
    return tuple(w.strip().lower() for w in lines if w.strip() and not w.startswith("#"))


def handle_words(handle: str, lookalikes: bool = True) -> list[str]:
    """A7 (Stop 3): the words in a handle. Split at camelCase, then at
    anything that isn't a letter or a look-alike character. With
    `lookalikes`, digits and symbols inside a word read as letters ("sh1t");
    without, they're dropped ("nazi88"). Decoration x's at either end
    ("xXname") are trimmed when checking (handle_allowed)."""
    spaced = re.sub(r"([a-z])([A-Z])", r"\1 \2", handle)
    words = []
    for raw in re.split(r"[^A-Za-z0-9@$!|]+", spaced):
        w = raw.lower()
        if lookalikes and re.search(r"[a-z]", w):
            w = w.translate(_LOOKALIKE)
        w = re.sub(r"[^a-z]", "", w)
        if w:
            words.append(w)
    return words


def handle_allowed(handle: str) -> bool:
    """Refused when a word, or the whole handle run together, is a blocked
    word, in either reading. Whole words only: "Kshitij" is fine,
    "Gandu_99" isn't."""
    blocked = set(blocklist())
    for words in (handle_words(handle, True), handle_words(handle, False)):
        joined = "".join(words)
        if any(w in blocked or w.strip("x") in blocked for w in words + [joined]):
            return False
    return True


class HandleReviewOut(BaseModel):
    user_id: int
    handle: str
    handle_status: str


def handles_for_review(conn: psycopg.Connection) -> list[HandleReviewOut]:
    return [HandleReviewOut(**r) for r in conn.execute(
        """SELECT id AS user_id, handle, handle_status FROM users
           WHERE handle IS NOT NULL AND deleted_at IS NULL AND handle_status <> 'ok' ORDER BY handle"""
    ).fetchall()]


def set_handle_status(conn: psycopg.Connection, actor: dict, user_id: int, status: str) -> None:
    if status not in ("ok", "review", "blocked"):
        raise LeagueError(422, "bad_status", "Choose ok, review or blocked.")
    row = conn.execute("UPDATE users SET handle_status = %s WHERE id = %s AND deleted_at IS NULL RETURNING id",
                       (status, user_id)).fetchone()
    if row is None:
        raise LeagueError(404, "user_not_found", "No such user.")
    audit.write(conn, actor["id"], "update", "handle_status", user_id, {"status": status})

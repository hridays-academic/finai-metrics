"""Quick rounds (phase 5, E1) and the daily challenge (phase 6, E3): one card
is one number from the practice pool (practice._practice_rows, which applies
the answer-leak rule), answered with a range and scored with the league's own
scoring. The card list never holds the answer; /reveal scores one card for
the reveal, and /rounds re-scores the whole round on the server (combos and
the gold card included), saves it for students who may save, and awards XP
and badges (services/progress.py). League figures only, never Yahoo.
"""
import random
from datetime import date
from typing import Literal, Optional

import psycopg
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from app.league_config import market_config
from app.services import practice, progress, scoring
from app.services.league_admin import year_ago_label
from app.services.league_scoring import _actuals, _matching, _student_notes
from app.services.league_service import LeagueError


class PlayCard(BaseModel):
    id: str
    sector: str
    sector_name: str
    difficulty: Optional[str]
    name: Optional[str]  # None in Mystery mode
    mystery_line: Optional[str]
    quarter: Optional[str]  # "Q2 FY27"; None in Mystery mode
    metric_key: str
    label: str
    unit: str
    last_year: Optional[float]
    last_quarter: Optional[float]
    min_value: float
    max_value: float


class RevealIn(BaseModel):
    low: float
    high: float


class RevealOut(BaseModel):
    actual: float
    hit: bool
    points: float
    beat_lazy: Optional[bool]
    missed_by: float
    lazy: Optional[float]
    note: Optional[str]
    name: str
    quarter: str


def _card_id(event_id: int, index: int) -> str:
    return f"{practice.code_for(event_id)}-{index}"


def _parse(card_id: str) -> tuple[int, int]:
    code, _, idx = card_id.partition("-")
    event_id = practice.event_for(code)
    if event_id is None or not idx.isdigit():
        raise LeagueError(404, "card_not_found", "That card doesn't exist.")
    return event_id, int(idx)


def _previous_quarter(fy: str, q: int) -> tuple[str, int]:
    return (year_ago_label(fy), 4) if q == 1 else (fy, q - 1)


def cards(conn: psycopg.Connection, mystery: bool, hard_ok: bool = True) -> list[PlayCard]:
    """Every card in the pool; Hard ones only from Level 2 (`hard_ok`)."""
    out = []
    for row in practice._practice_rows(conn):
        cut = practice._cut_quarters(practice._cached_quarters(conn, row["provider_symbol"]), row)
        level = practice.difficulty(cut)
        if level == "hard" and not hard_ok:
            continue
        year_ago = _actuals(conn, row["company_id"], year_ago_label(row["fiscal_year_label"]), row["fiscal_quarter"])
        pfy, pq = _previous_quarter(row["fiscal_year_label"], row["fiscal_quarter"])
        prev = _actuals(conn, row["company_id"], pfy, pq)
        for i, m in enumerate(row["metric_definitions"]["metrics"]):
            out.append(PlayCard(
                id=_card_id(row["id"], i), sector=row["sector"], sector_name=practice._sector_name(row),
                difficulty=level, name=None if mystery else row["company_name"],
                mystery_line=practice._mystery_line(row) if mystery else None,
                quarter=None if mystery else row["season_label"],
                metric_key=m["key"], label=m["label"], unit=m["unit"],
                last_year=_matching(year_ago, m), last_quarter=_matching(prev, m),
                min_value=m.get("min_value", -100.0), max_value=m.get("max_value", 500.0),
            ))
    return out


class _Scored(BaseModel):
    event_id: int
    metric_key: str
    reveal: RevealOut


def _score_card(conn: psycopg.Connection, card_id: str, low: float, high: float) -> _Scored:
    event_id, index = _parse(card_id)
    row = practice._load(conn, practice.code_for(event_id))
    metrics = row["metric_definitions"]["metrics"]
    if index >= len(metrics):
        raise LeagueError(404, "card_not_found", "That card doesn't exist.")
    m = metrics[index]
    low, high = min(low, high), max(low, high)
    if not (m.get("min_value", -1e9) <= low and high <= m.get("max_value", 1e9)):
        raise LeagueError(422, "out_of_bounds", "That range is outside what this number can be.")
    actual = practice._complete(conn, row)[m["key"]]
    lazy = _matching(_actuals(conn, row["company_id"], year_ago_label(row["fiscal_year_label"]),
                              row["fiscal_quarter"]), m)
    s = scoring.score_metric(m["key"], low, high, actual, lazy, market_config(row["market_code"]).scoring)
    missed_by = 0.0 if s.hit else (low - actual if actual < low else actual - high)
    note = _student_notes(row, practice._complete(conn, row)).get(m["key"])
    return _Scored(event_id=event_id, metric_key=m["key"], reveal=RevealOut(
        actual=actual, hit=s.hit, points=s.points, beat_lazy=s.beat_lazy, missed_by=round(missed_by, 4),
        lazy=lazy, note=note, name=row["company_name"], quarter=row["season_label"]))


def reveal(conn: psycopg.Connection, card_id: str, body: RevealIn) -> RevealOut:
    return _score_card(conn, card_id, body.low, body.high).reveal


# ---------- Whole rounds (phase 6) ----------

GOLD_BONUS = 20
ROUND_MAX = 10
DAILY_SIZE = 10
DAILY_AVERAGE_MIN = 5  # players before today's average is shown


def combo_multiplier(streak: int) -> int:
    """The same rule as the browser's lib/quickRound.ts."""
    return 3 if streak >= 5 else 2 if streak >= 3 else 1


def round_total(results: list[RevealOut], gold_index: Optional[int]) -> float:
    total, streak = 0.0, 0
    for i, r in enumerate(results):
        streak = streak + 1 if r.hit else 0
        total += r.points * (combo_multiplier(streak) if r.hit else 1)
        if r.hit and gold_index == i:
            total += GOLD_BONUS
    return round(total, 4)


class RoundAnswerIn(BaseModel):
    card_id: str = Field(max_length=40)
    low: float
    high: float


class RoundIn(BaseModel):
    kind: Literal["quick", "daily"]
    answers: list[RoundAnswerIn] = Field(min_length=1, max_length=ROUND_MAX)
    gold_index: Optional[int] = Field(default=None, ge=1, le=ROUND_MAX - 1)


class RoundOut(BaseModel):
    score: float
    hits: int
    cards: int
    saved: bool
    not_saved_reason: Optional[str]  # signed_out | consent_pending | profile_required | already_played ...
    xp_gained: int
    xp: Optional[int]
    level: Optional[int]
    best: Optional[float]  # quick rounds: your best; daily: today's saved score
    new_badges: list[str]


def submit_round(conn: psycopg.Connection, user: Optional[dict], body: RoundIn) -> RoundOut:
    ids = [a.card_id for a in body.answers]
    if len(set(ids)) != len(ids):
        raise LeagueError(422, "duplicate_card", "Each card can be answered once in a round.")
    day = progress.today(conn)
    if body.kind == "daily":
        if sorted(ids) != sorted(_daily_ids(conn, day)):
            raise LeagueError(422, "not_todays_cards", "Those aren't today's daily challenge cards.")
    scored = [_score_card(conn, a.card_id, a.low, a.high) for a in body.answers]
    results = [x.reveal for x in scored]
    gold = body.gold_index if body.kind == "quick" and body.gold_index is not None and body.gold_index < len(ids) else None
    total = round_total(results, gold)
    hits = sum(r.hit for r in results)
    reason = progress.not_saved_reason(user)
    if reason is None and body.kind == "daily" and conn.execute(
            "SELECT 1 FROM daily_attempts WHERE user_id = %s AND day = %s", (user["id"], day)).fetchone():
        reason = "already_played"
    if reason is not None:
        return RoundOut(score=total, hits=hits, cards=len(results), saved=False, not_saved_reason=reason,
                        xp_gained=0, xp=None, level=None, best=None, new_badges=[])
    uid = user["id"]
    gained = 0
    for a, x in zip(body.answers, scored):
        first = conn.execute(
            """INSERT INTO card_answers (user_id, card_id, event_id, metric_key, low, high, hit, points, beat_lazy, mode)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT (user_id, card_id) DO NOTHING RETURNING card_id""",
            (uid, a.card_id, x.event_id, x.metric_key, min(a.low, a.high), max(a.low, a.high), x.reveal.hit,
             x.reveal.points, x.reveal.beat_lazy, body.kind),
        ).fetchone()
        if first:
            gained += progress.award_capped(conn, uid, "card", f"card:{a.card_id}",
                                            progress.card_xp(x.reveal.hit, x.reveal.beat_lazy))
    if body.kind == "quick":
        conn.execute("INSERT INTO quick_round_attempts (user_id, cards, hits, score) VALUES (%s, %s, %s, %s)",
                     (uid, len(results), hits, total))
        best = conn.execute("SELECT max(score) AS b FROM quick_round_attempts WHERE user_id = %s", (uid,)).fetchone()["b"]
    else:
        conn.execute("INSERT INTO daily_attempts (user_id, day, score, hits, cards) VALUES (%s, %s, %s, %s, %s)",
                     (uid, day, total, hits, len(results)))
        best = total
    new = progress.check_badges(conn, uid)
    xp = progress.total_xp(conn, uid)
    return RoundOut(score=total, hits=hits, cards=len(results), saved=True, not_saved_reason=None, xp_gained=gained,
                    xp=xp, level=progress.level_for(xp), best=best, new_badges=[progress.badge_name(k) for k in new])


# ---------- The daily challenge (phase 6) ----------

class DailyOut(BaseModel):
    day: date
    cards: list[PlayCard]
    played: bool
    my_score: Optional[float]
    average: Optional[float]  # only once DAILY_AVERAGE_MIN students have played today


def pick_daily(bank: list[PlayCard], day: date) -> list[str]:
    """The same cards for everyone on a date: a shuffle seeded by the day,
    then one sector at a time so the ten are mixed."""
    rand = random.Random(day.toordinal())
    shuffled = sorted(bank, key=lambda c: c.id)
    rand.shuffle(shuffled)
    queues: dict[str, list[PlayCard]] = {}
    for c in shuffled:
        queues.setdefault(c.sector, []).append(c)
    out: list[str] = []
    while len(out) < DAILY_SIZE and any(queues.values()):
        for q in queues.values():
            if q and len(out) < DAILY_SIZE:
                out.append(q.pop(0).id)
    return out


def _daily_ids(conn: psycopg.Connection, day: date) -> list[str]:
    row = conn.execute("SELECT card_ids FROM daily_challenges WHERE day = %s", (day,)).fetchone()
    if row is None:
        ids = pick_daily(cards(conn, mystery=True), day)
        if not ids:
            return []
        conn.execute("INSERT INTO daily_challenges (day, card_ids) VALUES (%s, %s) ON CONFLICT (day) DO NOTHING",
                     (day, Jsonb(ids)))
        row = conn.execute("SELECT card_ids FROM daily_challenges WHERE day = %s", (day,)).fetchone()
    # A card whose quarter a public page has started to show since it was
    # picked drops out for the rest of the day (shown_quarters.py); daily()
    # and submit_round() both read this, so a submitted round still matches.
    live = {c.id for c in cards(conn, mystery=True)}
    return [i for i in row["card_ids"] if i in live]


def daily(conn: psycopg.Connection, user: Optional[dict], mystery: bool) -> DailyOut:
    day = progress.today(conn)
    ids = _daily_ids(conn, day)
    by_id = {c.id: c for c in cards(conn, mystery)}
    mine = conn.execute("SELECT score FROM daily_attempts WHERE user_id = %s AND day = %s",
                        (user["id"], day)).fetchone() if user else None
    avg = conn.execute("SELECT avg(score) AS a, count(*) AS n FROM daily_attempts WHERE day = %s", (day,)).fetchone()
    return DailyOut(day=day, cards=[by_id[i] for i in ids if i in by_id], played=mine is not None,
                    my_score=mine["score"] if mine else None,
                    average=round(avg["a"], 1) if avg["n"] >= DAILY_AVERAGE_MIN else None)

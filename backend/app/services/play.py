"""Quick rounds (master plan phase 5, E1): one card is one number from an
approved, scored result (the events practice offers), answered with a range
and scored at once with the league's own scoring. The card list never holds
the answer; /reveal scores one card and returns it. Nothing is stored yet
(saving, XP and the daily challenge come in phase 6). League figures only,
never Yahoo.
"""
from typing import Optional

import psycopg
from pydantic import BaseModel, Field

from app.league_config import market_config
from app.services import practice, scoring
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


def cards(conn: psycopg.Connection, mystery: bool) -> list[PlayCard]:
    out = []
    for row in practice._practice_rows(conn):
        cut = practice._cut_quarters(practice._cached_quarters(conn, row["provider_symbol"]), row)
        level = practice.difficulty(cut)
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


def reveal(conn: psycopg.Connection, card_id: str, body: RevealIn) -> RevealOut:
    event_id, index = _parse(card_id)
    row = practice._load(conn, practice.code_for(event_id))
    metrics = row["metric_definitions"]["metrics"]
    if index >= len(metrics):
        raise LeagueError(404, "card_not_found", "That card doesn't exist.")
    m = metrics[index]
    low, high = min(body.low, body.high), max(body.low, body.high)
    if not (m.get("min_value", -1e9) <= low and high <= m.get("max_value", 1e9)):
        raise LeagueError(422, "out_of_bounds", "That range is outside what this number can be.")
    actual = practice._complete(conn, row)[m["key"]]
    lazy = _matching(_actuals(conn, row["company_id"], year_ago_label(row["fiscal_year_label"]),
                              row["fiscal_quarter"]), m)
    s = scoring.score_metric(m["key"], low, high, actual, lazy, market_config(row["market_code"]).scoring)
    missed_by = 0.0 if s.hit else (low - actual if actual < low else actual - high)
    note = _student_notes(row, practice._complete(conn, row)).get(m["key"])
    return RevealOut(actual=actual, hit=s.hit, points=s.points, beat_lazy=s.beat_lazy, missed_by=round(missed_by, 4),
                     lazy=lazy, note=note, name=row["company_name"], quarter=row["season_label"])

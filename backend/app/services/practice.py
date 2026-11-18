"""
Practice (2026-11-18, plan approved by Hriday; vault: Areas/First-visit guide
and Practice). Students forecast a past quarter whose results are already
scored, and get their score straight away.

- **Which quarters:** scored league events of non-demo companies whose every
  metric has a saved result under the event's own definition. Answers are
  always the approved league results and the lazy guesses as scored
  (`baselines`); Yahoo figures are never answers.
- **The "as of" cut, on the server:** the browser never receives anything
  from after forecasts for that quarter closed. Quarters (Yahoo's and the
  league's) only before the quarter being forecast; share prices only up to
  the earlier of the lock and today minus 30 days, with price_lag's weekly
  rule.
- **Mystery mode:** no name, ticker, season, results date, source link,
  research tip or fetch date. Dates go on a relative calendar: the quarter
  being forecast is placed in year 100 and every other date moves by the
  same whole number of years, so months and quarter order stay true and the
  real year is hidden. Revenue and the share price are always shown as an
  index (first = 100), never absolute figures (league decision: "Practice
  shows revenue indexed, never absolute figures").
- **Saving:** a signed-in student who may forecast (forecast_eligibility)
  has every attempt saved; the first one per company is their practice
  score, later ones are marked as replays (a partial unique index makes the
  database guarantee one first try). Signed out or not eligible: scored and
  shown, nothing stored. Practice never writes forecasts or scores.
"""
import json
from datetime import date, datetime, timedelta
from typing import Optional

import psycopg

from app.league_config import market_config
from app.league_models import (
    ForecastIn, ForecastValueIn, MetricDefinitionOut, MetricResultOut, PracticeActualOut, PracticeAttemptIn,
    PracticeAttemptOut, PracticeCardOut, PracticeCaseOut, PracticeMineOut, PracticePricePoint, PracticePricesOut,
    PracticeQuarterOut, PracticeRevealOut,
)
from app.models import PricePoint
from app.services import league_admin, scoring
from app.services.league_scoring import _actuals, _matching, _student_notes
from app.services.league_service import (
    _EVENT_SELECT, LeagueError, _show_demo, _validate_forecast, forecast_eligibility,
)
from app.services.price_lag import PRICE_LAG_DAYS
from app.services.research_history import PROVIDER_DEFINITION, PROVIDER_SOURCE

QUARTERS_SHOWN = 8
PRICE_WEEKS = 52
MYSTERY_YEAR = 100

# ---------- Short codes ----------
# The address carries a short code made from the event id, so a practice
# page doesn't point at #/event/<id>. Not a secret (past results are public),
# just not the obvious number.
_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"
_MOD = 36 ** 6
_MUL = 1_000_003  # prime, so it has an inverse mod 36^6
_INV = pow(_MUL, -1, _MOD)


def code_for(event_id: int) -> str:
    n = (event_id * _MUL) % _MOD
    out = ""
    for _ in range(6):
        n, r = divmod(n, 36)
        out = _ALPHABET[r] + out
    return out


def event_for(code: str) -> Optional[int]:
    if len(code) != 6 or any(c not in _ALPHABET for c in code):
        return None
    n = 0
    for c in code:
        n = n * 36 + _ALPHABET.index(c)
    return (n * _INV) % _MOD or None


# ---------- Which events ----------

def _not_found() -> LeagueError:
    return LeagueError(404, "practice_not_found", "That practice company doesn't exist.")


def _complete(conn: psycopg.Connection, row: dict) -> dict[str, float]:
    """Every metric's saved result under the event's own definition, or {}
    if any is missing (such an event isn't offered for practice)."""
    current = _actuals(conn, row["company_id"], row["fiscal_year_label"], row["fiscal_quarter"])
    actual = {m["key"]: _matching(current, m) for m in row["metric_definitions"]["metrics"]}
    return {} if any(v is None for v in actual.values()) else actual  # type: ignore[return-value]


def _practice_rows(conn: psycopg.Connection) -> list[dict]:
    rows = conn.execute(
        _EVENT_SELECT + " AND e.status = 'scored' ORDER BY e.results_date DESC, c.name",
        {"user_id": 0, "show_demo": _show_demo()},
    ).fetchall()
    return [r for r in rows if _complete(conn, r)]


def _load(conn: psycopg.Connection, code: str) -> dict:
    event_id = event_for(code)
    if event_id is None:
        raise _not_found()
    row = conn.execute(
        _EVENT_SELECT + " AND e.id = %(event_id)s AND e.status = 'scored'",
        {"user_id": 0, "show_demo": _show_demo(), "event_id": event_id},
    ).fetchone()
    if row is None or not _complete(conn, row):
        raise _not_found()
    return row


def _sector_name(row: dict) -> str:
    explainer = market_config(row["market_code"]).sector_explainers.get(row["sector"])
    return explainer.display_name if explainer else row["sector"]


def _mystery_line(row: dict) -> Optional[str]:
    return market_config(row["market_code"]).mystery_descriptions.get(row["ticker"])


def _description(row: dict) -> Optional[str]:
    return row["description"] or market_config(row["market_code"]).company_descriptions.get(row["ticker"])


# ---------- The relative calendar (Mystery mode) ----------

def _shift_date(d: date, years: int) -> date:
    try:
        return d.replace(year=d.year - years)
    except ValueError:  # 29 Feb in a year without one
        return d.replace(year=d.year - years, day=28)


def _shown_date(d: date, row: dict, mystery: bool) -> str:
    if not mystery:
        return d.isoformat()
    return _shift_date(d, row["period_end_date"].year - MYSTERY_YEAR).isoformat()


# ---------- Difficulty (mirror of frontend lib/difficulty.ts) ----------

def _months_between(a: date, b: date) -> int:
    return (b.year - a.year) * 12 + (b.month - a.month)


def difficulty(rows: list[tuple[date, Optional[float], Optional[float]]]) -> Optional[str]:
    """rows: (quarter end, revenue, margin %). Same bands as difficulty.ts:
    margin range under 3 / 3-7 / over 7 points; swing in quarter-to-quarter
    revenue change under 10 / 10-25 / over 25 points; the harder band wins."""
    margins = [m for _, _, m in rows if m is not None]
    margin_range = max(margins) - min(margins) if len(margins) >= 3 else None
    revenue = sorted((d, r) for d, r, _ in rows if r is not None and r > 0)
    changes = [
        (revenue[i][1] - revenue[i - 1][1]) / revenue[i - 1][1] * 100
        for i in range(1, len(revenue))
        if _months_between(revenue[i - 1][0], revenue[i][0]) == 3
    ]
    swing = max(changes) - min(changes) if len(changes) >= 2 else None

    def band(value: Optional[float], low: float, high: float) -> int:
        if value is None:
            return -1
        return 0 if value < low else 1 if value <= high else 2

    level = max(band(margin_range, 3, 7), band(swing, 10, 25))
    return None if level < 0 else ("easy", "medium", "hard")[level]


# ---------- Research, cut to the date ----------

def _cached_quarters(conn: psycopg.Connection, symbol: Optional[str]) -> list[dict]:
    if not symbol:
        return []
    cached = conn.execute("SELECT quarters_json FROM statement_history_cache WHERE symbol = %s", (symbol,)).fetchone()
    return json.loads(cached["quarters_json"]) if cached else []


def _cut_quarters(quarters: list[dict], row: dict) -> list[tuple[date, Optional[float], Optional[float]]]:
    """Yahoo quarters ending before the quarter being forecast, newest first,
    at most QUARTERS_SHOWN of them: (end, revenue, operating margin %)."""
    end = row["period_end_date"]
    out = []
    for q in quarters:
        d = date.fromisoformat(q["period_end_date"][:10])
        if d >= end:
            continue
        rev, op = q.get("revenue"), q.get("operating_income")
        margin = op / rev * 100 if rev not in (None, 0) and op is not None else None
        out.append((d, rev, margin))
    out.sort(key=lambda t: t[0], reverse=True)
    return out[:QUARTERS_SHOWN]


def _indexed(values: list[Optional[float]]) -> list[Optional[float]]:
    """Each value / the first (oldest) positive one x 100."""
    base = next((v for v in values if v is not None and v > 0), None)
    return [None if v is None or base is None else v / base * 100 for v in values]


def list_cases(conn: psycopg.Connection, user_id: Optional[int], mystery: bool) -> list[PracticeCardOut]:
    mine = {m.code: m for m in my_practice(conn, user_id)} if user_id else {}
    out = []
    for row in _practice_rows(conn):
        code = code_for(row["id"])
        # Cached quarters only: listing must never wait on Yahoo.
        cut = _cut_quarters(_cached_quarters(conn, row["provider_symbol"]), row)
        card = PracticeCardOut(
            code=code, sector=row["sector"], sector_name=_sector_name(row), difficulty=difficulty(cut),
            mystery_line=_mystery_line(row) if mystery else None,
            first_score=mine[code].first_score if code in mine else None,
            attempts=mine[code].attempts if code in mine else 0,
        )
        if not mystery:
            card.name, card.ticker = row["company_name"], row["ticker"]
            card.season_label, card.description = row["season_label"], _description(row)
        out.append(card)
    return out


def get_case(conn: psycopg.Connection, code: str, mystery: bool, quarters: list[dict],
             provider_as_of: Optional[datetime]) -> PracticeCaseOut:
    """`quarters` is the company's Yahoo quarterly history (research_history's
    cache-first fetch); everything is cut here."""
    row = _load(conn, code)
    cut = list(reversed(_cut_quarters(quarters, row)))  # oldest first, for the index
    index = _indexed([rev for _, rev, _ in cut])
    shown = [
        PracticeQuarterOut(period_end_date=_shown_date(d, row, mystery), revenue_index=idx, operating_margin_pct=m)
        for (d, _, m), idx in zip(cut, index)
    ]
    shown.reverse()  # newest first, like the company page
    end = row["period_end_date"]
    actuals = [
        PracticeActualOut(period_end_date=_shown_date(a.period_end_date, row, mystery), metric_key=a.metric_key,
                          value=a.value, source_url=None if mystery else a.source_url)
        for a in league_admin.list_actuals(conn, row["company_id"])
        if a.period_end_date < end
    ]
    return PracticeCaseOut(
        code=code, mystery=mystery, sector=row["sector"], sector_name=_sector_name(row),
        description=_mystery_line(row) if mystery else _description(row),
        name=None if mystery else row["company_name"],
        ticker=None if mystery else row["ticker"],
        season_label=None if mystery else row["season_label"],
        results_date=None if mystery else row["results_date"],
        period_end_date=_shown_date(end, row, mystery),
        metrics=[MetricDefinitionOut(**m) for m in row["metric_definitions"]["metrics"]],
        research_notes=None if mystery else row["research_notes"],
        quarters=shown, actuals=actuals,
        provider_source=PROVIDER_SOURCE, provider_definition=PROVIDER_DEFINITION,
        provider_as_of=None if mystery else provider_as_of,
    )


def provider_symbol(conn: psycopg.Connection, code: str) -> tuple[Optional[str], int]:
    row = _load(conn, code)
    return row["provider_symbol"], row["company_id"]


def price_cut(lock_at: datetime, today: date) -> date:
    """The last day a practice price may come from: the earlier of the day
    forecasts closed (India time) and the usual 30-day lag."""
    from zoneinfo import ZoneInfo

    return min(lock_at.astimezone(ZoneInfo("Asia/Kolkata")).date(), today - timedelta(days=PRICE_LAG_DAYS))


def cut_prices(conn: psycopg.Connection, code: str, mystery: bool, weekly: list[PricePoint],
               today: date) -> PracticePricesOut:
    row = _load(conn, code)
    limit = price_cut(row["lock_at"], today)
    # A weekly bar is labelled with its Monday but carries the week's latest
    # close, so it counts only once the whole week is before the cut.
    kept = [p for p in weekly if date.fromisoformat(p.date[:10]) + timedelta(days=6) <= limit][-PRICE_WEEKS:]
    base = next((p.close for p in kept if p.close > 0), None)
    if base is None:
        return PracticePricesOut(points=[])
    return PracticePricesOut(points=[
        PracticePricePoint(date=_shown_date(date.fromisoformat(p.date[:10]), row, mystery), index=p.close / base * 100)
        for p in kept
    ])


# ---------- Attempts ----------

def _not_saved_reason(user: Optional[dict]) -> Optional[str]:
    if user is None:
        return "signed_out"
    try:
        forecast_eligibility(user)
    except LeagueError as exc:
        return {"guardian_consent_pending": "consent_pending"}.get(exc.code, exc.code)
    return None


def attempt(conn: psycopg.Connection, user: Optional[dict], code: str, body: PracticeAttemptIn) -> PracticeAttemptOut:
    row = _load(conn, code)
    metrics = row["metric_definitions"]["metrics"]
    cfg = market_config(row["market_code"])
    _validate_forecast(cfg, metrics, ForecastIn(
        values=[ForecastValueIn(metric_key=r.metric_key, low=r.low, high=r.high) for r in body.ranges],
        reason_tags=[], note=None,
    ))
    ranges = {r.metric_key: r for r in body.ranges}
    actual = _complete(conn, row)
    lazy = {r["metric_key"]: r["lazy_value"] for r in conn.execute(
        "SELECT metric_key, lazy_value FROM baselines WHERE event_id = %s", (row["id"],)).fetchall()}
    notes = _student_notes(row, actual)

    out = []
    for m in metrics:
        r, a, lz = ranges[m["key"]], actual[m["key"]], lazy.get(m["key"])
        s = scoring.score_metric(m["key"], r.low, r.high, a, lz, cfg.scoring)
        out.append(MetricResultOut(
            metric_key=m["key"], label=m["label"], unit=m["unit"], low=r.low, high=r.high, actual=a, lazy=lz,
            crowd_median=None, interval_score=s.interval_score, points=s.points, hit=s.hit, beat_lazy=s.beat_lazy,
            explanations=scoring.explain_metric(s, m["label"], r.low, r.high, a, lz, m["unit"], cfg.scoring),
            note=notes.get(m["key"]),
        ))
    points = [m.points for m in out]
    total = scoring.event_score([
        scoring.MetricScore(m.metric_key, m.interval_score, m.points, m.hit, m.beat_lazy, 0.0) for m in out])

    reason = _not_saved_reason(user)
    is_replay, first_score = False, None
    if reason is None and user is not None:
        values = (user["id"], row["id"], json.dumps({k: [v.low, v.high] for k, v in ranges.items()}),
                  json.dumps({m.metric_key: m.points for m in out}), total, body.mystery)
        first = conn.execute(
            """INSERT INTO practice_attempts (user_id, event_id, ranges, points, total_points, is_replay, mystery)
               VALUES (%s, %s, %s, %s, %s, FALSE, %s)
               ON CONFLICT (user_id, event_id) WHERE NOT is_replay DO NOTHING RETURNING id""",
            values,
        ).fetchone()
        if first is None:
            is_replay = True
            conn.execute(
                """INSERT INTO practice_attempts (user_id, event_id, ranges, points, total_points, is_replay, mystery)
                   VALUES (%s, %s, %s, %s, %s, TRUE, %s)""",
                values,
            )
            first_score = conn.execute(
                "SELECT total_points FROM practice_attempts WHERE user_id = %s AND event_id = %s AND NOT is_replay",
                (user["id"], row["id"]),
            ).fetchone()["total_points"]

    sources = {r["metric_key"]: r["source_url"] for r in conn.execute(
        """SELECT a.metric_key, a.definition_key, a.source_url FROM actuals a JOIN fiscal_periods p ON p.id = a.period_id
           WHERE p.company_id = %s AND p.fiscal_year_label = %s AND p.fiscal_quarter = %s""",
        (row["company_id"], row["fiscal_year_label"], row["fiscal_quarter"]),
    ).fetchall() if any(r["metric_key"] == m["key"] and r["definition_key"] == m["definition_key"] for m in metrics)}
    return PracticeAttemptOut(
        metrics=out, event_score=total, event_score_explanation=scoring.explain_event_score(points),
        reveal=PracticeRevealOut(name=row["company_name"], ticker=row["ticker"], season_label=row["season_label"],
                                 results_date=row["results_date"], sources=sources),
        saved=reason is None, not_saved_reason=reason, is_replay=is_replay, first_score=first_score,
    )


def my_practice(conn: psycopg.Connection, user_id: Optional[int]) -> list[PracticeMineOut]:
    if not user_id:
        return []
    rows = conn.execute(
        """SELECT event_id, count(*) AS attempts,
                  max(total_points) FILTER (WHERE NOT is_replay) AS first_score
           FROM practice_attempts WHERE user_id = %s GROUP BY event_id""",
        (user_id,),
    ).fetchall()
    return [PracticeMineOut(code=code_for(r["event_id"]), first_score=r["first_score"], attempts=r["attempts"])
            for r in rows]

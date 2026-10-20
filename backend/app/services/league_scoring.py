"""
Results League scoring runs (admin) and results (students). The maths lives
in scoring.py and is not changed here; this module loads the inputs,
derives lazy baselines, writes scores and builds the results page.

**Lazy baseline** for each metric = the same metric's actual for the
year-ago quarter (e.g. Q2 FY26 for a Q2 FY27 event), entered through the
admin "last year's numbers" form under the event's own definition_key:
- revenue growth: last year's same-quarter YoY growth (Q2 FY26 vs Q2 FY25),
  i.e. "growth repeats";
- operating margin: last year's same-quarter margin;
- sector KPI: last year's same-quarter KPI value (itself a YoY growth).
A missing or differently-defined year-ago value gives lazy = NULL: shown as
N/A, no bonus possible. Never estimated.

Scoring is idempotent: a run replaces every score for the event in one
transaction, and each run is audited.
"""
import statistics
from typing import Optional

import psycopg

from app.league_config import market_config
from app.league_models import MetricResultOut, ResultOut, SeasonOut
from app.services import audit, scoring
from app.services.league_admin import _event_for_entry, year_ago_label
from app.services.league_service import LeagueError, _load_event, _summary


def _actuals(conn: psycopg.Connection, company_id: int, fy_label: str, quarter: int) -> dict[str, tuple[str, float]]:
    rows = conn.execute(
        """SELECT a.metric_key, a.definition_key, a.value FROM actuals a JOIN fiscal_periods p ON p.id = a.period_id
           WHERE p.company_id = %s AND p.fiscal_year_label = %s AND p.fiscal_quarter = %s""",
        (company_id, fy_label, quarter),
    ).fetchall()
    return {r["metric_key"]: (r["definition_key"], r["value"]) for r in rows}


def _matching(values: dict[str, tuple[str, float]], metric: dict) -> Optional[float]:
    found = values.get(metric["key"])
    return found[1] if found and found[0] == metric["definition_key"] else None


def lazy_values(conn: psycopg.Connection, event: dict) -> dict[str, Optional[float]]:
    year_ago = _actuals(conn, event["company_id"], year_ago_label(event["fiscal_year_label"]), event["fiscal_quarter"])
    return {m["key"]: _matching(year_ago, m) for m in event["metric_definitions"]["metrics"]}


def score_event(conn: psycopg.Connection, actor: dict, event_id: int) -> int:
    """Scores every forecast for the event. Returns how many were scored."""
    event = _event_for_entry(conn, event_id)
    if event["status"] == "draft":
        raise LeagueError(409, "not_open", "This company was never opened for forecasts.")
    if not event["lock_passed"]:
        raise LeagueError(409, "not_locked", "Forecasts are still open. Score after the lock time.")
    metrics = event["metric_definitions"]["metrics"]
    current = _actuals(conn, event["company_id"], event["fiscal_year_label"], event["fiscal_quarter"])
    actual = {m["key"]: _matching(current, m) for m in metrics}
    missing = [m["label"] for m in metrics if actual[m["key"]] is None]
    if missing:
        raise LeagueError(409, "results_missing", f"Enter every result before scoring. Missing: {', '.join(missing)}.")
    lazy = lazy_values(conn, event)
    market = conn.execute("SELECT market_code FROM companies WHERE id = %s", (event["company_id"],)).fetchone()
    cfg = market_config(market["market_code"]).scoring

    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO baselines (event_id, metric_key, lazy_value) VALUES (%s, %s, %s)
               ON CONFLICT (event_id, metric_key) DO UPDATE SET lazy_value = EXCLUDED.lazy_value""",
            [(event_id, k, v) for k, v in lazy.items()],
        )
        values = conn.execute(
            """SELECT f.id, fv.metric_key, fv.low, fv.high FROM forecasts f
               JOIN forecast_values fv ON fv.forecast_id = f.id WHERE f.event_id = %s""",
            (event_id,),
        ).fetchall()
        conn.execute("DELETE FROM scores WHERE forecast_id IN (SELECT id FROM forecasts WHERE event_id = %s)", (event_id,))
        rows = []
        for v in values:
            if v["metric_key"] not in actual:
                continue
            s = scoring.score_metric(v["metric_key"], v["low"], v["high"], actual[v["metric_key"]],
                                     lazy[v["metric_key"]], cfg)
            rows.append((v["id"], s.metric_key, s.interval_score, s.points, s.hit, s.beat_lazy, s.abs_error_mid,
                         actual[v["metric_key"]], lazy[v["metric_key"]]))
        cur.executemany(
            """INSERT INTO scores (forecast_id, metric_key, interval_score, points, hit, beat_lazy, abs_error_mid,
                                   actual_value, lazy_value)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            rows,
        )
    forecasts = len({r[0] for r in rows})
    conn.execute("UPDATE forecast_events SET status = 'scored', scored_at = now(), updated_at = now() WHERE id = %s",
                 (event_id,))
    audit.write(conn, actor["id"], "rescore" if event["status"] == "scored" else "score", "forecast_event", event_id,
                {"forecasts_scored": forecasts, "actuals": actual, "lazy": lazy})
    return forecasts


def my_result(conn: psycopg.Connection, user_id: int, event_id: int) -> ResultOut:
    row = _load_event(conn, event_id, user_id)
    if row["effective_status"] != "scored":
        raise LeagueError(404, "not_scored", "This company's results haven't been scored yet.")
    forecast = conn.execute("SELECT id FROM forecasts WHERE event_id = %s AND user_id = %s",
                            (event_id, user_id)).fetchone()
    if forecast is None:
        raise LeagueError(404, "no_forecast", "You didn't make a forecast for this company.")
    cfg = market_config(row["market_code"])
    scores = {r["metric_key"]: r for r in conn.execute(
        """SELECT s.metric_key, s.interval_score, s.points, s.hit, s.beat_lazy, s.abs_error_mid, s.actual_value,
                  s.lazy_value, fv.low, fv.high
           FROM scores s JOIN forecast_values fv ON fv.forecast_id = s.forecast_id AND fv.metric_key = s.metric_key
           WHERE s.forecast_id = %s""",
        (forecast["id"],),
    ).fetchall()}
    forecasters = conn.execute("SELECT count(*) AS n FROM forecasts WHERE event_id = %s", (event_id,)).fetchone()["n"]
    crowd_shown = forecasters >= cfg.min_forecasters_for_crowd
    medians: dict[str, float] = {}
    if crowd_shown:
        mids: dict[str, list[float]] = {}
        for r in conn.execute(
            """SELECT fv.metric_key, (fv.low + fv.high) / 2 AS mid FROM forecast_values fv
               JOIN forecasts f ON f.id = fv.forecast_id WHERE f.event_id = %s""", (event_id,)
        ).fetchall():
            mids.setdefault(r["metric_key"], []).append(r["mid"])
        medians = {k: statistics.median(v) for k, v in mids.items()}

    out = []
    for m in row["metric_definitions"]["metrics"]:
        r = scores.get(m["key"])
        if r is None:
            continue
        ms = scoring.MetricScore(metric_key=m["key"], interval_score=r["interval_score"], points=r["points"],
                                 hit=r["hit"], beat_lazy=r["beat_lazy"], abs_error_mid=r["abs_error_mid"])
        median = medians.get(m["key"]) if crowd_shown else None
        out.append(MetricResultOut(
            metric_key=m["key"], label=m["label"], unit=m["unit"], low=r["low"], high=r["high"],
            actual=r["actual_value"], lazy=r["lazy_value"], crowd_median=median,
            interval_score=r["interval_score"], points=r["points"], hit=r["hit"], beat_lazy=r["beat_lazy"],
            explanations=scoring.explain_metric(ms, m["label"], r["low"], r["high"], r["actual_value"],
                                                r["lazy_value"], m["unit"], cfg.scoring, median, forecasters),
        ))
    points = [m.points for m in out]
    return ResultOut(
        event=_summary(row), event_score=scoring.event_score(
            [scoring.MetricScore(m.metric_key, m.interval_score, m.points, m.hit, m.beat_lazy, 0.0) for m in out]),
        event_score_explanation=scoring.explain_event_score(points), forecasters=forecasters,
        crowd_shown=crowd_shown,
        crowd_explanation=scoring.explain_crowd(forecasters, crowd_shown, cfg.min_forecasters_for_crowd),
        lock_at=row["lock_at"], metrics=out,
    )


def season(conn: psycopg.Connection, user_id: int, market_code: str = "IN") -> SeasonOut:
    cfg = market_config(market_code).scoring
    rows = conn.execute(
        """SELECT f.id, avg(s.points) AS event_score, count(*) AS metrics, count(*) FILTER (WHERE s.hit) AS hits
           FROM scores s JOIN forecasts f ON f.id = s.forecast_id
           JOIN forecast_events e ON e.id = f.event_id
           WHERE f.user_id = %s AND e.status = 'scored'
           GROUP BY f.id""",
        (user_id,),
    ).fetchall()
    scored_metrics = sum(r["metrics"] for r in rows)
    hits = sum(r["hits"] for r in rows)
    return SeasonOut(
        events_scored=len(rows),
        average_score=scoring.season_score([r["event_score"] for r in rows]),
        scored_metrics=scored_metrics,
        hits=hits,
        calibration=scoring.calibration(hits, scored_metrics, cfg),
        min_metrics_for_calibration=cfg.min_scored_metrics_for_calibration,
    )

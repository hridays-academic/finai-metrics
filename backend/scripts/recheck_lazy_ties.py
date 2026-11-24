"""Read-only: which scored league forecasts would change under the lazy-bonus
tie fix (2026-11-24)?

Re-scores every stored score row with today's scoring.score_metric, using the
actual and lazy values stored on that row (what was scored), and prints
every forecast whose points would change: company, quarter, handle, old,
new (per metric and per event). Changes nothing: the connection is opened
read-only (default_transaction_read_only) and the transaction is rolled back.

Usage, from backend/ (the URL is read from the environment, never printed):
    RECHECK_DATABASE_URL='<production pooled string>' .venv/bin/python scripts/recheck_lazy_ties.py
"""
import os
import sys
from collections import defaultdict
from statistics import mean
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.league_config import market_config  # noqa: E402
from app.services import scoring  # noqa: E402

QUERY = """
SELECT c.name AS company, c.market_code, fp.fiscal_year_label, fp.fiscal_quarter, e.season_label,
       u.handle, u.deleted_at IS NOT NULL AS deleted, f.id AS forecast_id,
       s.metric_key, s.points, s.beat_lazy, s.actual_value, s.lazy_value, fv.low, fv.high
FROM scores s
JOIN forecasts f ON f.id = s.forecast_id
JOIN forecast_values fv ON fv.forecast_id = s.forecast_id AND fv.metric_key = s.metric_key
JOIN forecast_events e ON e.id = f.event_id
JOIN fiscal_periods fp ON fp.id = e.period_id
JOIN companies c ON c.id = fp.company_id
JOIN users u ON u.id = f.user_id
ORDER BY c.name, f.id, s.metric_key
"""


def find_changes(conn) -> tuple[int, int, list[dict]]:
    """(score rows, forecasts, changes); each change has company, season,
    quarter, handle, old and new event score and the changed metrics."""
    rows = conn.execute(QUERY).fetchall()
    by_forecast: dict[int, list[dict]] = defaultdict(list)
    for r in rows:
        by_forecast[r["forecast_id"]].append(r)
    changes = []
    for metrics in by_forecast.values():
        cfg = market_config(metrics[0]["market_code"]).scoring
        old_m, new_m, changed = [], [], []
        for r in metrics:
            if r["actual_value"] is None:
                new = r["points"]  # scored before actual_value was stored: can't recompute, keep as is
            else:
                new = scoring.score_metric(r["metric_key"], r["low"], r["high"], r["actual_value"],
                                           r["lazy_value"], cfg).points
            old_m.append(r["points"])
            new_m.append(new)
            if abs(new - r["points"]) > 1e-9:
                changed.append({"metric": r["metric_key"], "low": r["low"], "high": r["high"],
                                "actual": r["actual_value"], "lazy": r["lazy_value"], "old": r["points"], "new": new})
        if changed:
            m = metrics[0]
            changes.append({
                "company": m["company"], "season": m["season_label"],
                "quarter": f"{m['fiscal_year_label']} Q{m['fiscal_quarter']}",
                "handle": m["handle"] or ("(deleted account)" if m["deleted"] else "(no handle)"),
                "old": mean(old_m), "new": mean(new_m), "metrics": changed,  # as scoring.event_score
            })
    return len(rows), len(by_forecast), changes


def main() -> int:
    url = os.environ.get("RECHECK_DATABASE_URL")
    if not url:
        print("Set RECHECK_DATABASE_URL.", file=sys.stderr)
        return 2
    with psycopg.connect(url, row_factory=dict_row, options="-c default_transaction_read_only=on",
                         connect_timeout=20) as conn:
        label = "no stackly_env table (production)"
        if conn.execute("SELECT to_regclass('stackly_env') AS t").fetchone()["t"]:
            label = conn.execute("SELECT * FROM stackly_env LIMIT 1").fetchone()
        rows, forecasts, changes = find_changes(conn)
        conn.rollback()

    print(f"Database: {label}")
    print(f"Score rows checked: {rows} across {forecasts} forecasts")
    print(f"Forecasts whose score would change: {len(changes)}")
    for c in changes:
        print(f"- {c['company']}, {c['season']} ({c['quarter']}), {c['handle']}: "
              f"event score {c['old']:.2f} -> {c['new']:.2f}")
        for m in c["metrics"]:
            print(f"    {m['metric']}: {m['low']}..{m['high']}, actual {m['actual']}, lazy {m['lazy']}: "
                  f"{m['old']:g} -> {m['new']:g}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""
Older quarters, approved a company at a time (Hriday at Stop 2, 25 Nov 2026).

Claude researches past quarters into proposal files (`use` "practice" or
"last_year"); nothing reaches the database until an admin approves a
company in Review results. Approval saves every number through the normal
`put_actuals` checks (each one audited) and, for a practice quarter, an
archive event: scored on creation, no forecasts possible (its lock is
already past), and never shown by league pages (`_EVENT_SELECT`). Practice
and quick rounds then draw on it under the answer-leak rule
(practice._practice_rows).
"""
import calendar
import re
from datetime import date

import psycopg
from psycopg.types.json import Jsonb

from app.league_config import all_definitions, market_config
from app.league_models import (
    ActualIn, OlderApproveIn, OlderApproveOut, OlderCompanyOut, OlderMetricOut, OlderQuarterOut,
)
from app.services import audit, result_proposals
from app.services.league_admin import _upsert_period, default_lock_at, metric_definitions_for, put_actuals
from app.services.league_service import LeagueError

OLDER_USES = ("practice", "last_year")


def period_end(fy_label: str, quarter: int, fy_end_month: int) -> date:
    """The last day of a fiscal quarter: FY26 Q3 with a March year end is 31 Dec 2025."""
    m = re.fullmatch(r"[A-Za-z]*(\d+)", fy_label.strip())
    if not m:
        raise LeagueError(422, "bad_fiscal_year", f"Can't read the fiscal year '{fy_label}'.")
    digits = m.group(1)
    year = 2000 + int(digits) if len(digits) == 2 else int(digits)
    y, m0 = divmod(year * 12 + (fy_end_month - 1) - 3 * (4 - quarter), 12)
    return date(y, m0 + 1, calendar.monthrange(y, m0 + 1)[1])


def _older(proposals: dict) -> dict[str, list[result_proposals.Proposal]]:
    out: dict[str, list[result_proposals.Proposal]] = {}
    for p in proposals.values():
        if p.use in OLDER_USES:
            out.setdefault(p.event.ticker.upper(), []).append(p)
    for ps in out.values():
        ps.sort(key=lambda p: (p.fiscal_year_label, p.fiscal_quarter))
    return out


def _company(conn: psycopg.Connection, ticker: str):
    return conn.execute(
        """SELECT id, market_code, sector, fiscal_year_end_month, name FROM companies
           WHERE upper(ticker) = %s AND NOT is_demo ORDER BY id LIMIT 1""",
        (ticker.upper(),),
    ).fetchone()


def _saved(conn: psycopg.Connection, company_id: int, fy: str, q: int) -> dict[tuple[str, str], float]:
    return {
        (r["metric_key"], r["definition_key"]): r["value"]
        for r in conn.execute(
            """SELECT a.metric_key, a.definition_key, a.value FROM actuals a JOIN fiscal_periods p ON p.id = a.period_id
               WHERE p.company_id = %s AND p.fiscal_year_label = %s AND p.fiscal_quarter = %s""",
            (company_id, fy, q),
        ).fetchall()
    }


def _event_kind(conn: psycopg.Connection, company_id: int, fy: str, q: int):
    row = conn.execute(
        """SELECT e.kind FROM forecast_events e JOIN fiscal_periods p ON p.id = e.period_id
           WHERE p.company_id = %s AND p.fiscal_year_label = %s AND p.fiscal_quarter = %s""",
        (company_id, fy, q),
    ).fetchone()
    return row["kind"] if row else None


def list_companies(conn: psycopg.Connection, proposals: dict | None = None) -> list[OlderCompanyOut]:
    proposals = result_proposals.all_proposals() if proposals is None else proposals
    out = []
    for ticker, ps in sorted(_older(proposals).items()):
        company = _company(conn, ticker)
        defs = all_definitions(market_config(company["market_code"] if company else "IN"))
        quarters = []
        for p in ps:
            saved = _saved(conn, company["id"], p.fiscal_year_label, p.fiscal_quarter) if company else {}
            kind = _event_kind(conn, company["id"], p.fiscal_year_label, p.fiscal_quarter) if company else None
            metrics = [
                OlderMetricOut(
                    metric_key=m.metric_key, definition_key=m.definition_key,
                    label=defs[m.definition_key].label if m.definition_key in defs else m.metric_key,
                    unit=defs[m.definition_key].unit if m.definition_key in defs else "",
                    value=m.value, saved=saved.get((m.metric_key, m.definition_key)),
                    source_url=m.source_url, page=m.page, working=m.working, flag=m.flag, note=m.note,
                )
                for m in p.event.metrics
            ]
            same = all(m.saved is not None and abs(m.saved - m.value) < 1e-9 for m in metrics)
            done = same and (p.use != "practice" or kind == "archive")
            status = "saved" if done else ("new" if not any(m.saved is not None for m in metrics) else "differs")
            quarters.append(OlderQuarterOut(
                fiscal_year_label=p.fiscal_year_label, fiscal_quarter=p.fiscal_quarter, use=p.use,
                results_date=p.event.results_date, file=p.file, status=status,
                archive_event=kind == "archive", metrics=metrics,
            ))
        out.append(OlderCompanyOut(ticker=ticker, company=ps[0].event.company, in_stackly=company is not None,
                                   quarters=quarters))
    return out


def approve(conn: psycopg.Connection, actor: dict, ticker: str, body: OlderApproveIn,
            proposals: dict | None = None) -> OlderApproveOut:
    """Saves one company's older quarters as the admin approved them (values
    may be edited; sources stay the proposal's). All or nothing: the route
    runs this in one transaction."""
    proposals = result_proposals.all_proposals() if proposals is None else proposals
    ticker = ticker.upper()
    company = _company(conn, ticker)
    if company is None:
        raise LeagueError(409, "company_missing",
                          f"{ticker} isn't in Stackly yet. It's added with its first league event.")
    cfg = market_config(company["market_code"])
    created = 0
    audited = []
    for item in body.quarters:
        fy = item.fiscal_year_label.strip().upper()
        p = proposals.get((ticker, fy, item.fiscal_quarter))
        if p is None or p.use not in OLDER_USES:
            raise LeagueError(404, "no_proposal", f"There's no older-quarter proposal for {ticker} {fy} Q{item.fiscal_quarter}.")
        offered = {(m.metric_key, m.definition_key): m for m in p.event.metrics}
        if {(m.metric_key, m.definition_key) for m in item.metrics} != set(offered):
            raise LeagueError(422, "metrics_mismatch",
                              f"{ticker} {fy} Q{item.fiscal_quarter}: approve exactly the proposed numbers.")
        period_id = _upsert_period(conn, company["id"], fy, item.fiscal_quarter,
                                   period_end(fy, item.fiscal_quarter, company["fiscal_year_end_month"]))
        put_actuals(conn, actor, period_id, [
            ActualIn(metric_key=m.metric_key, definition_key=m.definition_key, value=m.value,
                     source_url=offered[(m.metric_key, m.definition_key)].source_url)
            for m in item.metrics
        ])
        made = False
        if p.use == "practice" and _event_kind(conn, company["id"], fy, item.fiscal_quarter) is None:
            include_kpi = any(m.metric_key == "sector_kpi" for m in item.metrics)
            results_date = p.event.results_date
            event_id = conn.execute(
                """INSERT INTO forecast_events (period_id, results_date, lock_at, status, metric_definitions,
                                                season_label, kind, scored_at)
                   VALUES (%s, %s, %s, 'scored', %s, %s, 'archive', now()) RETURNING id""",
                (period_id, results_date, default_lock_at(results_date, cfg),
                 Jsonb(metric_definitions_for(cfg, company["sector"], include_kpi)), f"Q{item.fiscal_quarter} {fy}"),
            ).fetchone()["id"]
            audit.write(conn, actor["id"], "create", "forecast_event", event_id,
                        {"kind": "archive", "period_id": period_id, "results_date": results_date.isoformat()})
            created += 1
            made = True
        audited.append({
            "quarter": f"{fy} Q{item.fiscal_quarter}", "file": p.file, "archive_event": made,
            "metrics": [{"metric_key": m.metric_key, "proposed": offered[(m.metric_key, m.definition_key)].value,
                         "saved": m.value,
                         "edited": abs(offered[(m.metric_key, m.definition_key)].value - m.value) > 1e-9}
                        for m in item.metrics],
        })
    audit.write(conn, actor["id"], "approve", "older_results", ticker, {"quarters": audited})
    return OlderApproveOut(quarters_saved=len(body.quarters), archive_events_created=created)

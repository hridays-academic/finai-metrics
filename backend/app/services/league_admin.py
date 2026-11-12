"""
Results League admin: set up companies, periods and events; enter actuals
and baselines; record guardian consent. Target: one event set up in under
two minutes (quick_event does company + period + event in one call).
Every change writes audit_log in the same transaction.
"""
import re
from datetime import date, datetime, time, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

import psycopg
from psycopg.types.json import Jsonb

from app.league_config import SECTOR_KPI, MarketConfig, all_definitions, market_config
from app.league_models import (
    ActualIn,
    ActualOut,
    AdminBoardRow,
    AdminUserOut,
    BaselineIn,
    ConsentIn,
    EventPatch,
    MetricDefinitionOut,
    PeriodIn,
    ProposalMetricOut,
    QuickEventIn,
    ResultProposalOut,
)
from app.services import audit, result_proposals
from app.services.league_service import LeagueError


def default_lock_at(results_date: date, cfg: MarketConfig) -> datetime:
    """23:59 (market local time) on the day before results -- the spec's
    default. Stored as an aware datetime; Postgres keeps it in UTC."""
    hh, mm = (int(x) for x in cfg.default_lock_local_time.split(":"))
    return datetime.combine(results_date - timedelta(days=1), time(hh, mm), tzinfo=ZoneInfo(cfg.timezone))


def metric_definitions_for(cfg: MarketConfig, sector: str, include_kpi: bool) -> dict:
    """The exact definitions snapshot stored on an event. Copying the text
    (not just the key) means the event keeps its contract even if the config
    later gains a new version."""
    metrics = [m for m in cfg.core_metrics]
    if include_kpi:
        template = cfg.kpi_templates.get(sector)
        if template is None:
            raise LeagueError(422, "no_kpi_template", f"There's no KPI template for sector '{sector}'.")
        metrics.append(template.metric)
    return {"metrics": [
        {"key": m.key, "definition_key": m.definition_key, "label": m.label, "unit": m.unit,
         "definition": m.definition, "min_value": m.min_value, "max_value": m.max_value}
        for m in metrics
    ]}


def quick_event(conn: psycopg.Connection, actor: dict, data: QuickEventIn) -> int:
    cfg = market_config(data.market_code)
    sector = data.sector.strip().lower()
    if sector in cfg.excluded_sectors:
        raise LeagueError(422, "sector_excluded", f"'{sector}' companies aren't part of the league yet.")
    if data.results_date < data.period_end_date:
        raise LeagueError(422, "bad_dates", "The results date can't be before the period end date.")
    ticker = data.ticker.strip().upper()
    template = cfg.kpi_templates.get(sector)
    if data.include_kpi and template and ticker in template.non_disclosing_tickers:
        raise LeagueError(
            422, "kpi_not_disclosed",
            f"{ticker} doesn't disclose {template.metric.label.lower()}, so its events have no sector KPI. "
            "Untick the KPI box.",
        )
    lock_at = data.lock_at or default_lock_at(data.results_date, cfg)
    now = conn.execute("SELECT now()").fetchone()["now"]
    if lock_at <= now:
        raise LeagueError(422, "lock_in_past", "The lock time has already passed; choose a later one.")
    definitions = metric_definitions_for(cfg, sector, data.include_kpi)

    company = conn.execute(
        """
        INSERT INTO companies (market_code, exchange, ticker, name, sector, currency, fiscal_year_end_month,
                               provider_symbol, description)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (market_code, exchange, ticker) DO UPDATE
            SET name = EXCLUDED.name, sector = EXCLUDED.sector,
                fiscal_year_end_month = EXCLUDED.fiscal_year_end_month,
                provider_symbol = COALESCE(EXCLUDED.provider_symbol, companies.provider_symbol),
                description = COALESCE(EXCLUDED.description, companies.description)
        RETURNING id
        """,
        (data.market_code, data.exchange.strip().upper(), ticker, data.company_name.strip(),
         sector, cfg.currency, data.fiscal_year_end_month, (data.provider_symbol or "").strip().upper() or None,
         (data.description or "").strip() or None),
    ).fetchone()["id"]
    period = _upsert_period(conn, company, data.fiscal_year_label, data.fiscal_quarter, data.period_end_date)
    try:
        event = conn.execute(
            """
            INSERT INTO forecast_events (period_id, results_date, lock_at, status, metric_definitions,
                                         research_notes, season_label)
            VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id
            """,
            (period, data.results_date, lock_at, "open" if data.open_now else "draft", Jsonb(definitions),
             (data.research_notes or "").strip() or None, data.season_label.strip()),
        ).fetchone()["id"]
    except psycopg.errors.UniqueViolation as exc:
        raise LeagueError(409, "event_exists", "An event already exists for that company period.") from exc
    audit.write(conn, actor["id"], "create", "forecast_event", event,
                {"company_id": company, "period_id": period, "lock_at": lock_at.isoformat(),
                 "results_date": data.results_date.isoformat(), "definitions": definitions,
                 "status": "open" if data.open_now else "draft"})
    return event


def _upsert_period(conn, company_id: int, fy_label: str, quarter: int, period_end: date) -> int:
    return conn.execute(
        """
        INSERT INTO fiscal_periods (company_id, fiscal_year_label, fiscal_quarter, period_end_date)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (company_id, fiscal_year_label, fiscal_quarter) DO UPDATE SET period_end_date = EXCLUDED.period_end_date
        RETURNING id
        """,
        (company_id, fy_label.strip().upper(), quarter, period_end),
    ).fetchone()["id"]


def create_period(conn: psycopg.Connection, actor: dict, data: PeriodIn) -> int:
    if conn.execute("SELECT 1 FROM companies WHERE id = %s", (data.company_id,)).fetchone() is None:
        raise LeagueError(404, "company_not_found", "No such company.")
    period = _upsert_period(conn, data.company_id, data.fiscal_year_label, data.fiscal_quarter, data.period_end_date)
    audit.write(conn, actor["id"], "create", "fiscal_period", period, data.model_dump(mode="json"))
    return period


def update_event(conn: psycopg.Connection, actor: dict, event_id: int, patch: EventPatch) -> None:
    fields = patch.model_dump(exclude_unset=True)
    if not fields:
        return
    if "research_notes" in fields:
        fields["research_notes"] = (fields["research_notes"] or "").strip() or None
    cols = ", ".join(f"{k} = %({k})s" for k in fields)
    try:
        updated = conn.execute(
            f"UPDATE forecast_events SET {cols}, updated_at = now() WHERE id = %(event_id)s AND status <> 'scored' RETURNING id",
            {**fields, "event_id": event_id},
        ).fetchone()
    except psycopg.errors.CheckViolation as exc:
        if "lock_time_passed" in str(exc):
            raise LeagueError(409, "lock_time_passed", "The lock time has passed, so it can no longer be changed.") from exc
        raise
    if updated is None:
        raise LeagueError(404, "event_not_found", "No such event, or it has already been scored.")
    audit.write(conn, actor["id"], "update", "forecast_event", event_id,
                {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in fields.items()})


def put_actuals(conn: psycopg.Connection, actor: dict, period_id: int, items: list[ActualIn]) -> None:
    period = conn.execute(
        "SELECT p.id, c.market_code, c.sector FROM fiscal_periods p JOIN companies c ON c.id = p.company_id WHERE p.id = %s",
        (period_id,),
    ).fetchone()
    if period is None:
        raise LeagueError(404, "period_not_found", "No such company period.")
    defs = all_definitions(market_config(period["market_code"]))
    for item in items:
        d = defs.get(item.definition_key)
        if d is None or d.key != item.metric_key:
            raise LeagueError(422, "unknown_definition",
                              f"'{item.definition_key}' isn't a definition for metric '{item.metric_key}'.")
        if item.metric_key == SECTOR_KPI and not item.definition_key.startswith(f"{period['market_code'].lower()}.{period['sector']}."):
            raise LeagueError(422, "wrong_sector_kpi", "That KPI definition belongs to a different sector.")
        if not d.min_value <= item.value <= d.max_value:
            raise LeagueError(422, "out_of_bounds",
                              f"{d.label} must be between {d.min_value:g} and {d.max_value:g}.")
        previous = conn.execute(
            "SELECT value, definition_key, source_url FROM actuals WHERE period_id = %s AND metric_key = %s",
            (period_id, item.metric_key),
        ).fetchone()
        conn.execute(
            """
            INSERT INTO actuals (period_id, metric_key, definition_key, value, source_url, entered_by)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (period_id, metric_key) DO UPDATE
                SET definition_key = EXCLUDED.definition_key, value = EXCLUDED.value,
                    source_url = EXCLUDED.source_url, entered_by = EXCLUDED.entered_by, entered_at = now()
            """,
            (period_id, item.metric_key, item.definition_key, item.value, item.source_url, actor["id"]),
        )
        audit.write(conn, actor["id"], "update" if previous else "create", "actual", f"{period_id}:{item.metric_key}",
                    {"new": item.model_dump(), "previous": dict(previous) if previous else None})


def list_actuals(conn: psycopg.Connection, company_id: int) -> list[ActualOut]:
    rows = conn.execute(
        """
        SELECT a.period_id, p.fiscal_year_label, p.fiscal_quarter, p.period_end_date, a.metric_key,
               a.definition_key, a.value, a.source_url, a.entered_at
        FROM actuals a JOIN fiscal_periods p ON p.id = a.period_id
        WHERE p.company_id = %s
        ORDER BY p.period_end_date DESC, a.metric_key
        """,
        (company_id,),
    ).fetchall()
    return [ActualOut(**dict(r)) for r in rows]


def put_baselines(conn: psycopg.Connection, actor: dict, event_id: int, items: list[BaselineIn]) -> None:
    event = conn.execute("SELECT metric_definitions FROM forecast_events WHERE id = %s", (event_id,)).fetchone()
    if event is None:
        raise LeagueError(404, "event_not_found", "No such event.")
    keys = {m["key"] for m in event["metric_definitions"]["metrics"]}
    for item in items:
        if item.metric_key not in keys:
            raise LeagueError(422, "unknown_metric", f"This event doesn't include '{item.metric_key}'.")
        conn.execute(
            """
            INSERT INTO baselines (event_id, metric_key, lazy_value, analyst_value, ai_value, source_notes)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (event_id, metric_key) DO UPDATE
                SET lazy_value = EXCLUDED.lazy_value, analyst_value = EXCLUDED.analyst_value,
                    ai_value = EXCLUDED.ai_value, source_notes = EXCLUDED.source_notes
            """,
            (event_id, item.metric_key, item.lazy_value, item.analyst_value, item.ai_value, item.source_notes),
        )
        audit.write(conn, actor["id"], "update", "baseline", f"{event_id}:{item.metric_key}", item.model_dump())


def set_guardian_consent(conn: psycopg.Connection, actor: dict, user_id: int, consent: ConsentIn) -> None:
    """Records (or undoes) a parent or guardian's consent: who, how (signed
    form or an email from the parent) and when. Undoing clears all three.

    TODO(legal): a record-keeping placeholder, not a verified legal consent
    flow. The audit entry leaves out the parent's name, so deleting the
    account (which blanks the users row) removes it everywhere."""
    row = conn.execute(
        "SELECT age_band FROM users WHERE id = %s AND deleted_at IS NULL", (user_id,)
    ).fetchone()
    if row is None:
        raise LeagueError(404, "user_not_found", "No such user.")
    if row["age_band"] != "under_18":
        raise LeagueError(422, "not_under_18", "Guardian consent only applies to users under 18.")
    granted = consent.status == "granted"
    conn.execute(
        """UPDATE users SET guardian_consent_status = %s, guardian_consent_by = %s,
                  guardian_consent_method = %s, guardian_consent_date = %s WHERE id = %s""",
        (consent.status,
         consent.parent_name if granted else None,
         consent.method if granted else None,
         consent.consent_date if granted else None,
         user_id),
    )
    details = {"status": consent.status}
    if granted:
        details.update(method=consent.method, date=consent.consent_date.isoformat())
    audit.write(conn, actor["id"], "update", "guardian_consent", user_id, details)


def find_users(conn: psycopg.Connection, query: Optional[str], limit: int = 50) -> list[AdminUserOut]:
    q = f"%{(query or '').strip().lower()}%"
    rows = conn.execute(
        """
        SELECT id, email, name, handle, age_band, guardian_consent_status, school_name,
               guardian_consent_by, guardian_consent_method, guardian_consent_date FROM users
        WHERE deleted_at IS NULL
          AND (lower(email) LIKE %s OR lower(coalesce(handle, '')) LIKE %s OR lower(name) LIKE %s)
        ORDER BY (age_band = 'under_18' AND guardian_consent_status = 'pending') DESC, id DESC
        LIMIT %s
        """,
        (q, q, q, limit),
    ).fetchall()
    return [AdminUserOut(**dict(r)) for r in rows]


# ---------- Companies board (the admin page's main list) ----------

def year_ago_label(fy_label: str) -> str:
    """'FY27' -> 'FY26'. Keeps the prefix and the digit width."""
    m = re.fullmatch(r"([A-Za-z]*)(\d+)", fy_label.strip())
    if not m:
        raise LeagueError(422, "bad_fiscal_year", f"Can't work out the year before '{fy_label}'.")
    prefix, digits = m.groups()
    return f"{prefix.upper()}{int(digits) - 1:0{len(digits)}d}"


def _missing(metrics: list[dict], have: set[tuple[str, str]]) -> list[str]:
    """Metric keys with no actual recorded under the event's own definition."""
    return [m["key"] for m in metrics if (m["key"], m["definition_key"]) not in have]


def _board_status(row: dict, missing_last_year: list[str], missing_results: list[str],
                  numbers_changed_at=None) -> str:
    if row["status"] == "scored":
        # A result or last year's number corrected after the last run.
        changed = numbers_changed_at and row["scored_at"] and numbers_changed_at > row["scored_at"]
        return "rescore_needed" if changed else "scored"
    if row["lock_passed"]:
        return "ready_to_score" if not missing_results else "results_due"
    if missing_last_year:
        return "needs_last_year"
    return "hidden" if row["status"] == "draft" else "open"


def admin_board(conn: psycopg.Connection) -> list[AdminBoardRow]:
    rows = conn.execute(
        """
        SELECT e.id, e.status, e.lock_at, e.results_date, e.season_label, e.metric_definitions, e.research_notes,
               e.scored_at, p.fiscal_year_label, p.fiscal_quarter, p.period_end_date,
               c.id AS company_id, c.name AS company_name, c.ticker, c.sector,
               e.lock_at <= now() AS lock_passed,
               (SELECT count(*) FROM forecasts f WHERE f.event_id = e.id) AS forecasts
        FROM forecast_events e JOIN fiscal_periods p ON p.id = e.period_id JOIN companies c ON c.id = p.company_id
        ORDER BY e.results_date, c.name
        """
    ).fetchall()
    have: dict[tuple[int, str, int], set[tuple[str, str]]] = {}
    changed_at: dict[tuple[int, str, int], object] = {}
    for a in conn.execute(
        """SELECT p.company_id, p.fiscal_year_label, p.fiscal_quarter, a.metric_key, a.definition_key, a.entered_at
           FROM actuals a JOIN fiscal_periods p ON p.id = a.period_id"""
    ).fetchall():
        key = (a["company_id"], a["fiscal_year_label"], a["fiscal_quarter"])
        have.setdefault(key, set()).add((a["metric_key"], a["definition_key"]))
        changed_at[key] = max(changed_at.get(key, a["entered_at"]), a["entered_at"])
    out = []
    for r in rows:
        metrics = r["metric_definitions"]["metrics"]
        prev = year_ago_label(r["fiscal_year_label"])
        missing_last_year = _missing(metrics, have.get((r["company_id"], prev, r["fiscal_quarter"]), set()))
        missing_results = _missing(metrics, have.get((r["company_id"], r["fiscal_year_label"], r["fiscal_quarter"]), set()))
        out.append(AdminBoardRow(
            id=r["id"], company_id=r["company_id"], company_name=r["company_name"], ticker=r["ticker"],
            sector=r["sector"], season_label=r["season_label"], fiscal_year_label=r["fiscal_year_label"],
            fiscal_quarter=r["fiscal_quarter"], period_end_date=r["period_end_date"], results_date=r["results_date"],
            lock_at=r["lock_at"], lock_passed=r["lock_passed"], forecasts=r["forecasts"], raw_status=r["status"],
            status=_board_status(r, missing_last_year, missing_results, max(
                (t for t in (changed_at.get((r["company_id"], prev, r["fiscal_quarter"])),
                             changed_at.get((r["company_id"], r["fiscal_year_label"], r["fiscal_quarter"]))) if t),
                default=None)),
            year_ago_label=prev,
            metrics=[MetricDefinitionOut(**m) for m in metrics], missing_last_year=missing_last_year,
            missing_results=missing_results, research_notes=r["research_notes"],
            has_proposal=(r["lock_passed"] and r["status"] != "scored" and len(missing_results) == len(metrics)
                          and result_proposals.find(r["ticker"], r["fiscal_year_label"], r["fiscal_quarter"],
                                                    metrics) is not None),
        ))
    return out


def _event_for_entry(conn: psycopg.Connection, event_id: int) -> dict:
    row = conn.execute(
        """SELECT e.id, e.status, e.metric_definitions, e.lock_at <= now() AS lock_passed,
                  p.id AS period_id, p.company_id, p.fiscal_year_label, p.fiscal_quarter, p.period_end_date,
                  c.ticker
           FROM forecast_events e JOIN fiscal_periods p ON p.id = e.period_id
           JOIN companies c ON c.id = p.company_id WHERE e.id = %s""",
        (event_id,),
    ).fetchone()
    if row is None:
        raise LeagueError(404, "event_not_found", "No such event.")
    return row


def _check_event_definitions(event: dict, items: list[ActualIn]) -> None:
    """Numbers entered from an event's row must use that event's own definitions."""
    defs = {m["key"]: m["definition_key"] for m in event["metric_definitions"]["metrics"]}
    for item in items:
        if defs.get(item.metric_key) != item.definition_key:
            raise LeagueError(422, "wrong_definition",
                              f"'{item.definition_key}' isn't this event's definition for '{item.metric_key}'.")


def put_last_year(conn: psycopg.Connection, actor: dict, event_id: int, items: list[ActualIn]) -> bool:
    """Saves the year-ago quarter's numbers. Once every metric has one, a
    hidden event opens for forecasts. Returns whether it opened."""
    event = _event_for_entry(conn, event_id)
    _check_event_definitions(event, items)
    end = event["period_end_date"]
    period = _upsert_period(conn, event["company_id"], year_ago_label(event["fiscal_year_label"]),
                            event["fiscal_quarter"], end.replace(year=end.year - 1))
    put_actuals(conn, actor, period, items)
    have = {(r["metric_key"], r["definition_key"]) for r in conn.execute(
        "SELECT metric_key, definition_key FROM actuals WHERE period_id = %s", (period,)).fetchall()}
    if event["status"] == "draft" and not _missing(event["metric_definitions"]["metrics"], have):
        conn.execute("UPDATE forecast_events SET status = 'open', updated_at = now() WHERE id = %s", (event_id,))
        audit.write(conn, actor["id"], "update", "forecast_event", event_id,
                    {"status": "open", "reason": "last year's numbers complete"})
        return True
    return False


def put_results(conn: psycopg.Connection, actor: dict, event_id: int, items: list[ActualIn],
                from_proposal: bool = False) -> None:
    """Saves the reported numbers for the event's own quarter -- only after
    the lock, so a result can never be visible while forecasts are open.

    from_proposal: the admin approved a committed proposal. Same checks and
    the same save; it only adds an audit entry comparing each saved value
    with the proposed one, so an edit made before approving is on record."""
    event = _event_for_entry(conn, event_id)
    if not event["lock_passed"]:
        raise LeagueError(409, "results_before_lock", "Forecasts are still open. Enter results after the lock time.")
    _check_event_definitions(event, items)
    proposal = _proposal_for(event) if from_proposal else None
    if from_proposal and proposal is None:
        raise LeagueError(409, "no_proposal", "There's no proposal for this company's results.")
    put_actuals(conn, actor, event["period_id"], items)
    if proposal is not None:
        proposed = {m.metric_key: m.value for m in proposal.event.metrics}
        compared = [
            {"metric_key": i.metric_key, "proposed": proposed.get(i.metric_key), "saved": i.value,
             "edited": proposed.get(i.metric_key) is None or abs(proposed[i.metric_key] - i.value) > 1e-9}
            for i in items
        ]
        audit.write(conn, actor["id"], "approve", "result_proposal", event_id, {
            "file": proposal.file, "ticker": event["ticker"],
            "edited": any(c["edited"] for c in compared), "metrics": compared,
        })


def _proposal_for(event: dict) -> Optional[result_proposals.Proposal]:
    return result_proposals.find(event["ticker"], event["fiscal_year_label"], event["fiscal_quarter"],
                                 event["metric_definitions"]["metrics"])


def get_proposal(conn: psycopg.Connection, event_id: int) -> ResultProposalOut:
    """The committed proposal for an event, with last year's value for each
    metric so the reviewer can see the comparison."""
    event = _event_for_entry(conn, event_id)
    proposal = _proposal_for(event)
    if proposal is None:
        raise LeagueError(404, "no_proposal", "There's no proposal for this company's results.")
    last_year = {
        (r["metric_key"], r["definition_key"]): r["value"]
        for r in conn.execute(
            """SELECT a.metric_key, a.definition_key, a.value FROM actuals a JOIN fiscal_periods p ON p.id = a.period_id
               WHERE p.company_id = %s AND p.fiscal_year_label = %s AND p.fiscal_quarter = %s""",
            (event["company_id"], year_ago_label(event["fiscal_year_label"]), event["fiscal_quarter"]),
        ).fetchall()
    }
    defs = {m["key"]: m for m in event["metric_definitions"]["metrics"]}
    return ResultProposalOut(
        event_id=event_id, file=proposal.file, prepared_on=proposal.prepared_on,
        metrics=[
            ProposalMetricOut(
                metric_key=m.metric_key, definition_key=m.definition_key, label=defs[m.metric_key]["label"],
                unit=defs[m.metric_key]["unit"], value=m.value,
                last_year_value=last_year.get((m.metric_key, m.definition_key)),
                source_url=m.source_url, page=m.page, working=m.working, flag=m.flag, note=m.note,
            )
            # In the event's own metric order.
            for m in sorted(proposal.event.metrics, key=lambda m: list(defs).index(m.metric_key))
        ],
    )

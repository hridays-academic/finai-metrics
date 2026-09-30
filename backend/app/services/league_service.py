"""
Results League, user-facing: config, events, forecasts and the league
profile (handle / age band). Admin-side setup lives in league_admin.py.

Integrity rules enforced here AND in the database:
- Whether an event is locked is decided by Postgres `now()` vs `lock_at`,
  never by the client. The triggers in league_schema.py reject any write to
  a locked forecast even if this code had a bug.
- Submitting a forecast is league participation: it needs a handle and an
  age band, and an under-18 user needs guardian consent marked "granted" by
  an admin first. TODO(legal): the consent step is a placeholder -- consent
  is collected on paper through schools for the pilot. Nothing here or in
  the UI may claim legal compliance.
"""
import os
from typing import Optional

import psycopg

from app.league_config import MarketConfig, market_config
from app.league_models import (
    CompanyOut,
    EventDetail,
    EventSummary,
    ForecastIn,
    ForecastOut,
    ForecastValueOut,
    KpiTemplateOut,
    LeagueConfigOut,
    MetricDefinitionOut,
    ProfileIn,
    ReasonTagOut,
)
from app.services import audit

CONFIDENCE = 0.80
NOTE_MAX_CHARS = 140


class LeagueError(Exception):
    """A user-facing rule violation; routes map it to an HTTP error with a
    machine-readable `code` and a plain-English `message`."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def _metric_out(m) -> MetricDefinitionOut:
    return MetricDefinitionOut(
        key=m.key, definition_key=m.definition_key, label=m.label, unit=m.unit,
        definition=m.definition, min_value=m.min_value, max_value=m.max_value,
    )


def config_out(code: str = "IN") -> LeagueConfigOut:
    cfg = market_config(code)
    return LeagueConfigOut(
        market=cfg.code,
        timezone=cfg.timezone,
        confidence=CONFIDENCE,
        core_metrics=[_metric_out(m) for m in cfg.core_metrics],
        kpi_templates=[
            KpiTemplateOut(sector=t.sector, metric=_metric_out(t.metric), source_hint=t.source_hint)
            for t in cfg.kpi_templates.values()
        ],
        reason_tags=[ReasonTagOut(key=t.key, label=t.label) for t in cfg.reason_tags],
        excluded_sectors=sorted(cfg.excluded_sectors),
        note_max_chars=NOTE_MAX_CHARS,
    )


# Demo (seed-script) companies are for local development only and must never
# be listed in production. Vercel sets VERCEL=1 in every deployment.
def _show_demo() -> bool:
    return not os.environ.get("VERCEL")


_EFFECTIVE_STATUS = """
    CASE
        WHEN e.status IN ('draft', 'scored') THEN e.status
        WHEN e.status = 'locked' OR e.lock_at <= now() THEN 'locked'
        ELSE 'open'
    END
"""

_EVENT_SELECT = f"""
    SELECT e.id, e.season_label, e.results_date, e.lock_at, e.metric_definitions, e.research_notes,
           {_EFFECTIVE_STATUS} AS effective_status,
           p.id AS period_id, p.fiscal_year_label, p.fiscal_quarter, p.period_end_date,
           c.id AS company_id, c.market_code, c.exchange, c.ticker, c.name AS company_name, c.sector,
           c.currency, c.provider_symbol,
           EXISTS (SELECT 1 FROM forecasts f WHERE f.event_id = e.id AND f.user_id = %(user_id)s) AS submitted
    FROM forecast_events e
    JOIN fiscal_periods p ON p.id = e.period_id
    JOIN companies c ON c.id = p.company_id
    WHERE (NOT c.is_demo OR %(show_demo)s)
"""


def _summary(row: dict) -> EventSummary:
    return EventSummary(
        id=row["id"],
        company=CompanyOut(
            id=row["company_id"], market_code=row["market_code"], exchange=row["exchange"], ticker=row["ticker"],
            name=row["company_name"], sector=row["sector"], currency=row["currency"],
            provider_symbol=row["provider_symbol"],
        ),
        fiscal_year_label=row["fiscal_year_label"],
        fiscal_quarter=row["fiscal_quarter"],
        period_end_date=row["period_end_date"],
        season_label=row["season_label"],
        results_date=row["results_date"],
        lock_at=row["lock_at"],
        status=row["effective_status"],
        submitted=row["submitted"],
    )


def list_events(conn: psycopg.Connection, user_id: Optional[int], scope: str) -> list[EventSummary]:
    params = {"user_id": user_id or 0, "show_demo": _show_demo()}
    if scope == "upcoming":
        sql = _EVENT_SELECT + " AND e.status IN ('open', 'locked') ORDER BY e.lock_at, c.name"
    elif scope == "scored":
        sql = _EVENT_SELECT + " AND e.status = 'scored' ORDER BY e.results_date DESC, c.name LIMIT 50"
    else:
        raise ValueError(f"unknown scope {scope!r}")
    return [_summary(r) for r in conn.execute(sql, params).fetchall()]


def _load_event(conn: psycopg.Connection, event_id: int, user_id: Optional[int]) -> dict:
    row = conn.execute(
        _EVENT_SELECT + " AND e.id = %(event_id)s",
        {"user_id": user_id or 0, "show_demo": _show_demo(), "event_id": event_id},
    ).fetchone()
    if row is None or row["effective_status"] == "draft":
        raise LeagueError(404, "event_not_found", "That event doesn't exist or isn't open yet.")
    return row


def get_event(conn: psycopg.Connection, event_id: int, user_id: Optional[int]) -> EventDetail:
    row = _load_event(conn, event_id, user_id)
    server_now = conn.execute("SELECT now()").fetchone()["now"]
    metrics = [MetricDefinitionOut(**m) for m in row["metric_definitions"]["metrics"]]
    return EventDetail(
        **_summary(row).model_dump(), metrics=metrics, research_notes=row["research_notes"], server_now=server_now,
    )


# ---------- Eligibility and profile ----------

def forecast_eligibility(user: dict) -> None:
    """Raises LeagueError when this user may not submit forecasts yet."""
    if not user.get("handle") or not user.get("age_band"):
        raise LeagueError(409, "profile_required", "Choose a public handle and your age group before forecasting.")
    if user["age_band"] == "under_18" and user.get("guardian_consent_status") != "granted":
        # TODO(legal): placeholder consent step -- see the module docstring.
        raise LeagueError(
            403,
            "guardian_consent_pending",
            "Because you're under 18, a parent or guardian's consent is needed before you can join the "
            "league. Your school collects the form; once it's recorded you can forecast. Practice stays open.",
        )


def update_profile(conn: psycopg.Connection, user: dict, data: ProfileIn) -> None:
    """Sets the league identity. The age band can only be set once by the
    user (an admin can correct it), so an under-18 account can't lift the
    consent requirement by changing its own answer."""
    if user.get("age_band") and user["age_band"] != data.age_band:
        raise LeagueError(409, "age_band_locked", "Your age group is already set. Ask your teacher or an admin to change it.")
    taken = conn.execute(
        "SELECT 1 FROM users WHERE lower(handle) = lower(%s) AND id <> %s", (data.handle, user["id"])
    ).fetchone()
    if taken:
        raise LeagueError(409, "handle_taken", "That handle is taken. Try another.")
    consent = user.get("guardian_consent_status")
    if data.age_band == "18_plus":
        consent = "not_required"
    elif consent != "granted":
        consent = "pending"
    conn.execute(
        "UPDATE users SET handle = %s, age_band = %s, school_name = %s, guardian_consent_status = %s WHERE id = %s",
        (data.handle, data.age_band, (data.school_name or "").strip() or None, consent, user["id"]),
    )
    audit.write(conn, user["id"], "update", "user_profile", user["id"],
                {"handle": data.handle, "age_band": data.age_band, "guardian_consent_status": consent})


# ---------- Forecasts ----------

def _validate_forecast(cfg: MarketConfig, metrics: list[dict], data: ForecastIn) -> None:
    required = {m["key"]: m for m in metrics}
    given = [v.metric_key for v in data.values]
    if len(given) != len(set(given)):
        raise LeagueError(422, "duplicate_metric", "Each metric can only be forecast once.")
    missing = set(required) - set(given)
    if missing:
        labels = ", ".join(required[k]["label"] for k in sorted(missing))
        raise LeagueError(422, "missing_metric", f"Please give a range for every metric: {labels}.")
    extra = set(given) - set(required)
    if extra:
        raise LeagueError(422, "unknown_metric", f"This event doesn't include: {', '.join(sorted(extra))}.")
    for v in data.values:
        m = required[v.metric_key]
        if v.low < m["min_value"] or v.high > m["max_value"]:
            raise LeagueError(
                422, "out_of_bounds",
                f"{m['label']} must be between {m['min_value']:g}{m['unit']} and {m['max_value']:g}{m['unit']}.",
            )
    allowed_tags = {t.key for t in cfg.reason_tags}
    bad = set(data.reason_tags) - allowed_tags
    if bad:
        raise LeagueError(422, "unknown_reason_tag", f"Unknown reason: {', '.join(sorted(bad))}.")


def _locked_error() -> LeagueError:
    return LeagueError(409, "forecast_locked", "Forecasts for this event are locked. Results are coming soon.")


def save_forecast(conn: psycopg.Connection, user: dict, event_id: int, data: ForecastIn) -> ForecastOut:
    forecast_eligibility(user)
    row = _load_event(conn, event_id, user["id"])
    if row["effective_status"] != "open":
        raise _locked_error()
    cfg = market_config(row["market_code"])
    metrics = row["metric_definitions"]["metrics"]
    _validate_forecast(cfg, metrics, data)
    tags = sorted(set(data.reason_tags))
    try:
        f = conn.execute(
            """
            INSERT INTO forecasts (event_id, user_id, reason_tags, note)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (event_id, user_id)
            DO UPDATE SET reason_tags = EXCLUDED.reason_tags, note = EXCLUDED.note, updated_at = now()
            RETURNING id, (xmax = 0) AS created
            """,
            (event_id, user["id"], tags, data.note),
        ).fetchone()
        for v in data.values:
            conn.execute(
                """
                INSERT INTO forecast_values (forecast_id, metric_key, low, high, confidence)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (forecast_id, metric_key) DO UPDATE SET low = EXCLUDED.low, high = EXCLUDED.high
                """,
                (f["id"], v.metric_key, v.low, v.high, CONFIDENCE),
            )
        audit.write(
            conn, user["id"], "create" if f["created"] else "update", "forecast", f["id"],
            {"event_id": event_id, "values": [v.model_dump() for v in data.values], "reason_tags": tags,
             "note": data.note},
        )
    except psycopg.errors.CheckViolation as exc:
        if "forecast_locked" in str(exc):
            raise _locked_error() from exc
        raise
    return get_my_forecast(conn, user["id"], event_id)


def get_my_forecast(conn: psycopg.Connection, user_id: int, event_id: int) -> Optional[ForecastOut]:
    f = conn.execute(
        f"""
        SELECT f.id, f.submitted_at, f.updated_at, f.reason_tags, f.note,
               ({_EFFECTIVE_STATUS}) <> 'open' AS locked
        FROM forecasts f JOIN forecast_events e ON e.id = f.event_id
        WHERE f.event_id = %s AND f.user_id = %s
        """,
        (event_id, user_id),
    ).fetchone()
    if f is None:
        return None
    values = conn.execute(
        "SELECT metric_key, low, high, confidence FROM forecast_values WHERE forecast_id = %s ORDER BY metric_key",
        (f["id"],),
    ).fetchall()
    return ForecastOut(
        event_id=event_id, submitted_at=f["submitted_at"], updated_at=f["updated_at"],
        reason_tags=list(f["reason_tags"]), note=f["note"], locked=f["locked"],
        values=[ForecastValueOut(**dict(v)) for v in values],
    )

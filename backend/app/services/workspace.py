"""Research workspace: a student's notes, ticked steps and driver worksheet
for one event, plus the step text and league figures the page shows.

Rules (Hriday, 2026-11-13):
- Anyone can read the steps and use the worksheet on screen. Saving needs
  the same as forecasting (terms, handle and age group, and for under-18s a
  parent's consent recorded by an admin); otherwise nothing is stored.
- Notes and ticks stay editable after the lock; the worksheet can't be
  changed once the event locks (checked here and by a database trigger).
- Private to the student: no admin view. Deleted with the account."""
from typing import Optional

import psycopg
from psycopg.types.json import Jsonb

from app.glossary import glossary
from app.services.league_admin import year_ago_label
from app.services.league_service import LeagueError, _load_event, forecast_eligibility
from app.workspace_config import steps_for
from app.workspace_models import BaseFigure, WorkspaceIn, WorkspaceOut, WorkspaceState

_SAVE_MESSAGES = {
    "sign_in": "Sign in to save your notes.",
    "terms_required": "Please agree to the Terms of Use and Privacy Policy first.",
    "profile_required": "Choose a public handle and your age group to save your notes.",
    "guardian_consent_pending": "Your notes will be saved once your parent's consent is recorded.",
}


def save_blocked(user: Optional[dict]) -> Optional[str]:
    if user is None:
        return "sign_in"
    try:
        forecast_eligibility(user)
    except LeagueError as exc:
        return exc.code
    return None


def _previous_quarter(fy_label: str, quarter: int) -> tuple[str, int]:
    return (fy_label, quarter - 1) if quarter > 1 else (year_ago_label(fy_label), 4)


def _figures(conn: psycopg.Connection, company_id: int, fy_label: str, quarter: int, metrics: list[dict]) -> list[BaseFigure]:
    """League actuals for one quarter, only under the event's own definitions."""
    wanted = {m["key"]: m["definition_key"] for m in metrics}
    rows = conn.execute(
        """SELECT a.metric_key, a.definition_key, a.value, a.source_url
           FROM actuals a JOIN fiscal_periods p ON p.id = a.period_id
           WHERE p.company_id = %s AND p.fiscal_year_label = %s AND p.fiscal_quarter = %s""",
        (company_id, fy_label, quarter),
    ).fetchall()
    out = [
        BaseFigure(metric_key=r["metric_key"], value=r["value"], source_url=r["source_url"],
                   fiscal_year_label=fy_label, fiscal_quarter=quarter)
        for r in rows
        if wanted.get(r["metric_key"]) == r["definition_key"]
    ]
    order = list(wanted)
    return sorted(out, key=lambda f: order.index(f.metric_key))


def _news_since(conn: psycopg.Connection, company_id: int, event_id: int, results_date) -> Optional[object]:
    row = conn.execute(
        """SELECT max(e.results_date) AS d FROM forecast_events e JOIN fiscal_periods p ON p.id = e.period_id
           WHERE p.company_id = %s AND e.id <> %s AND e.status <> 'draft' AND e.results_date < %s""",
        (company_id, event_id, results_date),
    ).fetchone()
    return row["d"]


def _state(conn: psycopg.Connection, user_id: int, event_id: int) -> WorkspaceState:
    row = conn.execute(
        "SELECT notes, done, worksheet, updated_at FROM research_workspaces WHERE user_id = %s AND event_id = %s",
        (user_id, event_id),
    ).fetchone()
    if row is None:
        return WorkspaceState()
    return WorkspaceState(
        notes={k: v for k, v in (row["notes"] or {}).items() if v},
        done=list(row["done"]),
        worksheet=row["worksheet"],
        updated_at=row["updated_at"],
    )


def get_workspace(conn: psycopg.Connection, user: Optional[dict], event_id: int) -> WorkspaceOut:
    row = _load_event(conn, event_id, user["id"] if user else None)
    metrics = row["metric_definitions"]["metrics"]
    company_id = row["company_id"]
    fy, q = row["fiscal_year_label"], row["fiscal_quarter"]
    prev_fy, prev_q = _previous_quarter(fy, q)
    return WorkspaceOut(
        event_id=event_id,
        sector=row["sector"],
        locked=row["effective_status"] != "open",
        status=row["effective_status"],
        steps=steps_for(row["sector"]),
        glossary=glossary(row["market_code"]),
        last_year=_figures(conn, company_id, year_ago_label(fy), q, metrics),
        last_quarter=_figures(conn, company_id, prev_fy, prev_q, metrics),
        news_since=_news_since(conn, company_id, event_id, row["results_date"]),
        save_blocked=save_blocked(user),
        state=_state(conn, user["id"], event_id) if user else None,
    )


def save_workspace(conn: psycopg.Connection, user: dict, event_id: int, data: WorkspaceIn) -> WorkspaceState:
    blocked = save_blocked(user)
    if blocked:
        raise LeagueError(403 if blocked != "profile_required" else 409, blocked, _SAVE_MESSAGES[blocked])
    row = _load_event(conn, event_id, user["id"])
    sent = data.model_fields_set
    if "worksheet" in sent and row["effective_status"] != "open":
        raise LeagueError(409, "worksheet_locked", "Forecasts are locked, so the worksheet is hidden.")

    notes = data.notes if "notes" in sent and data.notes is not None else {}
    done = data.done if "done" in sent and data.done is not None else []
    worksheet = data.worksheet.model_dump() if "worksheet" in sent and data.worksheet is not None else None
    updates = ["updated_at = now()"]
    if "notes" in sent and data.notes is not None:
        updates.append("notes = research_workspaces.notes || EXCLUDED.notes")
    if "done" in sent and data.done is not None:
        updates.append("done = EXCLUDED.done")
    if "worksheet" in sent:
        updates.append("worksheet = EXCLUDED.worksheet")
    try:
        conn.execute(
            f"""INSERT INTO research_workspaces (user_id, event_id, notes, done, worksheet)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (user_id, event_id) DO UPDATE SET {', '.join(updates)}""",
            (user["id"], event_id, Jsonb(notes), done, Jsonb(worksheet) if worksheet is not None else None),
        )
    except psycopg.errors.CheckViolation as exc:
        if "worksheet_locked" in str(exc):
            raise LeagueError(409, "worksheet_locked", "Forecasts are locked, so the worksheet is hidden.") from exc
        raise
    return _state(conn, user["id"], event_id)


def clear_workspace(conn: psycopg.Connection, user: dict, event_id: int) -> None:
    conn.execute("DELETE FROM research_workspaces WHERE user_id = %s AND event_id = %s", (user["id"], event_id))

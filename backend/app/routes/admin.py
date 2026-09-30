from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.league_models import (
    ActualIn,
    ActualOut,
    AdminUserOut,
    AuditEntryOut,
    BaselineIn,
    ConsentIn,
    EventPatch,
    PeriodIn,
    QuickEventIn,
)
from app.routes.deps import require_admin
from app.services import audit, league_admin, visits
from app.services.db import get_conn

router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])


class DailyVisits(BaseModel):
    day: str  # YYYY-MM-DD, India time
    page: str
    count: int


class VisitsResponse(BaseModel):
    days: int
    rows: list[DailyVisits]


class IdOut(BaseModel):
    id: int


@router.get("/visits", response_model=VisitsResponse)
def get_visits(days: int = Query(30, ge=1, le=366)) -> VisitsResponse:
    return VisitsResponse(days=days, rows=visits.daily_counts(days))


@router.get("/events")
def list_events() -> list[dict]:
    with get_conn() as conn:
        return league_admin.list_admin_events(conn)


@router.post("/events/quick", response_model=IdOut)
def quick_event(body: QuickEventIn, admin: dict = Depends(require_admin)) -> IdOut:
    with get_conn() as conn:
        return IdOut(id=league_admin.quick_event(conn, admin, body))


@router.patch("/events/{event_id}", status_code=204)
def update_event(event_id: int, body: EventPatch, admin: dict = Depends(require_admin)) -> None:
    with get_conn() as conn:
        league_admin.update_event(conn, admin, event_id, body)


@router.put("/events/{event_id}/baselines", status_code=204)
def put_baselines(event_id: int, body: list[BaselineIn], admin: dict = Depends(require_admin)) -> None:
    with get_conn() as conn:
        league_admin.put_baselines(conn, admin, event_id, body)


@router.post("/periods", response_model=IdOut)
def create_period(body: PeriodIn, admin: dict = Depends(require_admin)) -> IdOut:
    with get_conn() as conn:
        return IdOut(id=league_admin.create_period(conn, admin, body))


@router.put("/periods/{period_id}/actuals", status_code=204)
def put_actuals(period_id: int, body: list[ActualIn], admin: dict = Depends(require_admin)) -> None:
    with get_conn() as conn:
        league_admin.put_actuals(conn, admin, period_id, body)


@router.get("/companies/{company_id}/actuals", response_model=list[ActualOut])
def company_actuals(company_id: int) -> list[ActualOut]:
    with get_conn() as conn:
        return league_admin.list_actuals(conn, company_id)


@router.get("/users", response_model=list[AdminUserOut])
def find_users(q: Optional[str] = Query(None, max_length=80)) -> list[AdminUserOut]:
    with get_conn() as conn:
        return league_admin.find_users(conn, q)


@router.put("/users/{user_id}/guardian-consent", status_code=204)
def set_consent(user_id: int, body: ConsentIn, admin: dict = Depends(require_admin)) -> None:
    with get_conn() as conn:
        league_admin.set_guardian_consent(conn, admin, user_id, body.status)


@router.get("/audit", response_model=list[AuditEntryOut])
def audit_log(limit: int = Query(100, ge=1, le=500), entity: Optional[str] = Query(None, max_length=40)) -> list[AuditEntryOut]:
    with get_conn() as conn:
        return [AuditEntryOut(**r) for r in audit.recent(conn, limit, entity)]

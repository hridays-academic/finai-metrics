from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.routes.deps import require_admin
from app.services import visits

router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])


class DailyVisits(BaseModel):
    day: str  # YYYY-MM-DD, India time
    page: str
    count: int


class VisitsResponse(BaseModel):
    days: int
    rows: list[DailyVisits]


@router.get("/visits", response_model=VisitsResponse)
def get_visits(days: int = Query(30, ge=1, le=366)) -> VisitsResponse:
    return VisitsResponse(days=days, rows=visits.daily_counts(days))

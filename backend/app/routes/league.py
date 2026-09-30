from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.league_models import EventDetail, EventSummary, ForecastIn, ForecastOut, LeagueConfigOut, ProfileIn, ResearchHistoryOut
from app.models import UserPublic
from app.routes.deps import optional_user, require_user
from app.services import auth_service, league_service, research_history
from app.services.db import get_conn

router = APIRouter(prefix="/api/league")


@router.get("/config", response_model=LeagueConfigOut)
def get_config() -> LeagueConfigOut:
    return league_service.config_out("IN")


@router.get("/events", response_model=list[EventSummary])
def list_events(
    scope: str = Query("upcoming", pattern="^(upcoming|scored)$"),
    user: Optional[dict] = Depends(optional_user),
) -> list[EventSummary]:
    with get_conn() as conn:
        return league_service.list_events(conn, user["id"] if user else None, scope)


@router.get("/events/{event_id}", response_model=EventDetail)
def get_event(event_id: int, user: Optional[dict] = Depends(optional_user)) -> EventDetail:
    with get_conn() as conn:
        return league_service.get_event(conn, event_id, user["id"] if user else None)


@router.get("/events/{event_id}/my-forecast", response_model=Optional[ForecastOut])
def get_my_forecast(event_id: int, user: dict = Depends(require_user)) -> Optional[ForecastOut]:
    with get_conn() as conn:
        return league_service.get_my_forecast(conn, user["id"], event_id)


@router.put("/events/{event_id}/forecast", response_model=ForecastOut)
def save_forecast(event_id: int, body: ForecastIn, user: dict = Depends(require_user)) -> ForecastOut:
    with get_conn() as conn:
        return league_service.save_forecast(conn, user, event_id, body)


@router.get("/companies/{company_id}/history", response_model=ResearchHistoryOut)
def company_history(company_id: int) -> ResearchHistoryOut:
    return research_history.company_history(company_id)


@router.patch("/me", response_model=UserPublic)
def update_me(body: ProfileIn, user: dict = Depends(require_user)) -> UserPublic:
    with get_conn() as conn:
        league_service.update_profile(conn, user, body)
    fresh = auth_service.get_user_by_id(user["id"])
    return UserPublic(**fresh)

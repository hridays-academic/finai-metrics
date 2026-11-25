from typing import Optional

from pydantic import BaseModel
from fastapi import APIRouter, Depends, Query

from app.league_models import (
    EventDetail, EventOutcomeOut, EventSummary, ForecastIn, ForecastOut, LeagueConfigOut, ProfileIn,
    RecentResultOut, ResearchHistoryOut, ResultOut, SeasonOut,
)
from app.models import UserPublic
from app.routes.deps import optional_user, require_user
from app.services import auth_service, league_scoring, league_service, research_history
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


@router.get("/events/{event_id}/my-result", response_model=ResultOut)
def get_my_result(event_id: int, user: dict = Depends(require_user)) -> ResultOut:
    with get_conn() as conn:
        return league_scoring.my_result(conn, user["id"], event_id)


@router.get("/events/{event_id}/outcome", response_model=EventOutcomeOut)
def get_outcome(event_id: int, user: Optional[dict] = Depends(optional_user)) -> EventOutcomeOut:
    """Public: how a scored company turned out (no forecast or sign-in needed)."""
    with get_conn() as conn:
        return league_scoring.outcome(conn, user["id"] if user else None, event_id)


@router.get("/recent-results", response_model=list[RecentResultOut])
def get_recent_results(user: Optional[dict] = Depends(optional_user)) -> list[RecentResultOut]:
    with get_conn() as conn:
        return league_scoring.recent_results(conn, user["id"] if user else None)


@router.get("/me/season", response_model=SeasonOut)
def get_my_season(user: dict = Depends(require_user)) -> SeasonOut:
    with get_conn() as conn:
        return league_scoring.season(conn, user["id"])


@router.put("/events/{event_id}/forecast", response_model=ForecastOut)
def save_forecast(event_id: int, body: ForecastIn, user: dict = Depends(require_user)) -> ForecastOut:
    with get_conn() as conn:
        return league_service.save_forecast(conn, user, event_id, body)


@router.get("/companies/{company_id}/history", response_model=ResearchHistoryOut)
def company_history(company_id: int) -> ResearchHistoryOut:
    return research_history.company_history(company_id)


@router.post("/me/guide-seen", response_model=UserPublic)
def guide_seen(user: dict = Depends(require_user)) -> UserPublic:
    auth_service.mark_guide_seen(user["id"])
    return UserPublic(**auth_service.get_user_by_id(user["id"]))


@router.patch("/me", response_model=UserPublic)
def update_me(body: ProfileIn, user: dict = Depends(require_user)) -> UserPublic:
    with get_conn() as conn:
        league_service.update_profile(conn, user, body)
    fresh = auth_service.get_user_by_id(user["id"])
    return UserPublic(**fresh)


class ResearchCompanyOut(BaseModel):
    id: int
    name: str
    ticker: str
    symbol: str
    sector: str
    sector_name: str


@router.get("/companies", response_model=list[ResearchCompanyOut])
def research_companies() -> list[ResearchCompanyOut]:
    """RW1 (phase 7): the league and practice companies, for Research's tiles."""
    from app.league_config import market_config
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT DISTINCT c.id, c.name, c.ticker, c.provider_symbol, c.sector, c.market_code
               FROM companies c JOIN fiscal_periods p ON p.company_id = c.id
               JOIN forecast_events e ON e.period_id = p.id
               WHERE NOT c.is_demo AND c.provider_symbol IS NOT NULL AND e.status <> 'draft'
               ORDER BY c.name"""
        ).fetchall()
    out = []
    for r in rows:
        ex = market_config(r["market_code"]).sector_explainers.get(r["sector"])
        out.append(ResearchCompanyOut(id=r["id"], name=r["name"], ticker=r["ticker"], symbol=r["provider_symbol"], sector=r["sector"],
                                      sector_name=ex.display_name if ex else r["sector"]))
    return out

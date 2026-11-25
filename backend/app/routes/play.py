"""Quick rounds (phase 5) and the daily challenge (phase 6). See services/play.py."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.routes.deps import optional_user
from app.services import play, progress, rate_limit
from app.services.db import get_conn

router = APIRouter(prefix="/api/play")


@router.get("/cards", response_model=list[play.PlayCard])
def list_cards(mystery: bool = Query(True), user: Optional[dict] = Depends(optional_user)) -> list[play.PlayCard]:
    with get_conn() as conn:
        hard_ok = progress.level_of(conn, user) >= progress.HARD_LEVEL
        return play.cards(conn, mystery, hard_ok=hard_ok)


@router.post("/cards/{card_id}/reveal", response_model=play.RevealOut)
def reveal(card_id: str, body: play.RevealIn) -> play.RevealOut:
    with get_conn() as conn:
        return play.reveal(conn, card_id, body)


@router.get("/daily", response_model=play.DailyOut)
def daily(mystery: bool = Query(True), user: Optional[dict] = Depends(optional_user)) -> play.DailyOut:
    with get_conn() as conn:
        return play.daily(conn, user, mystery)


@router.post("/rounds", response_model=play.RoundOut)
def submit_round(body: play.RoundIn, request: Request, user: Optional[dict] = Depends(optional_user)) -> play.RoundOut:
    ip = rate_limit.client_ip(request.headers, request.client.host if request.client else None)
    result = rate_limit.check_auth("play_round", ip)
    if not result.allowed:
        raise HTTPException(status_code=429, detail=rate_limit.friendly_message(result),
                            headers={"Retry-After": str(result.retry_after)})
    with get_conn() as conn:
        return play.submit_round(conn, user, body)

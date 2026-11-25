"""Quick rounds (phase 5). See services/play.py."""
from fastapi import APIRouter, Query

from app.services import play
from app.services.db import get_conn

router = APIRouter(prefix="/api/play")


@router.get("/cards", response_model=list[play.PlayCard])
def list_cards(mystery: bool = Query(True)) -> list[play.PlayCard]:
    with get_conn() as conn:
        return play.cards(conn, mystery)


@router.post("/cards/{card_id}/reveal", response_model=play.RevealOut)
def reveal(card_id: str, body: play.RevealIn) -> play.RevealOut:
    with get_conn() as conn:
        return play.reveal(conn, card_id, body)

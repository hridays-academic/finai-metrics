"""Practice (2026-11-18): past quarters with known results, scored straight
away. Logic in services/practice.py; the share-price route lives in main.py
next to the price cache it reads. Rate-limited per IP (main.py wires it)."""
from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.league_models import (
    PracticeAttemptIn, PracticeAttemptOut, PracticeCardOut, PracticeCaseOut, PracticeMineOut,
)
from app.routes.deps import optional_user, require_user
from app.services import practice, research_history
from app.services.db import get_conn

router = APIRouter(prefix="/api/practice")


@router.get("/cases", response_model=list[PracticeCardOut])
def list_cases(mystery: bool = Query(True), user: Optional[dict] = Depends(optional_user)) -> list[PracticeCardOut]:
    with get_conn() as conn:
        return practice.list_cases(conn, user["id"] if user else None, mystery)


@router.get("/cases/{code}", response_model=PracticeCaseOut)
def get_case(code: str, mystery: bool = Query(True)) -> PracticeCaseOut:
    with get_conn() as conn:
        symbol, _company = practice.provider_symbol(conn, code)
    # Never holds a connection across Yahoo (research_history fetches cache-first).
    quarters, as_of = research_history.provider_quarters(symbol)
    with get_conn() as conn:
        return practice.get_case(conn, code, mystery, quarters, as_of)


@router.post("/cases/{code}/attempt", response_model=PracticeAttemptOut)
def submit(code: str, body: PracticeAttemptIn, user: Optional[dict] = Depends(optional_user)) -> PracticeAttemptOut:
    with get_conn() as conn:
        return practice.attempt(conn, user, code, body)


@router.get("/me", response_model=list[PracticeMineOut])
def mine(user: dict = Depends(require_user)) -> list[PracticeMineOut]:
    with get_conn() as conn:
        return practice.my_practice(conn, user["id"])

"""Progress, profile and leaderboards (phase 6). See services/progress.py and
services/boards.py."""
from typing import Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.routes.deps import optional_user, require_admin, require_user
from app.services import boards, progress
from app.services.db import get_conn

router = APIRouter()


class LeaderboardPrefIn(BaseModel):
    hidden: bool


class HandleStatusIn(BaseModel):
    status: Literal["ok", "review", "blocked"]


@router.get("/api/me/progress", response_model=progress.ProgressOut)
def my_progress(user: dict = Depends(require_user)) -> progress.ProgressOut:
    with get_conn() as conn:
        return progress.profile(conn, user)


@router.put("/api/me/leaderboard", status_code=204)
def set_leaderboard(body: LeaderboardPrefIn, user: dict = Depends(require_user)) -> None:
    with get_conn() as conn:
        boards.set_opt_out(conn, user, body.hidden)


@router.get("/api/boards/{which}", response_model=boards.BoardOut)
def get_board(which: Literal["week", "season", "improved"], user: Optional[dict] = Depends(optional_user)) -> boards.BoardOut:
    with get_conn() as conn:
        return boards.board(conn, which, user)


@router.get("/api/admin/handles", response_model=list[boards.HandleReviewOut], dependencies=[Depends(require_admin)])
def handles_for_review() -> list[boards.HandleReviewOut]:
    with get_conn() as conn:
        return boards.handles_for_review(conn)


@router.put("/api/admin/users/{user_id}/handle-status", status_code=204)
def set_handle_status(user_id: int, body: HandleStatusIn, admin: dict = Depends(require_admin)) -> None:
    with get_conn() as conn:
        boards.set_handle_status(conn, admin, user_id, body.status)

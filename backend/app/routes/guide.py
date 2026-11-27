"""The AI guide's routes (phase 12). Logic lives in services/guide.py."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.routes.deps import optional_user, require_admin
from app.services import guide
from app.services.db import get_conn

router = APIRouter()


@router.get("/api/guide/status", response_model=guide.StatusOut)
def guide_status(user: Optional[dict] = Depends(optional_user)) -> guide.StatusOut:
    # Always 200 (never a 404 a browser would log): the launcher shows only
    # when `available` is true.
    with get_conn() as conn:
        return guide.status(conn, user)


@router.post("/api/guide/ask")
def ask(body: guide.AskIn, user: Optional[dict] = Depends(optional_user)) -> StreamingResponse:
    with get_conn() as conn:
        if guide.live_mode(conn) == "off":
            raise HTTPException(status_code=404, detail="Not found")
        if user is None:
            raise HTTPException(status_code=401, detail="Please sign in to continue.")
        prepared = guide.prepare(conn, user, body)
    # The database connection is closed before the model is called.
    return StreamingResponse(guide.stream(prepared, body), media_type="application/x-ndjson",
                             headers={"Cache-Control": "private, no-store", "X-Accel-Buffering": "no"})


class ModeIn(BaseModel):
    mode: guide.Mode


@router.get("/api/admin/guide", response_model=guide.AdminGuideOut, dependencies=[Depends(require_admin)])
def admin_guide() -> guide.AdminGuideOut:
    with get_conn() as conn:
        return guide.admin_state(conn)


@router.put("/api/admin/guide", response_model=guide.AdminGuideOut)
def set_guide_mode(body: ModeIn, admin: dict = Depends(require_admin)) -> guide.AdminGuideOut:
    with get_conn() as conn:
        guide.set_mode(conn, admin, body.mode)
        return guide.admin_state(conn)

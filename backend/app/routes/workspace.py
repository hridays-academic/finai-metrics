from typing import Optional

from fastapi import APIRouter, Depends, Response

from app.routes.deps import optional_user, require_user
from app.services import workspace
from app.services.db import get_conn
from app.workspace_models import WorkspaceIn, WorkspaceOut, WorkspaceState

router = APIRouter(prefix="/api/workspace")


@router.get("/{event_id}", response_model=WorkspaceOut)
def get_workspace(event_id: int, user: Optional[dict] = Depends(optional_user)) -> WorkspaceOut:
    """Steps and league figures for anyone; the saved state for the signed-in student."""
    with get_conn() as conn:
        return workspace.get_workspace(conn, user, event_id)


@router.put("/{event_id}", response_model=WorkspaceState)
def save_workspace(event_id: int, body: WorkspaceIn, user: dict = Depends(require_user)) -> WorkspaceState:
    with get_conn() as conn:
        return workspace.save_workspace(conn, user, event_id, body)


@router.delete("/{event_id}", status_code=204)
def clear_workspace(event_id: int, user: dict = Depends(require_user)) -> Response:
    with get_conn() as conn:
        workspace.clear_workspace(conn, user, event_id)
    return Response(status_code=204)

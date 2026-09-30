from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from app.services import visits

router = APIRouter()


class VisitRequest(BaseModel):
    page: str = Field(max_length=40)


@router.post("/api/visit", status_code=204)
def record_visit(request: VisitRequest) -> Response:
    """Aggregate page-load count; see services/visits.py for what is (and
    deliberately isn't) stored."""
    try:
        visits.record(request.page)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Unknown page.") from exc
    return Response(status_code=204)

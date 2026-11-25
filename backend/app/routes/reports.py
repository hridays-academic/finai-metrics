"""Usage counts, error reports and "Something wrong? Tell us" (phase 2).
See services/reports.py for what is and isn't stored."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app.routes.deps import require_admin
from app.services import rate_limit, reports

router = APIRouter()


def _limit(scope: str, request: Request) -> None:
    ip = rate_limit.client_ip(request.headers, request.client.host if request.client else None)
    result = rate_limit.check_auth(scope, ip)
    if not result.allowed:
        raise HTTPException(status_code=429, detail=rate_limit.friendly_message(result),
                            headers={"Retry-After": str(result.retry_after)})


class UsageIn(BaseModel):
    event: str = Field(max_length=40)
    page: str = Field(default="", max_length=40)


class ErrorIn(BaseModel):
    message: str = Field(max_length=2000)
    page: str = Field(default="", max_length=200)
    build: str = Field(default="", max_length=80)


class FeedbackIn(BaseModel):
    message: str = Field(min_length=3, max_length=1000)
    email: Optional[str] = Field(default=None, max_length=200, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    page: str = Field(default="", max_length=200)


@router.post("/api/usage", status_code=204)
def usage(body: UsageIn) -> Response:
    """One step happened (option a: a daily total, nothing about the visitor)."""
    try:
        reports.record_usage(body.event, body.page)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Unknown event.") from exc
    return Response(status_code=204)


@router.post("/api/client-error", status_code=204)
def client_error(body: ErrorIn, request: Request) -> Response:
    _limit("client_error", request)
    reports.record_error(body.message, body.page, body.build)
    return Response(status_code=204)


@router.post("/api/feedback", status_code=204)
def feedback(body: FeedbackIn, request: Request) -> Response:
    _limit("feedback", request)
    reports.add_feedback(body.message.strip(), body.email, body.page)
    return Response(status_code=204)


@router.get("/api/admin/errors", dependencies=[Depends(require_admin)])
def admin_errors() -> list[dict]:
    return reports.recent_errors(100)


@router.get("/api/admin/feedback", dependencies=[Depends(require_admin)])
def admin_feedback() -> list[dict]:
    return reports.recent_feedback(100)


@router.get("/api/admin/numbers", dependencies=[Depends(require_admin)])
def admin_numbers(weeks: int = 8) -> list[dict]:
    return reports.weekly_numbers(max(1, min(weeks, 26)))

"""Schools (phase 8). See services/schools.py."""
import os
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from app.config import get_settings
from app.routes.deps import require_admin, require_user
from app.services import boards, gmail_service, guide, schools
from app.services.db import get_conn

router = APIRouter()


class RoleIn(BaseModel):
    role: Literal["student", "teacher"]


class ShowNamesIn(BaseModel):
    show_names: bool


class StepIn(BaseModel):
    action: Literal["reveal", "next", "end"]


def _origin(request: Request) -> str:
    settings = get_settings()
    allowed = list(settings.public_origin_list)
    if not os.environ.get("VERCEL"):
        allowed += [o.rstrip("/") for o in settings.cors_origin_list]
    origin = (request.headers.get("origin") or "").rstrip("/")
    return origin if origin in allowed else settings.public_origin_list[0]


@router.put("/api/admin/users/{user_id}/role", status_code=204)
def set_role(user_id: int, body: RoleIn, admin: dict = Depends(require_admin)) -> None:
    with get_conn() as conn:
        schools.set_role(conn, admin, user_id, body.role)


@router.put("/api/admin/classes/{class_id}/show-names", status_code=204)
def set_show_names(class_id: int, body: ShowNamesIn, admin: dict = Depends(require_admin)) -> None:
    with get_conn() as conn:
        schools.set_show_names(conn, admin, class_id, body.show_names)


@router.get("/api/admin/paper-forms", response_model=list[schools.PaperFormOut], dependencies=[Depends(require_admin)])
def paper_forms() -> list[schools.PaperFormOut]:
    with get_conn() as conn:
        return schools.paper_forms(conn)


@router.get("/api/classes", response_model=list[schools.ClassOut])
def my_classes(user: dict = Depends(require_user)) -> list[schools.ClassOut]:
    with get_conn() as conn:
        return schools.my_classes(conn, user)


@router.post("/api/classes", response_model=schools.ClassOut)
def create_class(body: schools.ClassIn, user: dict = Depends(require_user)) -> schools.ClassOut:
    with get_conn() as conn:
        return schools.create_class(conn, user, body)


@router.post("/api/classes/join", response_model=schools.ClassOut)
def join_class(body: schools.JoinIn, user: dict = Depends(require_user)) -> schools.ClassOut:
    with get_conn() as conn:
        return schools.join_class(conn, user, body.code)


@router.delete("/api/classes/{class_id}/membership", status_code=204)
def leave_class(class_id: int, user: dict = Depends(require_user)) -> None:
    with get_conn() as conn:
        schools.leave_class(conn, user, class_id)


@router.get("/api/classes/{class_id}/students", response_model=schools.TeacherViewOut, response_model_by_alias=True)
def teacher_view(class_id: int, user: dict = Depends(require_user)) -> schools.TeacherViewOut:
    with get_conn() as conn:
        return schools.teacher_view(conn, user, class_id)


@router.put("/api/classes/{class_id}/students/{student_id}/paper-form", status_code=204)
def mark_paper_form(class_id: int, student_id: int, user: dict = Depends(require_user)) -> None:
    with get_conn() as conn:
        schools.mark_paper_form(conn, user, class_id, student_id)


@router.get("/api/classes/{class_id}/boards/{which}", response_model=boards.BoardOut)
def class_board(class_id: int, which: Literal["week", "season", "improved"], user: dict = Depends(require_user)) -> boards.BoardOut:
    with get_conn() as conn:
        members = schools.class_board_members(conn, user, class_id)
        return boards.board(conn, which, user, members=members)


@router.post("/api/me/consent-request", status_code=204)
def request_consent(body: schools.ConsentRequestIn, request: Request, user: dict = Depends(require_user)) -> None:
    with get_conn() as conn:
        schools.request_consent(conn, user, body, _origin(request))


@router.put("/api/classes/{class_id}/students/{student_id}/guide-form", status_code=204)
def mark_guide_form(class_id: int, student_id: int, user: dict = Depends(require_user)) -> None:
    with get_conn() as conn:
        schools.mark_guide_form(conn, user, class_id, student_id)


class GuideConsentIn(BaseModel):
    granted: bool


@router.put("/api/admin/users/{user_id}/guide-consent", status_code=204)
def set_guide_consent(user_id: int, body: GuideConsentIn, admin: dict = Depends(require_admin)) -> None:
    with get_conn() as conn:
        schools.set_guide_consent(conn, admin, user_id, body.granted)


@router.get("/api/consent/{token}", response_model=schools.ConsentPageOut)
def consent_page(token: str) -> schools.ConsentPageOut:
    with get_conn() as conn:
        return schools.consent_page(conn, token)


@router.post("/api/consent/{token}", status_code=204)
def answer_consent(token: str, body: schools.ConsentAnswerIn) -> None:
    with get_conn() as conn:
        schools.answer_consent(conn, token, body)


@router.post("/api/classes/{class_id}/sessions", response_model=schools.SessionOut)
def start_session(class_id: int, user: dict = Depends(require_user)) -> schools.SessionOut:
    with get_conn() as conn:
        return schools.start_session(conn, user, class_id)


@router.get("/api/classes/{class_id}/sessions/current")
def current_session(class_id: int, user: dict = Depends(require_user)) -> dict:
    with get_conn() as conn:
        return {"session_id": schools.latest_session(conn, user, class_id)}


@router.get("/api/sessions/{session_id}", response_model=schools.SessionOut)
def session_state(session_id: int, user: dict = Depends(require_user)) -> schools.SessionOut:
    with get_conn() as conn:
        return schools.session_state(conn, user, session_id)


@router.post("/api/sessions/{session_id}/answer", response_model=schools.SessionOut)
def answer(session_id: int, body: schools.AnswerIn, user: dict = Depends(require_user)) -> schools.SessionOut:
    with get_conn() as conn:
        return schools.answer(conn, user, session_id, body)


@router.post("/api/sessions/{session_id}/step", response_model=schools.SessionOut)
def step(session_id: int, body: StepIn, user: dict = Depends(require_user)) -> schools.SessionOut:
    with get_conn() as conn:
        return schools.step(conn, user, session_id, body.action)


@router.get("/api/consent-options")
def consent_options() -> dict:
    """A11 (Stop 3): the paper form is the main route for the January pilot;
    the email link shows only once email is switched on."""
    with get_conn() as conn:
        offered = guide.offered_to_parents(conn)
        live = guide.live_mode(conn) != "off"
    # guide_live: the Privacy Policy and Terms show the guide's lines while
    # anyone (even teachers only) can use it.
    return {"email": gmail_service.email_enabled(), "guide": offered, "guide_live": live}

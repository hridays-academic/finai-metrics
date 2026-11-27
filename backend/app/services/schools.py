"""
Schools (master plan phase 8: SC1-SC5, SC10, T18; vault: Areas/Phase 8 plan).

- Roles: an admin makes an account a teacher.
- Classes: a teacher creates one and gets a 6-character code; students join
  with it. The class board, teacher view and classroom mode are for its
  members and teacher only. Handles only, unless an admin turns on names
  for a school that opted in.
- Parent consent: an under-18 student enters a parent's email (only when
  email is switched on), and the parent approves on a plain page. The
  parent's email is kept only until the request is answered or expires
  (14 days). Or a teacher marks a paper form received and an admin confirms
  it with the existing consent record.
- Classroom mode: one quick round on a projector. The teacher reveals each
  card; students answer on their phones; the class's average range shows
  before the reveal. Students waiting for consent can watch but nothing of
  theirs is saved.
"""
import hashlib
import secrets
from datetime import date
from typing import Literal, Optional

import psycopg
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from app.services import audit, gmail_service, guide, play, progress
from app.services.league_service import LeagueError

CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I/L
CONSENT_DAYS = 14
SESSION_CARDS = 10


# ---------- Models ----------

class ClassOut(BaseModel):
    id: int
    code: str
    name: str
    teaching: bool
    members: int
    show_names: bool


class ClassIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class JoinIn(BaseModel):
    code: str = Field(min_length=6, max_length=6)


class StudentRowOut(BaseModel):
    user_id: int
    display: str
    started: bool
    rounds: int
    cards: int
    average: Optional[float]
    caught: Optional[float]  # share of cards inside the range, 0-1
    forecasts: int
    companies: list[str]
    consent: Literal["not_needed", "granted", "pending", "paper_received"]
    # Phase 12: the separate parent tick for the AI guide (under-18s only).
    guide: Literal["not_needed", "granted", "form_received", "not_yet"] = "not_needed"


class TeacherViewOut(BaseModel):
    class_: ClassOut = Field(alias="class")
    students: list[StudentRowOut]

    model_config = {"populate_by_name": True}


class ConsentRequestIn(BaseModel):
    parent_email: str = Field(max_length=200, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class ConsentPageOut(BaseModel):
    handle: str
    expires_at: str


class ConsentAnswerIn(BaseModel):
    approve: bool
    parent_name: str = Field(default="", max_length=120)
    # Phase 12: the separate tick for the AI guide (honoured only while the
    # guide is offered to students; see guide.offered_to_parents).
    guide: bool = False


class PaperFormOut(BaseModel):
    user_id: int
    handle: Optional[str]
    class_name: str
    received_at: str
    kind: Literal["approval", "guide"] = "approval"


class SessionOut(BaseModel):
    id: int
    class_id: int
    index: int
    total: int
    card: Optional[play.PlayCard]
    revealed: bool
    answered: int
    members: int
    class_range: Optional[tuple[float, float]]  # the class's average range, before and after the reveal
    actual: Optional[float]
    class_hit: Optional[bool]
    my_range: Optional[tuple[float, float]]
    my_hit: Optional[bool]
    ended: bool
    teaching: bool


class AnswerIn(BaseModel):
    low: float
    high: float


# ---------- Roles ----------

def set_role(conn: psycopg.Connection, actor: dict, user_id: int, role: str) -> None:
    if role not in ("student", "teacher"):
        raise LeagueError(422, "bad_role", "Choose student or teacher.")
    row = conn.execute("UPDATE users SET role = %s WHERE id = %s AND deleted_at IS NULL RETURNING id",
                       (role, user_id)).fetchone()
    if row is None:
        raise LeagueError(404, "user_not_found", "No such user.")
    audit.write(conn, actor["id"], "update", "role", user_id, {"role": role})


def _require_teacher(user: dict) -> None:
    if not (user.get("is_teacher") or user.get("is_admin")):
        raise LeagueError(403, "teachers_only", "Only teachers can do this. Ask Stackly to make your account a teacher.")


# ---------- Classes ----------

def _new_code(conn: psycopg.Connection) -> str:
    for _ in range(20):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
        if not conn.execute("SELECT 1 FROM classes WHERE code = %s", (code,)).fetchone():
            return code
    raise LeagueError(500, "no_code", "Couldn't make a class code. Please try again.")


def _class_out(conn: psycopg.Connection, row: dict, user: dict) -> ClassOut:
    n = conn.execute("SELECT count(*) AS n FROM class_members WHERE class_id = %s", (row["id"],)).fetchone()["n"]
    return ClassOut(id=row["id"], code=row["code"], name=row["name"], teaching=row["teacher_id"] == user["id"],
                    members=n, show_names=row["show_names"])


def create_class(conn: psycopg.Connection, user: dict, body: ClassIn) -> ClassOut:
    _require_teacher(user)
    row = conn.execute(
        "INSERT INTO classes (code, teacher_id, name) VALUES (%s, %s, %s) RETURNING *",
        (_new_code(conn), user["id"], body.name.strip()),
    ).fetchone()
    audit.write(conn, user["id"], "create", "class", row["id"], {"name": row["name"]})
    return _class_out(conn, row, user)


def my_classes(conn: psycopg.Connection, user: dict) -> list[ClassOut]:
    rows = conn.execute(
        """SELECT c.* FROM classes c WHERE c.teacher_id = %(u)s
           UNION SELECT c.* FROM classes c JOIN class_members m ON m.class_id = c.id WHERE m.user_id = %(u)s
           ORDER BY name""",
        {"u": user["id"]},
    ).fetchall()
    return [_class_out(conn, r, user) for r in rows]


def join_class(conn: psycopg.Connection, user: dict, code: str) -> ClassOut:
    row = conn.execute("SELECT * FROM classes WHERE code = %s", (code.strip().upper(),)).fetchone()
    if row is None:
        raise LeagueError(404, "class_not_found", "No class has that code. Check it with your teacher.")
    conn.execute("INSERT INTO class_members (class_id, user_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                 (row["id"], user["id"]))
    return _class_out(conn, row, user)


def leave_class(conn: psycopg.Connection, user: dict, class_id: int) -> None:
    conn.execute("DELETE FROM class_members WHERE class_id = %s AND user_id = %s", (class_id, user["id"]))


def _class_for(conn: psycopg.Connection, user: dict, class_id: int, teacher: bool) -> dict:
    row = conn.execute("SELECT * FROM classes WHERE id = %s", (class_id,)).fetchone()
    if row is None:
        raise LeagueError(404, "class_not_found", "No such class.")
    is_teacher = row["teacher_id"] == user["id"] or user.get("is_admin")
    if teacher and not is_teacher:
        raise LeagueError(403, "not_your_class", "This isn't your class.")
    if not teacher and not is_teacher and not conn.execute(
            "SELECT 1 FROM class_members WHERE class_id = %s AND user_id = %s", (class_id, user["id"])).fetchone():
        raise LeagueError(403, "not_in_class", "You're not in this class.")
    return row


def member_ids(conn: psycopg.Connection, class_id: int) -> set[int]:
    return {r["user_id"] for r in conn.execute("SELECT user_id FROM class_members WHERE class_id = %s",
                                                (class_id,)).fetchall()}


def class_board_members(conn: psycopg.Connection, user: dict, class_id: int) -> set[int]:
    _class_for(conn, user, class_id, teacher=False)
    return member_ids(conn, class_id)


def teacher_view(conn: psycopg.Connection, user: dict, class_id: int) -> TeacherViewOut:
    cls = _class_for(conn, user, class_id, teacher=True)
    rows = conn.execute(
        """SELECT u.id, u.handle, u.name, u.age_band, u.guardian_consent_status, m.paper_form_received_at,
                  u.guide_consent, m.guide_form_received_at,
                  (SELECT count(*) FROM quick_round_attempts q WHERE q.user_id = u.id) +
                  (SELECT count(*) FROM daily_attempts d WHERE d.user_id = u.id) AS rounds,
                  (SELECT count(*) FROM card_answers c WHERE c.user_id = u.id) AS cards,
                  (SELECT avg(points) FROM card_answers c WHERE c.user_id = u.id) AS average,
                  (SELECT avg(CASE WHEN hit THEN 1.0 ELSE 0.0 END) FROM card_answers c WHERE c.user_id = u.id) AS caught,
                  (SELECT count(*) FROM forecasts f WHERE f.user_id = u.id) AS forecasts,
                  (SELECT count(*) FROM practice_attempts p WHERE p.user_id = u.id) AS practice
           FROM class_members m JOIN users u ON u.id = m.user_id
           WHERE m.class_id = %s AND u.deleted_at IS NULL ORDER BY lower(coalesce(u.handle, u.name))""",
        (class_id,),
    ).fetchall()
    out = []
    for r in rows:
        companies = [x["name"] for x in conn.execute(
            """SELECT DISTINCT c.name FROM forecasts f JOIN forecast_events e ON e.id = f.event_id
               JOIN fiscal_periods p ON p.id = e.period_id JOIN companies c ON c.id = p.company_id
               WHERE f.user_id = %s ORDER BY c.name""", (r["id"],)).fetchall()]
        if r["age_band"] != "under_18":
            consent = "not_needed"
        elif r["guardian_consent_status"] == "granted":
            consent = "granted"
        else:
            consent = "paper_received" if r["paper_form_received_at"] else "pending"
        if r["age_band"] != "under_18":
            guide_state = "not_needed"
        elif r["guide_consent"]:
            guide_state = "granted"
        else:
            guide_state = "form_received" if r["guide_form_received_at"] else "not_yet"
        display = (r["name"] if cls["show_names"] and r["name"] else None) or r["handle"] or "(no handle yet)"
        out.append(StudentRowOut(
            user_id=r["id"], display=display, started=bool(r["rounds"] or r["forecasts"] or r["practice"]),
            rounds=r["rounds"], cards=r["cards"], average=round(r["average"], 1) if r["average"] is not None else None,
            caught=round(float(r["caught"]), 3) if r["caught"] is not None else None, forecasts=r["forecasts"],
            companies=companies, consent=consent, guide=guide_state))
    return TeacherViewOut(class_=_class_out(conn, cls, user), students=out)


def set_show_names(conn: psycopg.Connection, actor: dict, class_id: int, show: bool) -> None:
    """A school that opts in to names: an admin turns it on (never a default)."""
    row = conn.execute("UPDATE classes SET show_names = %s WHERE id = %s RETURNING id", (show, class_id)).fetchone()
    if row is None:
        raise LeagueError(404, "class_not_found", "No such class.")
    audit.write(conn, actor["id"], "update", "class_show_names", class_id, {"show_names": show})


# ---------- Consent ----------

def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _forget_expired(conn: psycopg.Connection) -> None:
    conn.execute("UPDATE consent_requests SET parent_email = NULL WHERE parent_email IS NOT NULL AND expires_at < now()")


def request_consent(conn: psycopg.Connection, user: dict, body: ConsentRequestIn, origin: str) -> None:
    if user.get("age_band") != "under_18" or user.get("guardian_consent_status") == "granted":
        raise LeagueError(409, "consent_not_needed", "Your account doesn't need a parent's approval.")
    if not gmail_service.email_enabled():
        raise LeagueError(503, "email_off", "Email isn't switched on yet. Ask your teacher for the paper form.")
    _forget_expired(conn)
    recent = conn.execute(
        "SELECT count(*) AS n FROM consent_requests WHERE student_id = %s AND sent_at > now() - interval '1 day'",
        (user["id"],)).fetchone()["n"]
    if recent >= 3:
        raise LeagueError(429, "too_many_requests", "You've asked three times today. Please try again tomorrow.")
    token = secrets.token_urlsafe(32)
    conn.execute(
        """INSERT INTO consent_requests (student_id, parent_email, token_hash, expires_at)
           VALUES (%s, %s, %s, now() + make_interval(days => %s))""",
        (user["id"], body.parent_email.strip(), _hash(token), CONSENT_DAYS))
    gmail_service.send_consent_email(body.parent_email.strip(), user.get("handle") or "a student",
                                     f"{origin}/#/consent/{token}")
    audit.write(conn, user["id"], "create", "consent_request", user["id"], {})


def _open_request(conn: psycopg.Connection, token: str) -> dict:
    _forget_expired(conn)
    row = conn.execute(
        """SELECT r.*, u.handle FROM consent_requests r JOIN users u ON u.id = r.student_id
           WHERE r.token_hash = %s AND u.deleted_at IS NULL""", (_hash(token),)).fetchone()
    if row is None or row["answered_at"] is not None or row["parent_email"] is None:
        raise LeagueError(404, "consent_link_not_found", "This link has expired or has already been used.")
    return row


def consent_page(conn: psycopg.Connection, token: str) -> ConsentPageOut:
    row = _open_request(conn, token)
    return ConsentPageOut(handle=row["handle"] or "a student", expires_at=row["expires_at"].isoformat())


def answer_consent(conn: psycopg.Connection, token: str, body: ConsentAnswerIn) -> None:
    row = _open_request(conn, token)
    if body.approve and not body.parent_name.strip():
        raise LeagueError(422, "parent_name_required", "Please type your name to approve.")
    conn.execute("UPDATE consent_requests SET answered_at = now(), approved = %s, parent_email = NULL WHERE id = %s",
                 (body.approve, row["id"]))
    guide_yes = bool(body.approve and body.guide and guide.offered_to_parents(conn))
    if body.approve:
        conn.execute(
            """UPDATE users SET guardian_consent_status = 'granted', guardian_consent_by = %s,
                      guardian_consent_method = 'parent_email', guardian_consent_date = %s WHERE id = %s""",
            (body.parent_name.strip(), date.today(), row["student_id"]))
    if guide_yes:
        conn.execute("""UPDATE users SET guide_consent = TRUE, guide_consent_method = 'parent_email',
                               guide_consent_at = now() WHERE id = %s""", (row["student_id"],))
    conn.execute("UPDATE consent_requests SET guide = %s WHERE id = %s", (guide_yes, row["id"]))
    audit.write(conn, None, "update", "guardian_consent", row["student_id"],
                {"status": "granted" if body.approve else "declined", "method": "parent_email", "guide": guide_yes})


def mark_paper_form(conn: psycopg.Connection, user: dict, class_id: int, student_id: int) -> None:
    _class_for(conn, user, class_id, teacher=True)
    row = conn.execute(
        """UPDATE class_members SET paper_form_received_at = now()
           WHERE class_id = %s AND user_id = %s RETURNING user_id""", (class_id, student_id)).fetchone()
    if row is None:
        raise LeagueError(404, "not_in_class", "That student isn't in this class.")
    audit.write(conn, user["id"], "update", "paper_consent_form", student_id, {"class_id": class_id})


def mark_guide_form(conn: psycopg.Connection, user: dict, class_id: int, student_id: int) -> None:
    """Phase 12: a signed form with the guide box ticked has come back. An
    admin then approves it (set_guide_consent), as with the main form."""
    _class_for(conn, user, class_id, teacher=True)
    if not guide.offered_to_parents(conn):
        raise LeagueError(409, "guide_not_offered", "The guide isn't offered to students yet.")
    row = conn.execute(
        """UPDATE class_members SET guide_form_received_at = now()
           WHERE class_id = %s AND user_id = %s RETURNING user_id""", (class_id, student_id)).fetchone()
    if row is None:
        raise LeagueError(404, "not_in_class", "That student isn't in this class.")
    audit.write(conn, user["id"], "update", "paper_guide_form", student_id, {"class_id": class_id})


def set_guide_consent(conn: psycopg.Connection, actor: dict, user_id: int, granted: bool) -> None:
    row = conn.execute("""UPDATE users SET guide_consent = %s, guide_consent_method = CASE WHEN %s THEN 'paper' END,
                                 guide_consent_at = CASE WHEN %s THEN now() END
                          WHERE id = %s AND deleted_at IS NULL RETURNING id""",
                       (granted, granted, granted, user_id)).fetchone()
    if row is None:
        raise LeagueError(404, "user_not_found", "No such account.")
    audit.write(conn, actor["id"], "update", "guide_consent", user_id, {"granted": granted, "method": "paper"})


def paper_forms(conn: psycopg.Connection) -> list[PaperFormOut]:
    guide_forms = [PaperFormOut(user_id=r["user_id"], handle=r["handle"], class_name=r["name"],
                                received_at=r["guide_form_received_at"].isoformat(), kind="guide")
                   for r in conn.execute(
        """SELECT m.user_id, u.handle, c.name, m.guide_form_received_at FROM class_members m
           JOIN users u ON u.id = m.user_id JOIN classes c ON c.id = m.class_id
           WHERE m.guide_form_received_at IS NOT NULL AND u.age_band = 'under_18' AND NOT u.guide_consent
             AND u.deleted_at IS NULL ORDER BY m.guide_form_received_at""").fetchall()]
    return guide_forms + [PaperFormOut(user_id=r["user_id"], handle=r["handle"], class_name=r["name"],
                         received_at=r["paper_form_received_at"].isoformat()) for r in conn.execute(
        """SELECT m.user_id, u.handle, c.name, m.paper_form_received_at FROM class_members m
           JOIN users u ON u.id = m.user_id JOIN classes c ON c.id = m.class_id
           WHERE m.paper_form_received_at IS NOT NULL AND u.age_band = 'under_18'
             AND coalesce(u.guardian_consent_status, '') <> 'granted' AND u.deleted_at IS NULL
           ORDER BY m.paper_form_received_at""").fetchall()]


# ---------- Classroom mode ----------

def start_session(conn: psycopg.Connection, user: dict, class_id: int) -> SessionOut:
    _class_for(conn, user, class_id, teacher=True)
    bank = play.cards(conn, mystery=True)
    ids = play.pick_daily(bank, date.today())[:SESSION_CARDS] if bank else []
    if not ids:
        raise LeagueError(409, "no_cards", "There are no cards to play yet.")
    secrets.SystemRandom().shuffle(ids)
    row = conn.execute("INSERT INTO classroom_sessions (class_id, card_ids) VALUES (%s, %s) RETURNING id",
                       (class_id, Jsonb(ids))).fetchone()
    return session_state(conn, user, row["id"])


def _session(conn: psycopg.Connection, user: dict, session_id: int, teacher: bool) -> tuple[dict, dict]:
    s = conn.execute("SELECT * FROM classroom_sessions WHERE id = %s", (session_id,)).fetchone()
    if s is None:
        raise LeagueError(404, "session_not_found", "No such classroom round.")
    return s, _class_for(conn, user, s["class_id"], teacher=teacher)


def session_state(conn: psycopg.Connection, user: dict, session_id: int) -> SessionOut:
    s, cls = _session(conn, user, session_id, teacher=False)
    ids = list(s["card_ids"])
    i = s["current"]
    card_id = ids[i] if i < len(ids) else None
    card = next((c for c in play.cards(conn, mystery=True) if c.id == card_id), None) if card_id else None
    agg = conn.execute(
        "SELECT count(*) AS n, avg(low) AS lo, avg(high) AS hi FROM classroom_answers WHERE session_id = %s AND card_index = %s",
        (session_id, i)).fetchone()
    mine = conn.execute(
        "SELECT low, high FROM classroom_answers WHERE session_id = %s AND user_id = %s AND card_index = %s",
        (session_id, user["id"], i)).fetchone()
    class_range = (round(agg["lo"], 1), round(agg["hi"], 1)) if agg["n"] else None
    actual = class_hit = my_hit = None
    if s["revealed"] and card_id:
        lo, hi = class_range or (0.0, 0.0)
        scored = play._score_card(conn, card_id, card.min_value if card else lo, card.max_value if card else hi)
        actual = scored.reveal.actual
        class_hit = class_range is not None and class_range[0] <= actual <= class_range[1]
        my_hit = mine is not None and mine["low"] <= actual <= mine["high"]
    return SessionOut(
        id=s["id"], class_id=s["class_id"], index=i, total=len(ids), card=card, revealed=s["revealed"],
        answered=agg["n"], members=len(member_ids(conn, s["class_id"])), class_range=class_range, actual=actual,
        class_hit=class_hit, my_range=(mine["low"], mine["high"]) if mine else None, my_hit=my_hit,
        ended=s["ended_at"] is not None or i >= len(ids),
        teaching=cls["teacher_id"] == user["id"] or bool(user.get("is_admin")))


def answer(conn: psycopg.Connection, user: dict, session_id: int, body: AnswerIn) -> SessionOut:
    s, _ = _session(conn, user, session_id, teacher=False)
    if not progress.may_save(user):
        raise LeagueError(403, "not_saved", "You can watch, but your answers aren't saved until your account is ready.")
    if s["revealed"] or s["ended_at"] is not None:
        raise LeagueError(409, "card_closed", "This card has been revealed. Wait for the next one.")
    lo, hi = min(body.low, body.high), max(body.low, body.high)
    conn.execute(
        """INSERT INTO classroom_answers (session_id, user_id, card_index, low, high) VALUES (%s, %s, %s, %s, %s)
           ON CONFLICT (session_id, user_id, card_index) DO UPDATE SET low = EXCLUDED.low, high = EXCLUDED.high""",
        (session_id, user["id"], s["current"], lo, hi))
    return session_state(conn, user, session_id)


def step(conn: psycopg.Connection, user: dict, session_id: int, action: Literal["reveal", "next", "end"]) -> SessionOut:
    _session(conn, user, session_id, teacher=True)
    if action == "reveal":
        conn.execute("UPDATE classroom_sessions SET revealed = TRUE WHERE id = %s", (session_id,))
    elif action == "next":
        conn.execute("UPDATE classroom_sessions SET current = current + 1, revealed = FALSE WHERE id = %s", (session_id,))
    else:
        conn.execute("UPDATE classroom_sessions SET ended_at = now() WHERE id = %s", (session_id,))
    return session_state(conn, user, session_id)


def latest_session(conn: psycopg.Connection, user: dict, class_id: int) -> Optional[int]:
    _class_for(conn, user, class_id, teacher=False)
    row = conn.execute(
        "SELECT id FROM classroom_sessions WHERE class_id = %s AND ended_at IS NULL ORDER BY id DESC LIMIT 1",
        (class_id,)).fetchone()
    return row["id"] if row else None

"""Phase 8 (vault: Areas/Phase 8 plan): teachers, classes, consent, classroom mode."""
import pytest
from psycopg.rows import dict_row

from app.services import gmail_service
from tests.test_practice import ADMIN, _signup, admin_env, scored  # noqa: F401 -- fixtures


def _profile(client, h, handle, age="18_plus"):
    assert client.patch("/api/league/me", json={"handle": handle, "age_band": age}, headers=h).status_code == 200


@pytest.fixture
def ready(client, scored):  # noqa: F811
    client.post(f"/api/admin/events/{scored['event']}/score", headers=scored["admin"])
    return scored


@pytest.fixture
def db(conn, scored):  # noqa: F811
    conn.row_factory = dict_row
    return conn


@pytest.fixture
def school(db, client, ready):
    teacher = _signup(client, "teacher@example.com")
    _profile(client, teacher, "Ms_Rao")
    tid = db.execute("SELECT id FROM users WHERE email = 'teacher@example.com'").fetchone()["id"]
    assert client.post("/api/classes", headers=teacher, json={"name": "9B"}).status_code == 403
    assert client.put(f"/api/admin/users/{tid}/role", headers=ready["admin"], json={"role": "teacher"}).status_code == 204
    cls = client.post("/api/classes", headers=teacher, json={"name": "9B"}).json()
    student = _signup(client, "s1@example.com")
    _profile(client, student, "Asha_07")
    young = _signup(client, "s2@example.com")
    _profile(client, young, "Ravi_12", "under_18")
    for h in (student, young):
        assert client.post("/api/classes/join", headers=h, json={"code": cls["code"].lower()}).status_code == 200
    return {"teacher": teacher, "class": cls, "student": student, "young": young, "admin": ready["admin"]}


def test_class_codes_and_membership(client, school):
    cls = school["class"]
    assert len(cls["code"]) == 6 and not set(cls["code"]) & set("01IOL")
    assert client.post("/api/classes/join", headers=school["student"], json={"code": "ZZZZZZ"}).status_code == 404
    mine = client.get("/api/classes", headers=school["student"]).json()
    assert [(c["name"], c["teaching"], c["members"]) for c in mine] == [("9B", False, 2)]


def test_teacher_view_handles_only_and_teachers_only(db, client, school):
    cid = school["class"]["id"]
    assert client.get(f"/api/classes/{cid}/students", headers=school["student"]).status_code == 403
    view = client.get(f"/api/classes/{cid}/students", headers=school["teacher"]).json()
    rows = {r["display"]: r for r in view["students"]}
    assert set(rows) == {"Asha_07", "Ravi_12"}  # handles, never names
    assert rows["Ravi_12"]["consent"] == "pending" and rows["Asha_07"]["consent"] == "not_needed"
    assert rows["Asha_07"]["started"] is False
    assert client.put(f"/api/admin/classes/{cid}/show-names", headers=school["admin"], json={"show_names": True}).status_code == 204
    named = client.get(f"/api/classes/{cid}/students", headers=school["teacher"]).json()
    assert {r["display"] for r in named["students"]} == {"T"}  # the school opted in: names


def test_paper_form_then_admin_confirms(db, client, school):
    cid = school["class"]["id"]
    rid = db.execute("SELECT id FROM users WHERE handle = 'Ravi_12'").fetchone()["id"]
    assert client.put(f"/api/classes/{cid}/students/{rid}/paper-form", headers=school["teacher"]).status_code == 204
    forms = client.get("/api/admin/paper-forms", headers=school["admin"]).json()
    assert [f["handle"] for f in forms] == ["Ravi_12"]
    view = client.get(f"/api/classes/{cid}/students", headers=school["teacher"]).json()
    assert next(r for r in view["students"] if r["display"] == "Ravi_12")["consent"] == "paper_received"


def test_consent_by_email_link(db, client, school, monkeypatch):
    body = {"parent_email": "parent@example.com"}
    assert client.post("/api/me/consent-request", headers=school["young"], json=body).status_code == 503  # email off
    sent = {}
    monkeypatch.setattr(gmail_service, "email_enabled", lambda: True)
    monkeypatch.setattr(gmail_service, "send_consent_email", lambda to, handle, link: sent.update(to=to, link=link))
    assert client.post("/api/me/consent-request", headers=school["student"], json=body).status_code == 409  # adult
    assert client.post("/api/me/consent-request", headers=school["young"], json=body).status_code == 204
    token = sent["link"].rsplit("/", 1)[1]
    assert client.get(f"/api/consent/{token}").json()["handle"] == "Ravi_12"
    assert client.post(f"/api/consent/{token}", json={"approve": True, "parent_name": ""}).status_code == 422
    assert client.post(f"/api/consent/{token}", json={"approve": True, "parent_name": "S. Kumar"}).status_code == 204
    u = db.execute("SELECT guardian_consent_status, guardian_consent_method FROM users WHERE handle = 'Ravi_12'").fetchone()
    assert (u["guardian_consent_status"], u["guardian_consent_method"]) == ("granted", "parent_email")
    assert db.execute("SELECT parent_email FROM consent_requests").fetchone()["parent_email"] is None  # forgotten
    assert client.get(f"/api/consent/{token}").status_code == 404  # used once


def test_class_board_is_members_only(client, school, monkeypatch):
    from app.services import boards
    monkeypatch.setattr(boards, "WEEK_MIN_CARDS", 1)
    cards = client.get("/api/play/cards").json()
    answers = [{"card_id": c["id"], "low": c["min_value"], "high": c["max_value"]} for c in cards]
    outsider = _signup(client, "out@example.com")
    _profile(client, outsider, "Out_1")
    for h in (school["student"], outsider):
        client.post("/api/play/rounds", headers=h, json={"kind": "quick", "answers": answers})
    cid = school["class"]["id"]
    board = client.get(f"/api/classes/{cid}/boards/week", headers=school["student"]).json()
    assert [r["handle"] for r in board["rows"]] == ["Asha_07"]
    assert client.get(f"/api/classes/{cid}/boards/week", headers=outsider).status_code == 403


def test_classroom_mode(client, school):
    cid = school["class"]["id"]
    assert client.post(f"/api/classes/{cid}/sessions", headers=school["student"]).status_code == 403
    s = client.post(f"/api/classes/{cid}/sessions", headers=school["teacher"]).json()
    assert s["index"] == 0 and s["revealed"] is False and s["teaching"] is True and s["card"]["name"] is None
    card = s["card"]
    sid = s["id"]
    assert client.get(f"/api/classes/{cid}/sessions/current", headers=school["student"]).json()["session_id"] == sid
    mine = client.post(f"/api/sessions/{sid}/answer", headers=school["student"],
                       json={"low": card["min_value"], "high": card["max_value"]}).json()
    assert mine["answered"] == 1 and mine["class_range"] == [card["min_value"], card["max_value"]]
    # Waiting for consent: can watch, nothing saved.
    assert client.post(f"/api/sessions/{sid}/answer", headers=school["young"], json={"low": 0, "high": 1}).status_code == 403
    assert client.post(f"/api/sessions/{sid}/step", headers=school["student"], json={"action": "reveal"}).status_code == 403
    shown = client.post(f"/api/sessions/{sid}/step", headers=school["teacher"], json={"action": "reveal"}).json()
    assert shown["actual"] is not None and shown["class_hit"] is True
    assert client.get(f"/api/sessions/{sid}", headers=school["student"]).json()["my_hit"] is True
    assert client.post(f"/api/sessions/{sid}/answer", headers=school["student"], json={"low": 0, "high": 1}).status_code == 409
    nxt = client.post(f"/api/sessions/{sid}/step", headers=school["teacher"], json={"action": "next"}).json()
    assert nxt["index"] == 1 and nxt["revealed"] is False and nxt["answered"] == 0
    end = client.post(f"/api/sessions/{sid}/step", headers=school["teacher"], json={"action": "end"}).json()
    assert end["ended"] is True

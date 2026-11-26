"""
Phase 6 (vault: Areas/Phase 6 plan): XP and levels, rounds scored on the
server, the daily challenge, badges, boards and the handle filter. Nothing is
saved for anyone who may not forecast; awards never double.
"""
from datetime import date

import pytest
from psycopg.rows import dict_row

from app.services import boards, play, practice, progress
from tests.test_practice import (  # noqa: F401 -- fixtures
    ADMIN, DEFS, RESULTS_DATE, _items, _now_plus, _signup, admin_env, scored,
)


def _profile(client, headers, handle, age_band="18_plus"):
    return client.patch("/api/league/me", json={"handle": handle, "age_band": age_band}, headers=headers)


@pytest.fixture
def ready(client, scored):  # noqa: F811
    client.post(f"/api/admin/events/{scored['event']}/score", headers=scored["admin"])
    return scored


@pytest.fixture
def db(conn, scored):  # noqa: F811 -- after the fixture, which reads tuples
    conn.row_factory = dict_row
    return conn


@pytest.fixture
def student(client):
    h = _signup(client, "student@example.com")
    assert _profile(client, h, "Asha_07").status_code == 200
    return h


def _answers(client, cards=None):
    """Each card's widest allowed range: always inside."""
    cards = cards if cards is not None else client.get("/api/play/cards").json()
    return [{"card_id": c["id"], "low": c["min_value"], "high": c["max_value"]} for c in cards]


# ---------- Pure ----------

def test_levels_and_terms():
    assert [progress.level_start(n) for n in (1, 2, 3, 4, 5)] == [0, 40, 120, 240, 400]
    assert [progress.level_for(x) for x in (0, 39, 40, 119, 120, 2100)] == [1, 1, 2, 2, 3, 10]
    assert progress.term_start(date(2026, 11, 25)) == date(2026, 10, 1)
    assert progress.term_start(date(2027, 2, 1)) == date(2026, 10, 1)
    assert progress.term_start(date(2027, 5, 1)) == date(2027, 4, 1)
    assert progress.card_xp(True, True) == 2 and progress.card_xp(False, None) == 0
    assert progress.league_xp(60.0) == 300 and progress.practice_xp(60.0) == 3


def test_round_total_matches_the_browser_rules():
    def r(points, hit):
        return play.RevealOut(actual=1, hit=hit, points=points, beat_lazy=None, missed_by=0, lazy=None, note=None,
                              name="x", quarter="q")
    # Streak 1, 2, 3 (x2): 10 + 10 + 20; a miss resets; gold on index 1 adds 20 when inside.
    assert play.round_total([r(10, True), r(10, True), r(10, True), r(5, False)], None) == 45
    assert play.round_total([r(10, True), r(10, True)], 1) == 40
    assert play.round_total([r(10, True), r(10, False)], 1) == 20


def test_daily_pick_is_fixed_by_date_and_mixed():
    def card(i, sector):
        return play.PlayCard(id=f"c{i}-0", sector=sector, sector_name=sector, difficulty=None, name=None,
                             mystery_line=None, quarter=None, metric_key="m", label="l", unit="%", last_year=None,
                             last_quarter=None, min_value=-100, max_value=500)
    bank = [card(i, "cement" if i % 2 else "it") for i in range(30)]
    a = play.pick_daily(bank, date(2026, 11, 25))
    assert a == play.pick_daily(list(reversed(bank)), date(2026, 11, 25))
    assert len(a) == 10 and a != play.pick_daily(bank, date(2026, 11, 26))
    sectors = [next(c.sector for c in bank if c.id == i) for i in a]
    assert sectors.count("cement") == sectors.count("it") == 5


@pytest.mark.parametrize("handle", ["Kshitij", "Shital", "Dikshit", "Shitanshu", "Essex", "Sussex", "Assam", "Scunthorpe",
                                    "Kshitij_7", "Asha_07", "Nazir", "Grapevine", "Skillful", "Lundberg", "Dickens"])
def test_handle_filter_allows_ordinary_names(handle):
    assert boards.handle_allowed(handle)


@pytest.mark.parametrize("handle", ["xXgandu99", "chu7iya", "Madar_Chod", "MadarChod", "madarchod", "Gandu_99", "sh1t",
                                    "BigDick", "the.shit", "SEX", "s3x_god", "Rape_Lord", "nazi88", "g_a_n_d_u", "Bh0sdi"])
def test_handle_filter_refuses_bad_handles(handle):
    assert not boards.handle_allowed(handle)


def test_restored_words_are_back_in_the_blocklist():
    assert {"shit", "dick", "sex", "rape", "kill", "nazi", "lund"} <= set(boards.blocklist())


# ---------- Rounds and saving ----------

def test_signed_out_rounds_score_but_save_nothing(db, client, ready):
    res = client.post("/api/play/rounds", json={"kind": "quick", "answers": _answers(client)}).json()
    assert res["saved"] is False and res["not_saved_reason"] == "signed_out" and res["hits"] == 3
    assert db.execute("SELECT count(*) AS n FROM card_answers").fetchone()["n"] == 0


def test_consent_pending_saves_nothing(db, client, ready):
    h = _signup(client, "young@example.com")
    assert _profile(client, h, "Young_1", "under_18").status_code == 200
    res = client.post("/api/play/rounds", headers=h, json={"kind": "quick", "answers": _answers(client)}).json()
    assert res["saved"] is False and res["not_saved_reason"] == "consent_pending"
    assert db.execute("SELECT count(*) AS n FROM card_answers").fetchone()["n"] == 0
    assert db.execute("SELECT count(*) AS n FROM quick_round_attempts").fetchone()["n"] == 0


def test_xp_only_for_first_attempts_and_within_the_daily_cap(db, client, ready, student):
    first = client.post("/api/play/rounds", headers=student, json={"kind": "quick", "answers": _answers(client)}).json()
    assert first["saved"] is True and first["xp_gained"] <= progress.DAILY_CAP
    assert first["best"] == first["score"]
    again = client.post("/api/play/rounds", headers=student, json={"kind": "quick", "answers": _answers(client)}).json()
    assert again["xp_gained"] == 0  # the same cards again: first attempts only
    assert db.execute("SELECT count(*) AS n FROM card_answers").fetchone()["n"] == 3
    assert db.execute("SELECT count(*) AS n FROM quick_round_attempts").fetchone()["n"] == 2
    capped = db.execute("SELECT sum(xp) AS xp FROM xp_awards WHERE source <> 'league'").fetchone()["xp"]
    assert capped <= progress.DAILY_CAP
    assert db.execute("SELECT count(*) AS n FROM audit_log WHERE entity = 'xp'").fetchone()["n"] >= 1


def test_server_rejects_tampered_rounds(client, ready, student):
    answers = _answers(client)
    assert client.post("/api/play/rounds", headers=student,
                       json={"kind": "quick", "answers": answers + answers[:1]}).status_code == 422
    bad = [{"card_id": "zzzzzz-0", "low": 1, "high": 2}]
    assert client.post("/api/play/rounds", headers=student, json={"kind": "quick", "answers": bad}).status_code == 404


def test_daily_challenge_counts_once_a_day(db, client, ready, student):
    day = client.get("/api/play/daily").json()
    assert len(day["cards"]) == 3 and day["played"] is False and day["average"] is None
    ids = [c["id"] for c in day["cards"]]
    wrong = client.post("/api/play/rounds", headers=student,
                        json={"kind": "daily", "answers": [{"card_id": ids[0], "low": 0, "high": 1}]})
    assert wrong.status_code == 422
    answers = _answers(client, day["cards"])
    first = client.post("/api/play/rounds", headers=student, json={"kind": "daily", "answers": answers}).json()
    assert first["saved"] is True and "First daily challenge" in first["new_badges"]
    second = client.post("/api/play/rounds", headers=student, json={"kind": "daily", "answers": answers}).json()
    assert second["saved"] is False and second["not_saved_reason"] == "already_played"
    mine = client.get("/api/play/daily?a=1", headers=student).json()
    assert mine["played"] is True and mine["my_score"] == first["score"]
    # Fixed once set, whatever the pool does later.
    assert db.execute("SELECT card_ids FROM daily_challenges").fetchone()["card_ids"] == ids


def test_league_xp_is_replaced_not_doubled_on_a_correction(db, client, scored, student):  # noqa: F811
    admin = scored["admin"]
    ev = client.post("/api/admin/events/quick", headers=admin, json={
        "exchange": "NSE", "ticker": "DEMOIT", "company_name": "Demo IT (fictional)", "sector": "it",
        "fiscal_year_label": "FY27", "fiscal_quarter": 2, "period_end_date": "2026-09-30",
        "results_date": RESULTS_DATE, "season_label": "Q2 FY27", "include_kpi": False, "open_now": True,
    }).json()["id"]
    items = [{"metric_key": k, "definition_key": DEFS[k], "value": v, "source_url": "https://www.nseindia.com/x.pdf"}
             for k, v in (("revenue_growth_yoy", 10.0), ("operating_margin", 15.0))]
    client.put(f"/api/admin/events/{ev}/last-year", headers=admin, json=items)
    res = client.put(f"/api/league/events/{ev}/forecast", headers=student, json={"values": [
        {"metric_key": "revenue_growth_yoy", "low": 10.0, "high": 14.0},
        {"metric_key": "operating_margin", "low": 13.0, "high": 15.0}], "reason_tags": [], "note": None})
    assert res.status_code == 200, res.text
    client.patch(f"/api/admin/events/{ev}", json={"lock_at": db.execute("SELECT (now() - interval '1 second') AS t").fetchone()["t"].isoformat()}, headers=admin)
    results = [dict(i, value=v) for i, v in zip(items, (12.0, 14.0))]
    client.put(f"/api/admin/events/{ev}/results", headers=admin, json=results)
    assert client.post(f"/api/admin/events/{ev}/score", headers=admin).status_code == 200
    first = db.execute("SELECT xp FROM xp_awards WHERE source = 'league'").fetchall()
    assert len(first) == 1 and first[0]["xp"] > 0
    client.put(f"/api/admin/events/{ev}/results", headers=admin, json=[dict(results[0], value=30.0), results[1]])
    assert client.post(f"/api/admin/events/{ev}/score", headers=admin).status_code == 200
    after = db.execute("SELECT xp FROM xp_awards WHERE source = 'league'").fetchall()
    assert len(after) == 1 and after[0]["xp"] < first[0]["xp"]  # replaced, not added
    prog = client.get("/api/me/progress", headers=student).json()
    assert prog["xp"] == after[0]["xp"] and prog["level"] == progress.level_for(after[0]["xp"])
    assert prog["forecasts"][0]["status"] == "scored" and prog["ranges"] == 2


def test_progress_profile(client, ready, student):
    client.post("/api/play/rounds", headers=student, json={"kind": "quick", "answers": _answers(client)})
    p = client.get("/api/me/progress", headers=student).json()
    assert p["saving"] is True and p["days_played_this_term"] == 1
    assert p["ranges"] == 3 and p["ranges_inside"] == 3
    assert [b["key"] for b in p["badges"]] == ["well_calibrated", "beat_lazy_5", "full_season", "first_daily"]
    assert p["unlocks"][0] == {"level": 2, "key": "hard", "name": "Hard companies in Practice and quick rounds",
                               "unlocked": p["level"] >= 2}
    assert client.get("/api/me/progress").status_code == 401


# ---------- Hard unlocks at Level 2 ----------

def test_hard_quarters_wait_for_level_2(client, ready, monkeypatch):
    monkeypatch.setattr(practice, "difficulty", lambda cut: "hard")
    assert client.get("/api/practice/cases").json()[0]["locked"] is True
    attempt = client.post(f"/api/practice/cases/{ready['code']}/attempt", json={"mystery": True, "ranges": []})
    assert attempt.status_code == 403 and "Level 2" in attempt.json()["detail"]["message"]
    assert client.get("/api/play/cards").json() == []
    assert len(client.get("/api/play/daily").json()["cards"]) == 3  # the daily is the same for everyone


# ---------- Boards ----------

def test_boards_show_handles_only_and_hide_who_should_be_hidden(db, client, ready, student, monkeypatch):
    monkeypatch.setattr(boards, "WEEK_MIN_CARDS", 1)
    young = _signup(client, "young2@example.com")
    _profile(client, young, "Young_2", "under_18")
    for h in (student, young):
        client.post("/api/play/rounds", headers=h, json={"kind": "quick", "answers": _answers(client)})
    week = client.get("/api/boards/week", headers=student).json()
    assert [r["handle"] for r in week["rows"]] == ["Asha_07"] and week["rows"][0]["you"] is True
    assert set(week["rows"][0]) == {"rank", "handle", "value", "count", "you"}
    assert client.get("/api/boards/week", headers=young).json()["your_status"] == "consent_pending"
    assert client.put("/api/me/leaderboard", headers=student, json={"hidden": True}).status_code == 204
    hidden = client.get("/api/boards/week?a=1", headers=student).json()
    assert hidden["rows"] == [] and hidden["your_status"] == "hidden"
    client.put("/api/me/leaderboard", headers=student, json={"hidden": False})
    uid = db.execute("SELECT id FROM users WHERE handle = 'Asha_07'").fetchone()["id"]
    assert client.put(f"/api/admin/users/{uid}/handle-status", headers=ready["admin"],
                      json={"status": "review"}).status_code == 204
    assert client.get("/api/boards/week").json()["rows"] == []
    assert [h["handle"] for h in client.get("/api/admin/handles", headers=ready["admin"]).json()] == ["Asha_07"]
    assert client.get("/api/boards/nope").status_code == 422


def test_blocked_handles_are_refused(client):
    h = _signup(client, "rude@example.com")
    res = _profile(client, h, "Gandu_99")
    assert res.status_code == 422 and res.json()["detail"]["message"] == "That handle isn't allowed. Please choose another."


def test_deleting_an_account_removes_progress(db, client, ready, student):
    client.post("/api/play/rounds", headers=student, json={"kind": "quick", "answers": _answers(client)})
    uid = db.execute("SELECT id FROM users WHERE handle = 'Asha_07'").fetchone()["id"]
    from app.services import auth_service
    auth_service.delete_account(uid)
    for table in ("card_answers", "xp_awards", "quick_round_attempts", "user_badges", "daily_attempts"):
        assert db.execute(f"SELECT count(*) AS n FROM {table} WHERE user_id = %s", (uid,)).fetchone()["n"] == 0

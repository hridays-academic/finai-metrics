"""
A10 (Stop 3): deleting an account leaves no row about that person in any
table, except the ones listed in KEPT, which Hriday approves (Stop 3 report).

The test reads the schema itself: every column that points at a user
(user_id, student_id, teacher_id, owner_id, created_by, entered_by,
actor_user_id, or any column with "user" in its name). A new table with
such a column fails this test until it's classified below, so nothing new
can slip past account deletion.
"""
from psycopg.rows import dict_row

from app.services import auth_service
from tests.test_practice import _signup, admin_env, scored  # noqa: F401 -- fixtures

# Kept on purpose, with why (for Hriday's approval).
KEPT = {
    ("users", "id"): "the empty shell row: every personal field blanked, deleted_at set, so forecasts keep a valid owner",
    ("forecasts", "user_id"): "league forecasts stay, anonymised (note cleared), so results and crowd figures don't change",
    ("audit_log", "actor_user_id"): "who changed what, by internal id only; holds no personal details",
    ("actuals", "entered_by"): "which admin entered a result (admins only, never a student)",
    ("classes", "teacher_id"): "a deleted teacher's classes stay for their students; the teacher's name and email are gone",
    ("world_events", "created_by"): "which admin wrote a world-event note (admins only, never a student)",
    ("leagues", "created_by"): "an old private-league table no page uses today (nothing creates rows); listed so it's decided",
}

USER_COLUMN_NAMES = {"user_id", "student_id", "teacher_id", "owner_id", "created_by", "entered_by", "actor_user_id"}


def _user_columns(conn) -> set[tuple[str, str]]:
    rows = conn.execute(
        """SELECT table_name, column_name FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND (column_name = ANY(%s) OR (column_name LIKE '%%user%%' AND data_type IN ('integer', 'bigint')))""",
        (list(USER_COLUMN_NAMES),),
    ).fetchall()
    return {(r["table_name"], r["column_name"]) for r in rows} | {("users", "id")}


def test_every_user_linked_table_is_cleared_or_kept_on_purpose(conn, client, scored, monkeypatch):  # noqa: F811
    conn.row_factory = dict_row
    columns = _user_columns(conn)
    # 1. A student with a row in every user-linked table.
    h = _signup(client, "sweep@example.com")
    assert client.patch("/api/league/me", json={"handle": "Sweep_1", "age_band": "under_18"}, headers=h).status_code == 200
    uid = conn.execute("SELECT id FROM users WHERE email = 'sweep@example.com'").fetchone()["id"]
    teacher = conn.execute("SELECT id FROM users WHERE email = %s", ("admin@example.com",)).fetchone()["id"]
    ev = scored["event"]
    period = conn.execute("SELECT period_id FROM forecast_events WHERE id = %s", (ev,)).fetchone()["period_id"]
    cls = conn.execute("INSERT INTO classes (code, teacher_id, name) VALUES ('SWEEP2', %s, 'Sweep') RETURNING id",
                       (teacher,)).fetchone()["id"]
    lg = conn.execute("INSERT INTO leagues (name, join_code, created_by) VALUES ('Old', 'SWEEPL', %s) RETURNING id",
                      (teacher,)).fetchone()["id"]
    sess = conn.execute("INSERT INTO classroom_sessions (class_id, card_ids) VALUES (%s, '[]') RETURNING id", (cls,)).fetchone()["id"]
    inserts = {
        "sessions": ("INSERT INTO sessions (token, user_id, expires_at) VALUES ('sweep-token', %(u)s, now() + interval '1 day')"),
        "activity_log": "INSERT INTO activity_log (user_id, action) VALUES (%(u)s, 'searched')",
        "password_reset_tokens": "INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES ('sweep', %(u)s, now() + interval '1 hour')",
        "practice_attempts": "INSERT INTO practice_attempts (user_id, event_id, ranges, points, total_points, is_replay, mystery) VALUES (%(u)s, %(e)s, '{}', '{}', 50, FALSE, TRUE)",
        "research_workspaces": "INSERT INTO research_workspaces (user_id, event_id) VALUES (%(u)s, %(e)s)",
        "card_answers": "INSERT INTO card_answers (user_id, card_id, event_id, metric_key, low, high, hit, points, mode) VALUES (%(u)s, 'x-0', %(e)s, 'operating_margin', 1, 2, TRUE, 50, 'quick')",
        "xp_awards": "INSERT INTO xp_awards (user_id, source, ref, xp, day) VALUES (%(u)s, 'card', 'card:x-0', 2, current_date)",
        "user_badges": "INSERT INTO user_badges (user_id, badge_key) VALUES (%(u)s, 'first_daily')",
        "daily_attempts": "INSERT INTO daily_attempts (user_id, day, score, hits, cards) VALUES (%(u)s, current_date, 10, 1, 1)",
        "quick_round_attempts": "INSERT INTO quick_round_attempts (user_id, cards, hits, score) VALUES (%(u)s, 1, 1, 10)",
        "class_members": "INSERT INTO class_members (class_id, user_id) VALUES (%(c)s, %(u)s)",
        "consent_requests": "INSERT INTO consent_requests (student_id, parent_email, token_hash, expires_at) VALUES (%(u)s, 'p@example.com', 'sweep', now() + interval '14 days')",
        "league_members": "INSERT INTO league_members (league_id, user_id) VALUES (%(l)s, %(u)s)",
        "classroom_answers": "INSERT INTO classroom_answers (session_id, user_id, card_index, low, high) VALUES (%(s)s, %(u)s, 0, 1, 2)",
    }
    for table, sql in inserts.items():
        conn.execute(sql, {"u": uid, "e": ev, "c": cls, "s": sess, "p": period, "l": lg})
    conn.commit()

    # 2. Every user-linked column is either cleared by deletion (and seeded
    # above) or kept on purpose.
    cleared = {(t, c) for (t, c) in columns if (t, c) not in KEPT}
    unseeded = {t for (t, _c) in cleared} - set(inserts)
    assert not unseeded, f"user-linked tables not covered by this test (add a row and a rule): {sorted(unseeded)}"

    # 3. Delete, then nothing about the student remains outside KEPT.
    auth_service.delete_account(uid)
    leftover = {}
    for table, column in sorted(cleared):
        n = conn.execute(f"SELECT count(*) AS n FROM {table} WHERE {column} = %s", (uid,)).fetchone()["n"]
        if n:
            leftover[f"{table}.{column}"] = n
    assert leftover == {}, f"rows left after account deletion: {leftover}"
    shell = conn.execute("SELECT email, name, handle, deleted_at FROM users WHERE id = %s", (uid,)).fetchone()
    assert shell["handle"] is None and shell["name"] == "" and shell["deleted_at"] is not None

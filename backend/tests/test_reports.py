"""Phase 2: usage counts (no visitor id), error reports, feedback, admin numbers."""
from psycopg.rows import dict_row

from app.services import reports


def _rows(conn, sql):
    return conn.cursor(row_factory=dict_row).execute(sql).fetchall()


def test_usage_counts_are_daily_totals_only(conn, client):
    for _ in range(3):
        assert client.post("/api/usage", json={"event": "guide_started", "page": "learn"}).status_code == 204
    assert client.post("/api/usage", json={"event": "nope"}).status_code == 400
    rows = _rows(conn, "SELECT * FROM usage_counts")
    assert len(rows) == 1 and rows[0]["count"] == 3
    assert set(rows[0].keys()) == {"day", "event", "page", "count"}  # nothing about the visitor


def test_error_reports_keep_message_page_and_build_only(conn, client):
    assert client.post("/api/client-error", json={"message": "x" * 900, "page": "#/practice", "build": "abc"}).status_code == 204
    row = _rows(conn, "SELECT * FROM client_errors")[0]
    assert len(row["message"]) == reports.MAX_MESSAGE and row["page"] == "#/practice" and row["source"] == "browser"
    assert set(row.keys()) == {"id", "created_at", "source", "page", "build", "message"}


def test_feedback_email_is_optional_and_checked(conn, client):
    assert client.post("/api/feedback", json={"message": "Jyothy margin looks wrong", "page": "#/"}).status_code == 204
    assert client.post("/api/feedback", json={"message": "hello", "email": "not-an-email"}).status_code == 422
    assert client.post("/api/feedback", json={"message": "hello", "email": "a@b.co"}).status_code == 204
    assert [r["email"] for r in _rows(conn, "SELECT email FROM feedback ORDER BY id")] == [None, "a@b.co"]


def test_admin_lists_need_an_admin(client):
    for path in ("/api/admin/errors", "/api/admin/feedback", "/api/admin/numbers"):
        assert client.get(path).status_code in (401, 403)


def test_weekly_numbers_shape(conn):
    reports.record_usage("guide_started")
    reports.record_usage("guide_finished")
    weeks = reports.weekly_numbers(2)
    assert len(weeks) == 2 and weeks[0]["guide_completion_pct"] == 100.0
    assert weeks[0]["forecasts_submitted"] == 0 and weeks[0]["students_improved"] == 0

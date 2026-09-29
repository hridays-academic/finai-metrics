"""
Database-level integrity for the Results League schema. Runs against the
Neon `test` branch only (see conftest.py). These guarantees live in the
database so they hold regardless of any route code.
"""
import psycopg
import pytest

from app.services import db as db_module

METRICS = '{"revenue_growth_yoy": {"definition_key": "in.revenue_growth_yoy.v1"}}'


def _user(conn, email="a@example.com") -> int:
    return conn.execute(
        "INSERT INTO users (email, name) VALUES (%s, 'Test') RETURNING id", (email,)
    ).fetchone()[0]


def _event(conn, lock_offset: str, ticker="DEMO") -> int:
    company = conn.execute(
        """INSERT INTO companies (market_code, exchange, ticker, name, sector, currency,
                                  fiscal_year_end_month, is_demo)
           VALUES ('IN', 'NSE', %s, 'Demo Co (fictional)', 'cement', 'INR', 3, TRUE) RETURNING id""",
        (ticker,),
    ).fetchone()[0]
    period = conn.execute(
        """INSERT INTO fiscal_periods (company_id, fiscal_year_label, fiscal_quarter, period_end_date)
           VALUES (%s, 'FY27', 2, '2026-09-30') RETURNING id""",
        (company,),
    ).fetchone()[0]
    return conn.execute(
        f"""INSERT INTO forecast_events (period_id, results_date, lock_at, status, metric_definitions, season_label)
            VALUES (%s, '2026-10-30', now() + interval '{lock_offset}', 'open', %s, 'Q2 FY27') RETURNING id""",
        (period, METRICS),
    ).fetchone()[0]


def _forecast(conn, event_id: int, user_id: int) -> int:
    fid = conn.execute(
        "INSERT INTO forecasts (event_id, user_id) VALUES (%s, %s) RETURNING id", (event_id, user_id)
    ).fetchone()[0]
    conn.execute(
        "INSERT INTO forecast_values (forecast_id, metric_key, low, high) VALUES (%s, 'revenue_growth_yoy', 5, 9)",
        (fid,),
    )
    return fid


def _lock_now(conn, event_id: int) -> None:
    conn.execute("UPDATE forecast_events SET lock_at = now() - interval '1 second' WHERE id = %s", (event_id,))


class TestSchemaSetup:
    def test_markets_seeded(self, conn):
        rows = dict(conn.execute("SELECT code, active FROM markets").fetchall())
        assert rows == {"IN": True, "US": False}

    def test_schema_version_recorded(self, conn):
        (version,) = conn.execute("SELECT version FROM schema_version").fetchone()
        assert version >= db_module.SCHEMA_VERSION

    def test_init_db_is_a_no_op_once_current(self, conn):
        # Drop a harmless index; a skipped init_db must not recreate it.
        conn.execute("DROP INDEX idx_audit_log_entity")
        try:
            db_module.init_db()
            exists = conn.execute("SELECT to_regclass('idx_audit_log_entity')").fetchone()[0]
            assert exists is None
        finally:
            conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity, entity_id)")

    def test_init_db_reruns_when_version_is_behind(self, conn):
        conn.execute("DROP INDEX idx_audit_log_entity")
        conn.execute("UPDATE schema_version SET version = 0")
        db_module.init_db()
        assert conn.execute("SELECT to_regclass('idx_audit_log_entity')").fetchone()[0] is not None
        (version,) = conn.execute("SELECT version FROM schema_version").fetchone()
        assert version == db_module.SCHEMA_VERSION


class TestLockIntegrity:
    def test_forecast_editable_before_lock(self, conn):
        fid = _forecast(conn, _event(conn, "1 hour"), _user(conn))
        conn.execute("UPDATE forecast_values SET high = 10 WHERE forecast_id = %s", (fid,))
        conn.execute("UPDATE forecasts SET note = 'volumes up' WHERE id = %s", (fid,))

    def test_cannot_create_forecast_after_lock(self, conn):
        event = _event(conn, "-1 second")
        with pytest.raises(psycopg.errors.CheckViolation, match="forecast_locked"):
            conn.execute("INSERT INTO forecasts (event_id, user_id) VALUES (%s, %s)", (event, _user(conn)))

    def test_cannot_edit_values_after_lock(self, conn):
        event = _event(conn, "1 hour")
        fid = _forecast(conn, event, _user(conn))
        _lock_now(conn, event)
        with pytest.raises(psycopg.errors.CheckViolation, match="forecast_locked"):
            conn.execute("UPDATE forecast_values SET high = 10 WHERE forecast_id = %s", (fid,))

    def test_cannot_add_values_after_lock(self, conn):
        event = _event(conn, "1 hour")
        fid = _forecast(conn, event, _user(conn))
        _lock_now(conn, event)
        with pytest.raises(psycopg.errors.CheckViolation, match="forecast_locked"):
            conn.execute(
                "INSERT INTO forecast_values (forecast_id, metric_key, low, high) VALUES (%s, 'operating_margin', 1, 2)",
                (fid,),
            )

    def test_cannot_edit_or_delete_forecast_after_lock(self, conn):
        event = _event(conn, "1 hour")
        fid = _forecast(conn, event, _user(conn))
        _lock_now(conn, event)
        with pytest.raises(psycopg.errors.CheckViolation, match="forecast_locked"):
            conn.execute("UPDATE forecasts SET note = 'changed my mind' WHERE id = %s", (fid,))
        with pytest.raises(psycopg.errors.CheckViolation, match="forecast_locked"):
            conn.execute("DELETE FROM forecast_values WHERE forecast_id = %s", (fid,))
        with pytest.raises(psycopg.errors.CheckViolation, match="forecast_locked"):
            conn.execute("DELETE FROM forecasts WHERE id = %s", (fid,))

    def test_cannot_move_forecast_to_another_event(self, conn):
        user = _user(conn)
        fid = _forecast(conn, _event(conn, "1 hour", "AAA"), user)
        other = _event(conn, "1 hour", "BBB")
        with pytest.raises(psycopg.errors.CheckViolation, match="forecast_event_change_forbidden"):
            conn.execute("UPDATE forecasts SET event_id = %s WHERE id = %s", (other, fid))

    def test_lock_time_movable_before_it_passes(self, conn):
        event = _event(conn, "1 hour")
        conn.execute("UPDATE forecast_events SET lock_at = now() + interval '2 hours' WHERE id = %s", (event,))

    def test_passed_lock_time_is_frozen(self, conn):
        event = _event(conn, "-1 second")
        with pytest.raises(psycopg.errors.CheckViolation, match="lock_time_passed"):
            conn.execute("UPDATE forecast_events SET lock_at = now() + interval '1 day' WHERE id = %s", (event,))

    def test_other_event_fields_editable_after_lock(self, conn):
        event = _event(conn, "-1 second")
        conn.execute("UPDATE forecast_events SET status = 'scored' WHERE id = %s", (event,))


class TestConstraints:
    def test_one_forecast_per_user_per_event(self, conn):
        event, user = _event(conn, "1 hour"), _user(conn)
        _forecast(conn, event, user)
        with pytest.raises(psycopg.errors.UniqueViolation):
            conn.execute("INSERT INTO forecasts (event_id, user_id) VALUES (%s, %s)", (event, user))

    def test_low_above_high_rejected(self, conn):
        fid = conn.execute(
            "INSERT INTO forecasts (event_id, user_id) VALUES (%s, %s) RETURNING id",
            (_event(conn, "1 hour"), _user(conn)),
        ).fetchone()[0]
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute(
                "INSERT INTO forecast_values (forecast_id, metric_key, low, high) VALUES (%s, 'x', 9, 5)", (fid,)
            )

    def test_note_capped_at_140_chars(self, conn):
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute(
                "INSERT INTO forecasts (event_id, user_id, note) VALUES (%s, %s, %s)",
                (_event(conn, "1 hour"), _user(conn), "x" * 141),
            )

    def _period(self, conn) -> int:
        event = _event(conn, "1 hour")
        return conn.execute("SELECT period_id FROM forecast_events WHERE id = %s", (event,)).fetchone()[0]

    def test_actual_requires_source_url(self, conn):
        period = self._period(conn)
        with pytest.raises(psycopg.errors.NotNullViolation):
            conn.execute(
                """INSERT INTO actuals (period_id, metric_key, definition_key, value)
                   VALUES (%s, 'revenue_growth_yoy', 'in.revenue_growth_yoy.v1', 7.5)""",
                (period,),
            )

    @pytest.mark.parametrize("url", ["", "   ", "www.nseindia.com/x", "ftp://example.com/x", "https://"])
    def test_actual_rejects_non_http_source(self, conn, url):
        period = self._period(conn)
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute(
                """INSERT INTO actuals (period_id, metric_key, definition_key, value, source_url)
                   VALUES (%s, 'revenue_growth_yoy', 'in.revenue_growth_yoy.v1', 7.5, %s)""",
                (period, url),
            )

    def test_actual_with_source_accepted(self, conn):
        period = self._period(conn)
        conn.execute(
            """INSERT INTO actuals (period_id, metric_key, definition_key, value, source_url)
               VALUES (%s, 'revenue_growth_yoy', 'in.revenue_growth_yoy.v1', 7.5,
                       'https://www.bseindia.com/xml-data/corpfiling/AttachLive/example.pdf')""",
            (period,),
        )

    def test_handles_unique_case_insensitively(self, conn):
        a, b = _user(conn, "a@example.com"), _user(conn, "b@example.com")
        conn.execute("UPDATE users SET handle = 'Asha' WHERE id = %s", (a,))
        with pytest.raises(psycopg.errors.UniqueViolation):
            conn.execute("UPDATE users SET handle = 'asha' WHERE id = %s", (b,))

    def test_age_band_values_constrained(self, conn):
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute("UPDATE users SET age_band = 'twelve' WHERE id = %s", (_user(conn),))

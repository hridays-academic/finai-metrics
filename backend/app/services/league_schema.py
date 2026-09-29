"""
Postgres schema for the Results League (forecasting league for company
results). Same model as db.py's own list: plain, idempotent SQL that
init_db() runs, so it's safe on every deploy. Kept in its own module only
because it's larger than everything that came before it.

Changing anything here requires bumping db.SCHEMA_VERSION, or deployed
instances will skip it (see db.init_db).

Design points worth knowing before editing:

- **Timestamps are TIMESTAMPTZ, always UTC.** Display converts to the
  market's own timezone (markets.timezone). The older tables in db.py store
  TEXT timestamps; don't copy that here.

- **Actuals are keyed by fiscal period, not by forecast event.** A reported
  number is a fact about a company's quarter. Keying by period lets one
  table hold both new results and the admin-entered history that yfinance
  can't supply (it typically omits the year-ago quarter, measured 2026-09:
  Sep 2025 was missing for 28 of 40 NSE tickers). The lazy baseline is then
  computed straight from the year-ago period's row.

- **Every actual carries a definition_key** (e.g. "in.operating_margin.v1",
  defined in league_config.py). Scoring and lazy baselines only compare
  values recorded under the same definition, so a margin entered one way is
  never scored against a margin computed another way.

- **Integrity is enforced in the database, not just the API.** Triggers
  reject creating, editing or deleting a forecast once its event's lock_at
  has passed (by the database's own clock), and reject moving lock_at once
  it has passed. "Forecasts can't change after lock under any client
  behavior" then holds even against a bug in our own route code.
"""

LEAGUE_SCHEMA_STATEMENTS = [
    # ---------- Markets, companies, periods ----------
    """
    CREATE TABLE IF NOT EXISTS markets (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        timezone TEXT NOT NULL,
        default_currency TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT FALSE
    )
    """,
    """
    INSERT INTO markets (code, name, timezone, default_currency, active) VALUES
        ('IN', 'India', 'Asia/Kolkata', 'INR', TRUE),
        ('US', 'United States', 'America/New_York', 'USD', FALSE)
    ON CONFLICT (code) DO NOTHING
    """,
    # provider_symbol links a company to FinancialDataProvider (e.g.
    # "ULTRACEMCO.NS") for the research panel; NULL when there's no provider
    # coverage. is_demo marks seed-script companies, which must never appear
    # in real listings.
    """
    CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        market_code TEXT NOT NULL REFERENCES markets(code),
        exchange TEXT NOT NULL,
        ticker TEXT NOT NULL,
        name TEXT NOT NULL,
        sector TEXT NOT NULL,
        currency TEXT NOT NULL,
        fiscal_year_end_month SMALLINT NOT NULL CHECK (fiscal_year_end_month BETWEEN 1 AND 12),
        provider_symbol TEXT,
        is_demo BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (market_code, exchange, ticker)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS fiscal_periods (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id),
        fiscal_year_label TEXT NOT NULL,
        fiscal_quarter SMALLINT NOT NULL CHECK (fiscal_quarter BETWEEN 1 AND 4),
        period_end_date DATE NOT NULL,
        UNIQUE (company_id, fiscal_year_label, fiscal_quarter)
    )
    """,
    # ---------- Events and forecasts ----------
    # One event per period. status stores the admin's lifecycle (draft ->
    # open -> scored); whether an event is currently *locked* is derived
    # from lock_at vs. the database clock at read time, so no cron job is
    # needed to flip it. 'locked' stays a legal value for an explicit early
    # lock.
    """
    CREATE TABLE IF NOT EXISTS forecast_events (
        id SERIAL PRIMARY KEY,
        period_id INTEGER NOT NULL UNIQUE REFERENCES fiscal_periods(id),
        results_date DATE NOT NULL,
        lock_at TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'locked', 'scored')),
        metric_definitions JSONB NOT NULL,
        research_notes TEXT,
        season_label TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_forecast_events_lock_at ON forecast_events(lock_at)",
    """
    CREATE TABLE IF NOT EXISTS forecasts (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES forecast_events(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'locked')),
        reason_tags TEXT[] NOT NULL DEFAULT '{}',
        note TEXT CHECK (note IS NULL OR char_length(note) <= 140),
        UNIQUE (event_id, user_id)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_forecasts_user_id ON forecasts(user_id)",
    """
    CREATE TABLE IF NOT EXISTS forecast_values (
        forecast_id INTEGER NOT NULL REFERENCES forecasts(id),
        metric_key TEXT NOT NULL,
        low DOUBLE PRECISION NOT NULL,
        high DOUBLE PRECISION NOT NULL,
        confidence DOUBLE PRECISION NOT NULL DEFAULT 0.80,
        PRIMARY KEY (forecast_id, metric_key),
        CHECK (low <= high)
    )
    """,
    # ---------- Actuals and baselines ----------
    # source_url is mandatory and must be an http(s) URL -- an actual with no
    # citable source is rejected by the database itself.
    """
    CREATE TABLE IF NOT EXISTS actuals (
        period_id INTEGER NOT NULL REFERENCES fiscal_periods(id),
        metric_key TEXT NOT NULL,
        definition_key TEXT NOT NULL,
        value DOUBLE PRECISION NOT NULL,
        source_url TEXT NOT NULL CHECK (source_url ~ '^https?://[^[:space:]]+$'),
        entered_by INTEGER REFERENCES users(id),
        entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (period_id, metric_key)
    )
    """,
    # lazy_value is NULL (shown as N/A, beat-lazy skipped) when it can't be
    # derived from stored actuals and the admin hasn't entered one. Never
    # estimated.
    """
    CREATE TABLE IF NOT EXISTS baselines (
        event_id INTEGER NOT NULL REFERENCES forecast_events(id),
        metric_key TEXT NOT NULL,
        lazy_value DOUBLE PRECISION,
        analyst_value DOUBLE PRECISION,
        ai_value DOUBLE PRECISION,
        source_notes TEXT,
        PRIMARY KEY (event_id, metric_key)
    )
    """,
    # ---------- Scores and diagnoses ----------
    # Replaced wholesale (in one transaction) whenever an event is re-scored,
    # which is what makes scoring idempotent.
    """
    CREATE TABLE IF NOT EXISTS scores (
        forecast_id INTEGER NOT NULL REFERENCES forecasts(id),
        metric_key TEXT NOT NULL,
        interval_score DOUBLE PRECISION NOT NULL,
        points DOUBLE PRECISION NOT NULL,
        hit BOOLEAN NOT NULL,
        beat_lazy BOOLEAN,
        abs_error_mid DOUBLE PRECISION NOT NULL,
        scored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (forecast_id, metric_key)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS diagnoses (
        forecast_id INTEGER PRIMARY KEY REFERENCES forecasts(id),
        text TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    # ---------- Leagues ----------
    """
    CREATE TABLE IF NOT EXISTS leagues (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        join_code TEXT NOT NULL UNIQUE,
        created_by INTEGER NOT NULL REFERENCES users(id),
        school_name TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS league_members (
        league_id INTEGER NOT NULL REFERENCES leagues(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (league_id, user_id)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_league_members_user_id ON league_members(user_id)",
    # ---------- Practice (Time Machine) ----------
    # Kept entirely apart from forecasts/scores so practice can never leak
    # into league or season scores. The attempt's values column is
    # submitted_values (not "values", a reserved SQL word).
    """
    CREATE TABLE IF NOT EXISTS practice_cases (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id),
        years_json JSONB NOT NULL,
        target_year_actuals JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS practice_attempts (
        id SERIAL PRIMARY KEY,
        case_id INTEGER NOT NULL REFERENCES practice_cases(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        submitted_values JSONB NOT NULL,
        points DOUBLE PRECISION NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    # ---------- Audit log ----------
    """
    CREATE TABLE IF NOT EXISTS audit_log (
        id BIGSERIAL PRIMARY KEY,
        at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actor_user_id INTEGER REFERENCES users(id),
        action TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        details JSONB
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity, entity_id)",
    # ---------- Users: public league identity ----------
    # All nullable, so existing accounts keep working and are asked for a
    # handle on their first league action. Handles are unique
    # case-insensitively.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS handle TEXT",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_handle_lower ON users (lower(handle))",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS school_name TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS age_band TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_consent_status TEXT",
    """
    DO $$ BEGIN
        ALTER TABLE users ADD CONSTRAINT users_age_band_check
            CHECK (age_band IS NULL OR age_band IN ('under_18', '18_plus'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
    """,
    """
    DO $$ BEGIN
        ALTER TABLE users ADD CONSTRAINT users_guardian_consent_check
            CHECK (guardian_consent_status IS NULL
                   OR guardian_consent_status IN ('not_required', 'pending', 'granted'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
    """,
    # ---------- Integrity triggers ----------
    # A forecast (or one of its values) can't be created, edited or deleted
    # once its event's lock_at has passed. now() is the transaction start
    # time on the database's clock -- the single clock every serverless
    # instance shares.
    """
    CREATE OR REPLACE FUNCTION league_reject_after_lock() RETURNS trigger AS $$
    DECLARE
        v_event_id INTEGER;
        v_lock_at TIMESTAMPTZ;
    BEGIN
        IF TG_TABLE_NAME = 'forecasts' THEN
            v_event_id := COALESCE(NEW.event_id, OLD.event_id);
            IF TG_OP = 'UPDATE' AND NEW.event_id <> OLD.event_id THEN
                RAISE EXCEPTION 'forecast_event_change_forbidden' USING ERRCODE = 'check_violation';
            END IF;
        ELSE
            SELECT f.event_id INTO v_event_id FROM forecasts f
             WHERE f.id = COALESCE(NEW.forecast_id, OLD.forecast_id);
        END IF;
        SELECT e.lock_at INTO v_lock_at FROM forecast_events e WHERE e.id = v_event_id;
        IF v_lock_at IS NOT NULL AND v_lock_at <= now() THEN
            RAISE EXCEPTION 'forecast_locked' USING ERRCODE = 'check_violation';
        END IF;
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
    """,
    """
    CREATE OR REPLACE TRIGGER trg_forecasts_lock
        BEFORE INSERT OR UPDATE OR DELETE ON forecasts
        FOR EACH ROW EXECUTE FUNCTION league_reject_after_lock()
    """,
    """
    CREATE OR REPLACE TRIGGER trg_forecast_values_lock
        BEFORE INSERT OR UPDATE OR DELETE ON forecast_values
        FOR EACH ROW EXECUTE FUNCTION league_reject_after_lock()
    """,
    # Once lock_at has passed it can't be moved (in either direction): moving
    # it later would reopen locked forecasts for editing, which would make
    # the "locked before results" track record fakeable.
    """
    CREATE OR REPLACE FUNCTION league_freeze_passed_lock() RETURNS trigger AS $$
    BEGIN
        IF NEW.lock_at IS DISTINCT FROM OLD.lock_at AND OLD.lock_at <= now() THEN
            RAISE EXCEPTION 'lock_time_passed' USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
    """,
    """
    CREATE OR REPLACE TRIGGER trg_forecast_events_freeze_lock
        BEFORE UPDATE ON forecast_events
        FOR EACH ROW EXECUTE FUNCTION league_freeze_passed_lock()
    """,
]

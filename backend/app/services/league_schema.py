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
    # ---------- Practice (2026-11-18, schema v17) ----------
    # Practice reuses scored league events (their approved results and the
    # lazy guesses as scored), so it only stores attempts. Kept entirely apart
    # from forecasts/scores so practice can never reach results pages, season
    # scores or leaderboards. The old yearly "Time Machine" tables were never
    # read or written by any code; they are dropped only when empty, and the
    # migration stops (never deletes data) if either has rows.
    """
    DO $$
    BEGIN
        IF to_regclass('practice_cases') IS NOT NULL THEN
            IF EXISTS (SELECT 1 FROM practice_cases)
               OR (to_regclass('practice_attempts') IS NOT NULL AND EXISTS (SELECT 1 FROM practice_attempts)) THEN
                RAISE EXCEPTION 'practice_old_tables_not_empty: practice_cases/practice_attempts hold rows; '
                                'not dropping them. Move the rows aside, then redeploy.';
            END IF;
            DROP TABLE IF EXISTS practice_attempts;
            DROP TABLE practice_cases;
        END IF;
    END $$
    """,
    """
    CREATE TABLE IF NOT EXISTS practice_attempts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        event_id INTEGER NOT NULL REFERENCES forecast_events(id),
        ranges JSONB NOT NULL,
        points JSONB NOT NULL,
        total_points DOUBLE PRECISION NOT NULL,
        is_replay BOOLEAN NOT NULL,
        mystery BOOLEAN NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    # The database itself guarantees one first try per student and company.
    """CREATE UNIQUE INDEX IF NOT EXISTS practice_attempts_first_try
       ON practice_attempts(user_id, event_id) WHERE NOT is_replay""",
    "CREATE INDEX IF NOT EXISTS idx_practice_attempts_user ON practice_attempts(user_id)",
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
    # One plain-English line for the home page card (schema v6). NULL falls
    # back to league_config's default for the ticker.
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS description TEXT",
    # Scoring runs (schema v7). scored_at tells the admin board whether a
    # result was corrected after the last run. Each score keeps the actual
    # and lazy values it was computed from, so the results page always shows
    # what was actually scored, even after a correction (until re-scored).
    "ALTER TABLE forecast_events ADD COLUMN IF NOT EXISTS scored_at TIMESTAMPTZ",
    "ALTER TABLE scores ADD COLUMN IF NOT EXISTS actual_value DOUBLE PRECISION",
    "ALTER TABLE scores ADD COLUMN IF NOT EXISTS lazy_value DOUBLE PRECISION",
    # Archive events (schema v19): older quarters approved in a batch for
    # Practice and quick rounds only. Scored on creation with no forecasts,
    # never listed by the league, the results pages or "Just reported".
    "ALTER TABLE forecast_events ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'league'",
    """
    DO $$ BEGIN
        ALTER TABLE forecast_events ADD CONSTRAINT forecast_events_kind_check CHECK (kind IN ('league', 'archive'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
    """,
    # ---------- Users: public league identity ----------
    # All nullable, so existing accounts keep working and are asked for a
    # handle on their first league action. Handles are unique
    # case-insensitively.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS handle TEXT",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_handle_lower ON users (lower(handle))",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS school_name TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS age_band TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_consent_status TEXT",
    # (v8) Who gave consent, how, and when, entered by an admin. Cleared when
    # consent is undone or the account is deleted.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_consent_by TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_consent_method TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_consent_date DATE",
    """
    DO $$ BEGIN
        ALTER TABLE users ADD CONSTRAINT users_guardian_consent_method_check
            CHECK (guardian_consent_method IS NULL
                   OR guardian_consent_method IN ('signed_form', 'parent_email'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
    """,
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
        -- Clearing a note is allowed after the lock: account deletion
        -- (auth_service.delete_account) removes free text, and nothing that
        -- is scored changes. Any other column changing still falls through.
        -- (Nested: forecast_values has no note column to resolve.)
        IF TG_TABLE_NAME = 'forecasts' AND TG_OP = 'UPDATE' THEN
            IF (to_jsonb(NEW) ->> 'note') IS NULL
               AND (to_jsonb(NEW) - 'note') = (to_jsonb(OLD) - 'note') THEN
                RETURN NEW;
            END IF;
        END IF;
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
    # ---------- Research workspace (schema v14) ----------
    # One row per student per event: notes per step, ticked steps and the
    # driver worksheet. Private to the student; deleted with the account
    # (auth_service.delete_account) or by "Clear this workspace". Notes and
    # ticks stay editable after the lock; the worksheet doesn't.
    """
    CREATE TABLE IF NOT EXISTS research_workspaces (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        event_id INTEGER NOT NULL REFERENCES forecast_events(id),
        notes JSONB NOT NULL DEFAULT '{}'::jsonb,
        done TEXT[] NOT NULL DEFAULT '{}',
        worksheet JSONB,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, event_id)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_research_workspaces_event ON research_workspaces(event_id)",
    # Same clock as the forecast lock: the worksheet can't be written once
    # the event's lock_at has passed, whatever the API code does.
    """
    CREATE OR REPLACE FUNCTION workspace_reject_late_worksheet() RETURNS trigger AS $$
    DECLARE
        v_locked BOOLEAN;
    BEGIN
        IF (TG_OP = 'INSERT' AND NEW.worksheet IS NULL)
           OR (TG_OP = 'UPDATE' AND NEW.worksheet IS NOT DISTINCT FROM OLD.worksheet) THEN
            RETURN NEW;
        END IF;
        SELECT (e.status IN ('locked', 'scored') OR e.lock_at <= now()) INTO v_locked
            FROM forecast_events e WHERE e.id = NEW.event_id;
        IF v_locked THEN
            RAISE EXCEPTION 'worksheet_locked' USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
    """,
    """
    CREATE OR REPLACE TRIGGER trg_research_workspaces_worksheet_lock
        BEFORE INSERT OR UPDATE ON research_workspaces
        FOR EACH ROW EXECUTE FUNCTION workspace_reject_late_worksheet()
    """,
    # ---------- Progress, daily challenge and boards (schema v20, phase 6) ----------
    # Vault: Areas/Phase 6 plan. XP is never spent or lost; one award per
    # (user, source, ref), so a corrected result replaces an award instead of
    # adding a second. Every student row here is deleted with the account.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS leaderboard_opt_out BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS handle_status TEXT NOT NULL DEFAULT 'ok'",
    """
    DO $$ BEGIN
        ALTER TABLE users ADD CONSTRAINT users_handle_status_check CHECK (handle_status IN ('ok', 'review', 'blocked'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
    """,
    """
    CREATE TABLE IF NOT EXISTS xp_awards (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source TEXT NOT NULL CHECK (source IN ('league', 'practice', 'card')),
        ref TEXT NOT NULL,
        xp INTEGER NOT NULL CHECK (xp >= 0),
        day DATE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, source, ref)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_xp_awards_user_day ON xp_awards(user_id, day)",
    """
    CREATE TABLE IF NOT EXISTS user_badges (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        badge_key TEXT NOT NULL,
        earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, badge_key)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS daily_challenges (
        day DATE PRIMARY KEY,
        card_ids JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS daily_attempts (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        day DATE NOT NULL,
        score DOUBLE PRECISION NOT NULL,
        hits INTEGER NOT NULL,
        cards INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, day)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS quick_round_attempts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        cards INTEGER NOT NULL,
        hits INTEGER NOT NULL,
        score DOUBLE PRECISION NOT NULL,
        finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_quick_round_attempts_user ON quick_round_attempts(user_id)",
    # First attempt per card only (quick rounds and the daily challenge):
    # what "first attempts only", calibration and the weekly board read.
    """
    CREATE TABLE IF NOT EXISTS card_answers (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        card_id TEXT NOT NULL,
        event_id INTEGER NOT NULL REFERENCES forecast_events(id),
        metric_key TEXT NOT NULL,
        low DOUBLE PRECISION NOT NULL,
        high DOUBLE PRECISION NOT NULL,
        hit BOOLEAN NOT NULL,
        points DOUBLE PRECISION NOT NULL,
        beat_lazy BOOLEAN,
        mode TEXT NOT NULL CHECK (mode IN ('quick', 'daily')),
        answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, card_id)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_card_answers_answered ON card_answers(answered_at)",
    # ---------- Schools (schema v21, phase 8) ----------
    # Vault: Areas/Phase 8 plan. A teacher role given by an admin; classes with
    # a 6-character code; parent consent by email link (the parent's email is
    # kept only until the request is answered or expires after 14 days) or a
    # paper form the teacher marks received and an admin confirms; classroom
    # mode (one quick round on a projector, students answer on phones).
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'student'",
    """
    DO $$ BEGIN
        ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('student', 'teacher', 'admin'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
    """,
    """
    CREATE TABLE IF NOT EXISTS classes (
        id SERIAL PRIMARY KEY,
        code CHAR(6) NOT NULL UNIQUE,
        teacher_id INTEGER NOT NULL REFERENCES users(id),
        name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
        show_names BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS class_members (
        class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        paper_form_received_at TIMESTAMPTZ,
        PRIMARY KEY (class_id, user_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS consent_requests (
        id SERIAL PRIMARY KEY,
        student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        parent_email TEXT,
        token_hash TEXT NOT NULL UNIQUE,
        sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        answered_at TIMESTAMPTZ,
        approved BOOLEAN
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS classroom_sessions (
        id SERIAL PRIMARY KEY,
        class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        card_ids JSONB NOT NULL,
        current INTEGER NOT NULL DEFAULT 0,
        revealed BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMPTZ
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS classroom_answers (
        session_id INTEGER NOT NULL REFERENCES classroom_sessions(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        card_index INTEGER NOT NULL,
        low DOUBLE PRECISION NOT NULL,
        high DOUBLE PRECISION NOT NULL,
        PRIMARY KEY (session_id, user_id, card_index)
    )
    """,
    # ---------- Archive figures (schema v22, Stop 3 A6) ----------
    # Figures saved only through Older results are for Practice and Mystery:
    # league charts and Research's league figures leave them out.
    "ALTER TABLE actuals ADD COLUMN IF NOT EXISTS archive BOOLEAN NOT NULL DEFAULT FALSE",
]

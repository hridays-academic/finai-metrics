"""
Environment configuration, loaded once at startup from backend/.env.

Add new API keys here (as Optional[str] fields) rather than reading
os.environ directly elsewhere in the codebase -- this keeps every place
that needs a secret going through one auditable spot.
"""
from functools import lru_cache
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # The AI guide (phase 12, vault: Areas/AI guide plan). Anthropic's API
    # through the official SDK; the key is read here only and never reaches
    # the browser. Off unless ENABLE_GUIDE is true AND the admin toggle (or,
    # with no toggle saved, GUIDE_MODE_DEFAULT) is "staff" or "on".
    anthropic_api_key: Optional[str] = None
    enable_guide: bool = False
    guide_model: str = "claude-haiku-5-5"  # Sonnet 5.5 later is one variable: GUIDE_MODEL=claude-sonnet-5-5
    guide_inference_geo: str = "us"
    # "off" | "staff" (teachers and admins) | "on". Used only while no admin
    # toggle has been saved; previews set it, production never does.
    guide_mode_default: str = "off"
    # Canned replies, no network call. Refused on the production database.
    guide_fake_model: bool = False
    guide_daily_questions: int = 20
    guide_per_minute: int = 6
    guide_daily_spend_usd: float = 3.0

    # Neon Postgres connection string (see db.py) -- backs user accounts,
    # sessions, activity logs, caches and the Results League. Required
    # in any real deployment (Vercel's serverless functions have no
    # persistent local disk, unlike the SQLite file this replaced); locally,
    # set it in backend/.env.
    database_url: Optional[str] = None
    # Production-only override, set in Vercel to the Neon `main` branch.
    # Exists because the Neon integration manages DATABASE_URL itself and on
    # 2026-09-29 re-pointed it (for every environment) at the dev branch,
    # silently splitting production data. When set, it wins over
    # DATABASE_URL. Never print or log either value.
    stackly_database_url: Optional[str] = None

    @property
    def effective_database_url(self) -> Optional[str]:
        return self.stackly_database_url or self.database_url

    # Google OAuth Client ID (see auth_service.py / main.py's /api/auth/google
    # and frontend/src/lib/googleAuth.ts) -- the SAME value the frontend uses
    # as VITE_GOOGLE_CLIENT_ID (Client IDs are public by design, safe in
    # frontend bundle code). Required backend-side too: verify_oauth2_token
    # checks the ID token's audience against this value, which is what
    # actually prevents a token minted for some other app from being
    # accepted here. No client secret anywhere -- the ID-token flow (Google
    # Identity Services' `credential` callback) never needs one.
    google_client_id: Optional[str] = None

    # Sends "forgot password" reset emails via Gmail's own SMTP (see
    # app/services/gmail_service.py) rather than a new third-party email
    # provider -- deliberately chosen so no new external account is needed,
    # at the cost of mail coming from a personal-looking Gmail address and
    # Gmail's own ~500-recipients/day sending cap. gmail_app_password is a
    # Gmail *App Password* (https://myaccount.google.com/apppasswords),
    # never the account's real password -- Google blocks plain-password
    # SMTP auth by default. Without both set, forgot-password requests
    # still succeed from the client's point of view (never leaks whether
    # sending failed -- see main.py's /api/auth/forgot-password), but no
    # email actually goes out; the failure is logged server-side.
    gmail_address: Optional[str] = None
    gmail_app_password: Optional[str] = None

    # Dev-only: if set, the dormant BharatSMProvider caches its real network
    # calls to this directory on disk and serves repeat calls from there.
    # NEVER set this in a real deployment.
    dev_cache_dir: Optional[str] = None

    # Optional -- only used if the data provider is swapped to one of these.
    alpha_vantage_api_key: Optional[str] = None
    fmp_api_key: Optional[str] = None

    # USD/INR for the macro charts (FRED, free key). Without it that chart
    # says "Coming soon"; the World Bank series need no key.
    fred_api_key: Optional[str] = None
    # News videos (YouTube Data API v3, free quota). Without it the videos
    # job skips and no video section shows.
    youtube_api_key: Optional[str] = None
    # Vercel Cron sends "Authorization: Bearer <CRON_SECRET>"; the /api/cron/*
    # endpoints refuse every request when it isn't set.
    cron_secret: Optional[str] = None

    # Comma-separated emails allowed to use /api/admin/* (see
    # routes/deps.require_admin). Set in Vercel's env vars, never in code.
    admin_emails: str = ""

    @property
    def admin_email_set(self) -> frozenset[str]:
        return frozenset(e.strip().lower() for e in self.admin_emails.split(",") if e.strip())

    # Paper Trading's /api/trading/* endpoints serve ~15-minute-delayed
    # quotes, so they 404 unless this is true (2026-11, see main.py). Pair it
    # with the frontend's VITE_SHOW_EXTRA_TOOLS.
    enable_paper_trading: bool = False
    # News videos (WION, CNBC-TV18 ...) are off the site (audit T8, master
    # plan phase 1): /api/videos and company pages return none unless this is
    # true. Phase 7 brings back a curated teaching set instead.
    enable_news_videos: bool = False

    # Secret key for hashing client IPs before the rate limiter stores them
    # (rate_limit.py). Set in Vercel; without it each process makes up its
    # own key, which still hashes but weakens limits across instances.
    ip_hash_key: Optional[str] = None
    # Off only in the test suite, which signs up hundreds of users from one
    # "IP" (tests/conftest.py).
    auth_rate_limits_enabled: bool = True

    # Origins a password-reset link may point at. The request's Origin header
    # is used only if it is in this list (or cors_origins); anything else
    # gets the first entry. Never trust Origin on its own: a forged header
    # would put a real reset token in a link to someone else's site.
    public_origins: str = (
        "https://stackslymetrics.com,https://www.stackslymetrics.com,"
        "https://finai-metrics.vercel.app,https://stackly-metrics.vercel.app"
    )

    @property
    def public_origin_list(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.public_origins.split(",") if o.strip()]

    # Comma-separated list of allowed frontend origins for CORS.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

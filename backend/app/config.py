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

    # Required for the AI assistant (active default). Get a key at
    # https://platform.kimi.ai
    moonshot_api_key: Optional[str] = None
    moonshot_model: str = "kimi-k2.6"

    # Alternate AI assistant backends (see app/services/deepseek_service.py
    # and app/services/claude_service.py) -- only used if you swap
    # moonshot_service.py back out in main.py.
    deepseek_api_key: Optional[str] = None
    deepseek_model: str = "deepseek-v4-flash"
    anthropic_api_key: Optional[str] = None
    claude_model: str = "claude-sonnet-4-5"

    # Neon Postgres connection string (see db.py) -- backs user accounts,
    # sessions, activity logs, caches and the Results League. Required
    # in any real deployment (Vercel's serverless functions have no
    # persistent local disk, unlike the SQLite file this replaced); locally,
    # set it in backend/.env.
    database_url: Optional[str] = None

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

    # Comma-separated emails allowed to use /api/admin/* (see
    # routes/deps.require_admin). Set in Vercel's env vars, never in code.
    admin_emails: str = ""

    @property
    def admin_email_set(self) -> frozenset[str]:
        return frozenset(e.strip().lower() for e in self.admin_emails.split(",") if e.strip())

    # Comma-separated list of allowed frontend origins for CORS.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

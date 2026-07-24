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
    # sessions, activity logs, and Tapetide per-key quota tracking. Required
    # in any real deployment (Vercel's serverless functions have no
    # persistent local disk, unlike the SQLite file this replaced); locally,
    # set it in backend/.env.
    database_url: Optional[str] = None

    # Symmetric encryption key (Fernet, see auth_service.py) for a signed-in
    # user's saved Tapetide API key at rest in Postgres -- generate one with
    # `python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`.
    # Without this set, saving/reading an account's Tapetide key just fails
    # gracefully (see auth_service.py) rather than ever storing one in
    # plaintext.
    encryption_key: Optional[str] = None

    # NOT a server-side secret anymore (2026-07) -- Tapetide (NSE/BSE quotes,
    # financials, ratios) is now bring-your-own-key: every user enters their
    # own Tapetide API key client-side, sent per-request as the
    # `X-Tapetide-Token` header (see main.py and CLAUDE.md's "Bring-your-own
    # Tapetide key" section). There is deliberately no TAPETIDE_TOKEN env var
    # anymore -- only the (non-secret) API endpoint URL stays configurable here.
    tapetide_mcp_url: str = "https://mcp.tapetide.com/mcp"

    # Dev-only: if set, both TapetideProvider and BharatSMProvider cache
    # their real network calls to this same directory on disk and serve
    # repeat calls from there instead of hitting the network -- saves
    # Tapetide's free-tier quota (and just speeds up repeat local testing
    # against Bharat-SM-Data, which isn't quota-limited but still slow
    # per-call) -- see both providers' docstrings. They write distinctly-
    # named/formatted files into the same folder, so one directory covers
    # both. NEVER set this in a real deployment.
    dev_cache_dir: Optional[str] = None

    # Optional -- only used if the data provider is swapped to one of these.
    alpha_vantage_api_key: Optional[str] = None
    fmp_api_key: Optional[str] = None

    # Comma-separated list of allowed frontend origins for CORS.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

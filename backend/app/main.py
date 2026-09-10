"""
FastAPI entry point. Route handlers stay thin -- all business logic lives in
app/services/*. Run with:

    uvicorn app.main:app --reload --port 8000

(from the backend/ directory, with the virtualenv active).
"""
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google.auth.transport import requests as google_auth_requests
from google.oauth2 import id_token as google_id_token

from app.config import get_settings
from app.models import (
    ActivityResponse,
    AuthResponse,
    ChatRequest,
    ChatResponse,
    CompanyFinancialsResponse,
    CompanyInfo,
    DataSourceName,
    GoogleAuthRequest,
    IntradayHistoryResponse,
    LiveQuote,
    LogInRequest,
    PriceHistoryResponse,
    PricePoint,
    QuotaStatus,
    RawFinancials,
    SignUpRequest,
    TapetideKeyRequest,
    TradingSymbolInfo,
    UserPublic,
)
from app.services.moonshot_service import get_chat_reply
from app.services.data_provider import (
    CompanyNotFoundError,
    DataProviderError,
    FinancialDataProvider,
    ProviderQuotaExceededError,
)
from app.services.metrics import compute_health_snapshot, compute_metric_groups
from app.services.tapetide_provider import InvalidTapetideKeyError, TapetideProvider
from app.services.yfinance_provider import YFinanceProvider
from app.services import auth_service
from app.services.auth_service import AuthError
from app.services.db import init_db

_IST = timezone(timedelta(hours=5, minutes=30))
# Tapetide's quota-exceeded message embeds the reset time as e.g.
# "...(at 2026-07-14 00:00 IST)..." -- pull that out so the frontend can show
# a live countdown next to the searches-remaining counter instead of just
# "try later."
_RESET_TIME_RE = re.compile(r"at (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) IST")


def _parse_tapetide_reset_at(message: str) -> Optional[str]:
    match = _RESET_TIME_RE.search(message)
    if not match:
        return None
    naive = datetime.strptime(match.group(1), "%Y-%m-%d %H:%M")
    return naive.replace(tzinfo=_IST).isoformat()


def _next_midnight_ist() -> str:
    """Deterministic reset timestamp for the quota counter, available even
    when we haven't seen a live quota-exceeded message yet this run (unlike
    _parse_tapetide_reset_at, which needs Tapetide's own wording)."""
    now_ist = datetime.now(_IST)
    next_midnight = (now_ist + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return next_midnight.isoformat()


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("finai")

settings = get_settings()
app = FastAPI(title="Stackly API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()


def _current_user(authorization: Optional[str] = Header(None)) -> Optional[dict]:
    """Optional auth -- returns the signed-in user dict (see
    auth_service.get_user_from_token) if `Authorization: Bearer <token>` is
    present and valid, else None. Never raises 401: every endpoint that uses
    this still works fully signed-out, since sign-in in this app is purely
    for activity tracking, not a gate on using the product (see CLAUDE.md)."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    return auth_service.get_user_from_token(authorization.removeprefix("Bearer ").strip())


def _tapetide_token(x_tapetide_token: Optional[str] = Header(None)) -> Optional[str]:
    """Every user's own Tapetide API key (see CLAUDE.md's "Bring-your-own
    Tapetide key" section) -- sent as this header on every request that
    needs it, never a server-side default anymore. None if missing/blank;
    callers decide whether that's fatal (price history, quota) or just
    means "skip this bonus data" (analyst consensus)."""
    return x_tapetide_token.strip() if x_tapetide_token and x_tapetide_token.strip() else None


# yfinance is the automatic fallback for price history and analyst consensus
# when a user's Tapetide quota is exhausted (see CLAUDE.md's "Sourcing"
# section). Doesn't need a per-user key, so it stays a shared, module-level
# singleton.
fallback_provider: FinancialDataProvider = YFinanceProvider()

# Recount from the actual Tapetide call sites in get_company/get_price_history
# below if you add/remove a call anywhere -- see CLAUDE.md's quota breakdown.
# fundamentals: search_stocks (1) + get_company_profile (1, cached alongside
# ratings) + get_financials x3 (profit_loss/balance_sheet/ratios) +
# get_stock_ownership (1) = 6. analyst consensus: get_forecasts (1, profile
# reused from fundamentals' cache) = 1. price history: get_price_history x2
# (5yr weekly merge) + get_recent_price_history x1 (daily) = 3. Total = 10
# per full company view (back up from the ~5/search hybrid-sourcing design,
# see main.py's get_company docstring comment for why: Tickertape blocks
# Vercel's IPs, so fundamentals moved back to Tapetide).
TAPETIDE_CALLS_PER_SEARCH = 10

# Simple in-process cache of the last-fetched company per ticker, so the chat
# endpoint can attach context without the frontend having to resend the full
# payload on every message. Keyed by ticker, not by user/session -- fine
# only because /api/chat isn't reachable from the frontend UI at all right
# now (see CLAUDE.md's "AI assistant" section); if it's ever re-added, this
# needs to key by session/user instead, since the app is genuinely
# multi-user now (see "Bring-your-own Tapetide key" / "Accounts & activity
# tracking"), not the single-owner local tool this comment used to assume.
_last_company_by_ticker: dict[str, CompanyFinancialsResponse] = {}


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


def _normalize_for_match(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", s.upper())


def _looks_like_the_query(query: str, info: CompanyInfo) -> bool:
    """Guards against a provider's fuzzy symbol search returning a match
    with no real relation to what was typed -- confirmed live, not
    hypothetical: searching a foreign ticker like "AAPL" had Tapetide's
    search_stocks silently match it to an unrelated Indian company, and the
    app proceeded to fetch and return real data for the wrong company. That
    request only actually 404'd because Tapetide's quota happened to run
    out a few calls later, forcing a fallback whose OWN resolve_symbol
    correctly rejected "AAPL" -- without that coincidence, it would have
    returned the wrong company silently. This check runs after
    get_company_info (so it's comparing against real returned data, not the
    raw search hit) and deliberately allows prefix/substring matches, not
    just exact ones, so real abbreviation-style searches keep working
    ("TCS", "L&T", "ITC", or a partial company name) -- only a match with
    NO textual relationship to the query at all gets rejected."""
    bare = query.strip().upper()
    for suffix in (".NS", ".BO"):
        if bare.endswith(suffix):
            bare = bare[: -len(suffix)]
    q = _normalize_for_match(bare)
    if not q:
        return False
    ticker = _normalize_for_match(info.ticker or "")
    resolved = _normalize_for_match(info.resolved_symbol or "")
    name = _normalize_for_match(info.company_name or "")
    if q == ticker or q == resolved:
        return True
    if len(q) >= 2 and (ticker.startswith(q) or resolved.startswith(q)):
        return True
    if len(q) >= 3 and (q in name or (len(name) >= 3 and name in q)):
        return True
    return False


def _fetch_company_core(
    provider: FinancialDataProvider, query: str
) -> tuple[str, CompanyInfo, RawFinancials]:
    symbol, _exchange = provider.resolve_symbol(query)
    info = provider.get_company_info(symbol)
    if not _looks_like_the_query(query, info):
        raise CompanyNotFoundError(
            f"Could not find '{query}' on NSE/BSE. Try the exact ticker, e.g. 'RELIANCE' or 'TCS'."
        )
    raw = provider.get_raw_financials(symbol)
    return symbol, info, raw


@app.get("/api/company/{query}", response_model=CompanyFinancialsResponse)
def get_company(
    query: str,
    current_user: Optional[dict] = Depends(_current_user),
    tapetide_token: Optional[str] = Depends(_tapetide_token),
) -> CompanyFinancialsResponse:
    # Fundamentals come from Tapetide now (2026-07), not Bharat-SM-Data --
    # Tickertape (which bharat_sm_provider.py wraps) 403-blocks Vercel's
    # cloud IP range for its search/profile endpoints, confirmed live after
    # deploying there (the same class of anti-bot block bharat_sm_provider.py
    # already documents for NSE's price-history API, just hitting the
    # fundamentals path too this time). Tapetide is a real metered API, not
    # a scraper -- confirmed reachable from Vercel. This costs more of the user's
    # quota per search (~10 Tapetide calls instead of ~5 -- recount from the
    # real call sites below if this changes, see CLAUDE.md) and loses the
    # current/quick ratio liquidity figures Bharat-SM-Data's fuller balance
    # sheet uniquely provided (back to N/A, same as the pre-hybrid design).
    # Unlike the old Bharat-only path, this now requires a Tapetide key up
    # front -- consistent with price-history below, and with the frontend's
    # TapetideKeyGate already blocking the whole app until one exists.
    if not tapetide_token:
        raise HTTPException(status_code=400, detail="A Tapetide API key is required.")

    tapetide_reset_at: Optional[str] = None
    quota_exhausted = False
    tapetide = TapetideProvider(tapetide_token)
    try:
        try:
            symbol, info, raw = _fetch_company_core(tapetide, query)
        except ProviderQuotaExceededError as exc:
            logger.warning(
                "Tapetide quota exhausted for query=%s -- falling back to yfinance for fundamentals", query
            )
            tapetide_reset_at = _parse_tapetide_reset_at(str(exc))
            quota_exhausted = True
            symbol, info, raw = _fetch_company_core(fallback_provider, query)
    except CompanyNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except InvalidTapetideKeyError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except DataProviderError as exc:
        logger.warning("Data provider error fetching company data for query=%s: %s", query, exc)
        raise HTTPException(
            status_code=502,
            detail="Couldn't fetch this company's data right now -- the data provider may be temporarily "
            "unavailable. Please try again in a moment.",
        ) from exc
    except Exception as exc:  # noqa: BLE001 -- surface as a friendly 500, but log the real cause
        logger.exception("Unexpected error fetching company data for query=%s", query)
        raise HTTPException(
            status_code=500,
            detail="Something went wrong fetching that company's data. Please try again.",
        ) from exc

    # Analyst consensus stays best-effort, reusing the SAME TapetideProvider
    # instance from fundamentals above (its _profile_cache means this costs
    # only one more call, get_forecasts, not a second profile fetch) --
    # skipped entirely if we already know this key is out of quota today
    # (quota_exhausted above). Retrying it would both fail again AND falsely
    # inflate our own local call count, since tapetide_provider.py's counter
    # increments before the network request, even for a call that
    # immediately 429s.
    analyst_consensus = None
    consensus_source: Optional[DataSourceName] = None
    if not quota_exhausted:
        try:
            analyst_consensus = tapetide.get_analyst_consensus(info.resolved_symbol)
            consensus_source = DataSourceName.TAPETIDE
        except ProviderQuotaExceededError as exc:
            logger.warning(
                "Tapetide quota exhausted for analyst consensus symbol=%s -- falling back to yfinance",
                info.resolved_symbol,
            )
            tapetide_reset_at = tapetide_reset_at or _parse_tapetide_reset_at(str(exc))
            quota_exhausted = True
        except Exception:  # noqa: BLE001 -- third-party analyst data is a bonus, not core
            logger.warning("Couldn't fetch analyst consensus for symbol=%s", info.resolved_symbol, exc_info=True)
    if quota_exhausted and analyst_consensus is None:
        try:
            fallback_symbol, _exchange = fallback_provider.resolve_symbol(info.resolved_symbol)
            analyst_consensus = fallback_provider.get_analyst_consensus(fallback_symbol)
            consensus_source = DataSourceName.YFINANCE
        except Exception:  # noqa: BLE001 -- still a bonus, not core
            logger.warning(
                "Fallback analyst consensus also failed for symbol=%s", info.resolved_symbol, exc_info=True
            )

    metric_groups = compute_metric_groups(raw, info.company_name)
    health_snapshot = compute_health_snapshot(metric_groups)
    response = CompanyFinancialsResponse(
        info=info,
        raw=raw,
        metric_groups=metric_groups,
        health_snapshot=health_snapshot,
        analyst_consensus=analyst_consensus,
        consensus_source=consensus_source,
        tapetide_reset_at=tapetide_reset_at,
    )
    _last_company_by_ticker[info.resolved_symbol] = response
    # No-op if current_user is None (anonymous search) -- see
    # auth_service.log_activity's docstring for why that's a deliberate
    # no-guard-needed call site, not an oversight.
    auth_service.log_activity(current_user, "searched", info.company_name)
    return response


def _fetch_price_points(
    provider: FinancialDataProvider, symbol: str, *, needs_resolve: bool
) -> tuple[list[PricePoint], list[PricePoint]]:
    # yfinance needs a ".NS"/".BO"-suffixed symbol -- if the incoming symbol
    # came from a Tapetide-resolved company (bare, e.g. "RELIANCE"), resolve
    # it through yfinance's own logic first. Tapetide's tools take the bare
    # form directly, so no resolve step is needed when targeting it.
    active_symbol = symbol
    if needs_resolve:
        active_symbol, _exchange = provider.resolve_symbol(symbol)
    points = provider.get_price_history(active_symbol)
    try:
        recent_points = provider.get_recent_price_history(active_symbol)
    except Exception:  # noqa: BLE001 -- the 1D/5D views are a bonus, not core
        logger.warning("Couldn't fetch recent price history for symbol=%s", active_symbol, exc_info=True)
        recent_points = []
    return points, recent_points


@app.get("/api/price-history/{symbol}", response_model=PriceHistoryResponse)
def get_price_history(
    symbol: str, tapetide_token: Optional[str] = Depends(_tapetide_token)
) -> PriceHistoryResponse:
    # Price history is Bharat-SM-Data's permanent gap (see
    # bharat_sm_provider.py) -- always Tapetide, falling back to yfinance on
    # quota exhaustion. `symbol` is expected to be the plain ticker Bharat
    # already resolved (info.resolved_symbol from /api/company), which
    # Tapetide's tools accept directly -- no resolve step needed there.
    # Unlike analyst consensus on /api/company, this IS core to what this
    # endpoint does, so no key means a real error, not a silent empty result.
    if not tapetide_token:
        raise HTTPException(status_code=400, detail="A Tapetide API key is required for price history.")

    resolved = symbol.strip().upper()
    tapetide_reset_at: Optional[str] = None
    try:
        active_source = DataSourceName.TAPETIDE
        tapetide = TapetideProvider(tapetide_token)
        try:
            points, recent_points = _fetch_price_points(tapetide, resolved, needs_resolve=False)
        except ProviderQuotaExceededError as exc:
            logger.warning(
                "Tapetide quota exhausted for price history symbol=%s -- falling back to yfinance",
                resolved,
            )
            active_source = DataSourceName.YFINANCE
            tapetide_reset_at = _parse_tapetide_reset_at(str(exc))
            points, recent_points = _fetch_price_points(fallback_provider, resolved, needs_resolve=True)
    except CompanyNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except InvalidTapetideKeyError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except DataProviderError as exc:
        logger.warning("Data provider error fetching price history for symbol=%s: %s", resolved, exc)
        raise HTTPException(
            status_code=502,
            detail="Couldn't load price history right now -- the data provider may be temporarily "
            "unavailable. Please try again in a moment.",
        ) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Unexpected error fetching price history for symbol=%s", resolved)
        raise HTTPException(
            status_code=500,
            detail="Something went wrong fetching price history. Please try again.",
        ) from exc

    return PriceHistoryResponse(
        symbol=resolved,
        points=points,
        recent_points=recent_points,
        active_source=active_source,
        tapetide_reset_at=tapetide_reset_at,
    )


_TRADING_RANGES = ("1D", "1W", "1M", "3M", "1Y", "5Y")


# ---------- Paper Trading ----------
# Deliberately entirely yfinance-based, never Tapetide -- Tapetide has no
# live-quote or intraday-bar capability at all, and even if it did, its
# 50-calls/day-per-key quota (see TAPETIDE_CALLS_PER_SEARCH above) cannot
# support the polling this module needs (a single symbol polled every 15s
# is already ~5,760 calls/day). None of these three endpoints need a
# Tapetide key/token, and portfolio state itself (cash/holdings/
# transactions) is intentionally never sent here at all -- it's held
# entirely client-side (localStorage, see frontend/src/lib/portfolio.ts),
# so there's nothing for these endpoints to persist. `fallback_provider`
# (the module-level YFinanceProvider singleton already declared above) is
# reused rather than a second instance, same as every other yfinance call
# in this file.


@app.get("/api/trading/search/{query}", response_model=TradingSymbolInfo)
def trading_search(query: str) -> TradingSymbolInfo:
    """Resolves a company name/ticker for Paper Trading's own stock picker --
    intentionally lighter than /api/company (no financial statements, no
    metric computation): just enough to identify what was picked. Reuses
    resolve_symbol/get_company_info (already on YFinanceProvider) and the
    same _looks_like_the_query guard /api/company uses, rather than
    inventing a second symbol-matching path."""
    try:
        symbol, _exchange = fallback_provider.resolve_symbol(query)
        info = fallback_provider.get_company_info(symbol)
        if not _looks_like_the_query(query, info):
            raise CompanyNotFoundError(
                f"Could not find '{query}' on NSE/BSE. Try the exact ticker, e.g. 'RELIANCE' or 'TCS'."
            )
    except CompanyNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except DataProviderError as exc:
        logger.warning("Data provider error resolving trading symbol query=%s: %s", query, exc)
        raise HTTPException(
            status_code=502,
            detail="Couldn't look that up right now -- the data provider may be temporarily unavailable.",
        ) from exc

    return TradingSymbolInfo(
        ticker=info.ticker,
        resolved_symbol=info.resolved_symbol,
        exchange=info.exchange,
        company_name=info.company_name,
        currency="INR",
    )


@app.get("/api/trading/quote/{symbol}", response_model=LiveQuote)
def trading_quote(symbol: str) -> LiveQuote:
    """The polling endpoint -- see YFinanceProvider.get_live_quote for why
    this is deliberately the cheapest possible call (fast_info, not a full
    .info scrape), since this is the one thing in the whole app meant to be
    hit repeatedly on a timer rather than once per user action."""
    try:
        return fallback_provider.get_live_quote(symbol)
    except CompanyNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except DataProviderError as exc:
        logger.warning("Data provider error fetching live quote for symbol=%s: %s", symbol, exc)
        raise HTTPException(
            status_code=502,
            detail="Couldn't fetch a live quote right now -- please try again shortly.",
        ) from exc


@app.get("/api/trading/history/{symbol}", response_model=IntradayHistoryResponse)
def trading_history(symbol: str, range: str = "1D") -> IntradayHistoryResponse:  # noqa: A002 -- matches the query param name the frontend sends
    range_key = range.strip().upper()
    if range_key not in _TRADING_RANGES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid range '{range}'. Must be one of {', '.join(_TRADING_RANGES)}.",
        )
    try:
        points = fallback_provider.get_intraday_history(symbol, range_key)
    except DataProviderError as exc:
        logger.warning(
            "Data provider error fetching intraday history for symbol=%s range=%s: %s",
            symbol, range_key, exc,
        )
        raise HTTPException(
            status_code=502,
            detail="Couldn't load chart data right now -- please try again shortly.",
        ) from exc

    return IntradayHistoryResponse(
        symbol=symbol, range=range_key, currency="INR", points=points, is_delayed=True, source="yfinance",
    )


@app.get("/api/quota", response_model=QuotaStatus)
def get_quota(tapetide_token: Optional[str] = Depends(_tapetide_token)) -> QuotaStatus:
    # Quota is inherently per-key now (see tapetide_provider.py) -- there's
    # no meaningful "quota" to report without knowing whose key it is.
    if not tapetide_token:
        raise HTTPException(status_code=400, detail="A Tapetide API key is required.")
    used, remaining = TapetideProvider(tapetide_token).get_quota_status()
    return QuotaStatus(
        tapetide_calls_used_today=used,
        tapetide_calls_remaining_estimate=remaining,
        tapetide_calls_per_search=TAPETIDE_CALLS_PER_SEARCH,
        tapetide_searches_remaining_estimate=remaining // TAPETIDE_CALLS_PER_SEARCH,
        tapetide_reset_at=_next_midnight_ist(),
    )


@app.get("/api/tapetide/validate")
def validate_tapetide_key(tapetide_token: Optional[str] = Depends(_tapetide_token)) -> dict:
    """Used by the frontend's sign-in gate to check a freshly-entered key
    before storing it -- see TapetideProvider.validate_key() for the one
    cheap, cache-bypassing real call this makes rather than trusting the
    key blindly. A quota-exhausted key is still accepted (it's genuinely
    valid, just out of calls for today -- yfinance covers the app in the
    meantime); only a rejected key (HTTP 401) is treated as invalid."""
    if not tapetide_token:
        raise HTTPException(status_code=400, detail="Please enter an API key.")
    try:
        TapetideProvider(tapetide_token).validate_key()
    except InvalidTapetideKeyError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except ProviderQuotaExceededError:
        pass  # key is valid, just already out of quota today
    except DataProviderError as exc:
        logger.warning("Data provider error validating Tapetide key: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="Couldn't verify the key right now -- the data provider may be temporarily unavailable. "
            "Please try again in a moment.",
        ) from exc
    return {"status": "ok"}


@app.post("/api/auth/tapetide-key", response_model=UserPublic)
def save_tapetide_key(
    request: TapetideKeyRequest,
    current_user: Optional[dict] = Depends(_current_user),
) -> UserPublic:
    """Used by TapetideKeyGate.tsx's key-entry step when the visitor is
    signed in -- same validation as /api/tapetide/validate above, but also
    persists the key to their account (encrypted, see auth_service.py) so a
    future sign-in on any browser/device can skip key entry entirely. 401
    if not signed in -- the anonymous ("continue without an account") path
    uses /api/tapetide/validate instead, which never saves anything."""
    if not current_user:
        raise HTTPException(status_code=401, detail="Sign in to save a Tapetide key to your account.")
    key = request.key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="Please enter an API key.")
    try:
        TapetideProvider(key).validate_key()
    except InvalidTapetideKeyError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except ProviderQuotaExceededError:
        pass  # key is valid, just already out of quota today -- still worth saving
    except DataProviderError as exc:
        logger.warning("Data provider error validating Tapetide key for account save: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="Couldn't verify the key right now -- the data provider may be temporarily unavailable. "
            "Please try again in a moment.",
        ) from exc
    auth_service.save_tapetide_key(current_user["id"], key)
    return UserPublic(**{**current_user, "tapetide_key": key})


@app.post("/api/auth/signup", response_model=AuthResponse)
def sign_up(request: SignUpRequest) -> AuthResponse:
    try:
        _user_id, token = auth_service.sign_up(request.email, request.name, request.password)
    except AuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    user = auth_service.get_user_from_token(token)
    assert user is not None  # just created, token can't be invalid/expired yet
    return AuthResponse(token=token, user=UserPublic(**user))


@app.post("/api/auth/login", response_model=AuthResponse)
def log_in(request: LogInRequest) -> AuthResponse:
    try:
        _user_id, token = auth_service.log_in(request.email, request.password)
    except AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    user = auth_service.get_user_from_token(token)
    assert user is not None
    return AuthResponse(token=token, user=UserPublic(**user))


@app.post("/api/auth/google", response_model=AuthResponse)
def google_auth(request: GoogleAuthRequest) -> AuthResponse:
    """Verifies the ID token Google Identity Services handed the frontend
    (see frontend/src/lib/googleAuth.ts's credential callback) before
    trusting anything in it -- `verify_oauth2_token` checks the signature,
    expiry, and that the token's audience matches GOOGLE_CLIENT_ID (i.e.
    this token was actually minted for this app, not some other one using
    the same Google account). Same response shape as /api/auth/signup and
    /api/auth/login -- the frontend treats all three interchangeably."""
    client_id = settings.google_client_id
    if not client_id:
        raise HTTPException(status_code=503, detail="Google Sign-In isn't configured on this server yet.")
    try:
        payload = google_id_token.verify_oauth2_token(
            request.credential, google_auth_requests.Request(), client_id
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=401, detail="Couldn't verify that Google sign-in. Please try again."
        ) from exc

    email = payload.get("email")
    google_id = payload.get("sub")
    if not email or not google_id:
        raise HTTPException(status_code=401, detail="Google didn't return the expected account details.")
    if not payload.get("email_verified", False):
        raise HTTPException(status_code=401, detail="Please verify your email with Google before signing in.")
    name = payload.get("name") or email.split("@")[0]

    _user_id, token = auth_service.login_with_google(email, name, google_id)
    user = auth_service.get_user_from_token(token)
    assert user is not None  # just created/found, token can't be invalid/expired yet
    return AuthResponse(token=token, user=UserPublic(**user))


@app.post("/api/auth/logout")
def log_out(authorization: Optional[str] = Header(None)) -> dict:
    if authorization and authorization.startswith("Bearer "):
        auth_service.log_out(authorization.removeprefix("Bearer ").strip())
    return {"status": "ok"}


@app.get("/api/auth/me", response_model=Optional[UserPublic])
def get_me(current_user: Optional[dict] = Depends(_current_user)) -> Optional[UserPublic]:
    return UserPublic(**current_user) if current_user else None


@app.get("/api/activity", response_model=ActivityResponse)
def get_activity(current_user: Optional[dict] = Depends(_current_user)) -> ActivityResponse:
    if not current_user:
        raise HTTPException(status_code=401, detail="Sign in to view your activity.")
    return ActivityResponse(entries=auth_service.get_activity(current_user["id"]))


@app.post("/api/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    context = None
    if request.ticker:
        context = _last_company_by_ticker.get(request.ticker.strip().upper())

    try:
        reply = get_chat_reply(request.message, request.history, context)
    except RuntimeError as exc:
        # Missing/invalid API key configuration -- a server setup issue, not a user error.
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Chat request failed")
        raise HTTPException(
            status_code=502,
            detail="The AI assistant is temporarily unavailable. Please try again shortly.",
        ) from exc

    return ChatResponse(reply=reply)

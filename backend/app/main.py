"""
FastAPI entry point. Route handlers stay thin -- all business logic lives in
app/services/*. Run with:

    uvicorn app.main:app --reload --port 8000

(from the backend/ directory, with the virtualenv active).
"""
import logging
import re
from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from google.auth.transport import requests as google_auth_requests
from google.oauth2 import id_token as google_id_token

from app.config import get_settings
from app.models import (
    ActivityResponse,
    AnalystConsensus,
    AuthResponse,
    ChatRequest,
    ChatResponse,
    CompanyFinancialsResponse,
    CompanyInfo,
    DataSourceName,
    ForgotPasswordRequest,
    GoogleAuthRequest,
    IntradayHistoryResponse,
    LiveQuote,
    LogInRequest,
    PriceHistoryResponse,
    PricePoint,
    RawFinancials,
    ResetPasswordRequest,
    SignUpRequest,
    TradingSymbolInfo,
    UserPublic,
)
from app.services.moonshot_service import get_chat_reply
from app.services.data_provider import (
    CompanyNotFoundError,
    DataProviderError,
    FinancialDataProvider,
    resolves_via_former_name,
)
from app.services.metrics import compute_health_snapshot, compute_metric_groups
from app.services import gmail_service
from app.services.providers import provider as shared_provider
from app.services import auth_service, fundamentals_cache, rate_limit
from app.services.auth_service import AuthError
from app.services import db as db_module
from app.services.db import get_conn, init_db
from app.routes import admin as admin_routes, league as league_routes, visits as visit_routes
from app.services.league_service import LeagueError
from app.routes.deps import optional_user as _current_user

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

app.include_router(visit_routes.router)
app.include_router(admin_routes.router)
app.include_router(league_routes.router)


@app.exception_handler(LeagueError)
def _league_error(_request: Request, exc: LeagueError) -> JSONResponse:
    return JSONResponse(status_code=exc.status, content={"detail": {"code": exc.code, "message": exc.message}})


def _rate_limited(request: Request) -> None:
    """Per-IP rate limiting for the keyless data endpoints (see
    rate_limit.py). Applied as a dependency so it runs before any provider or
    cache work happens -- a rejected request should cost a single Postgres
    UPSERT, not a yfinance fetch.

    Raises 429 with a Retry-After header; never raises anything else, since
    rate_limit.check fails open on database trouble rather than taking the
    endpoint down with it.
    """
    result = rate_limit.check(rate_limit.client_ip(request.headers, request.client.host if request.client else None))
    if not result.allowed:
        raise HTTPException(
            status_code=429,
            detail=rate_limit.friendly_message(result),
            headers={"Retry-After": str(result.retry_after)},
        )


# The app's one data provider (yfinance), shared with the route modules via
# services/providers.py. Reached through the FinancialDataProvider interface.
provider: FinancialDataProvider = shared_provider

# Simple in-process cache of the last-fetched company per ticker, so the chat
# endpoint can attach context without the frontend having to resend the full
# payload on every message. Keyed by ticker, not by user/session -- fine
# only because /api/chat isn't reachable from the frontend UI at all right
# now (see CLAUDE.md's "AI assistant" section); if it's ever re-added, this
# needs to key by session/user instead, since the app is genuinely
# multi-user now (see "Accounts & activity tracking"), not the single-owner local tool this comment used to assume.
_last_company_by_ticker: dict[str, CompanyFinancialsResponse] = {}


@app.get("/api/health")
def health() -> dict:
    # Only the database's label ("production", "dev" or "test") -- never the
    # connection string. Lets anyone confirm which database the live site uses.
    return {"status": "ok", "database": db_module.DATABASE_LABEL}


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
    # A curated rename is not a fuzzy-search accident, so it's allowed
    # through: searching "zomato" correctly resolves to ETERNAL.NS, whose
    # name shares no text with the query, and the checks above would
    # otherwise 404 a match we deliberately configured. See
    # data_provider.FORMER_TICKERS.
    if resolves_via_former_name(q, ticker, resolved):
        return True
    return False


def _not_found(query: str) -> CompanyNotFoundError:
    return CompanyNotFoundError(
        f"Could not find '{query}' on NSE/BSE. Try the exact ticker, e.g. 'RELIANCE' or 'TCS'."
    )


@dataclass
class _Fundamentals:
    """One company's fundamentals plus the provenance the response needs.

    `as_of` is None when this was fetched live during this request (i.e.
    "just now"); it carries the cache's own timestamp otherwise. `is_stale`
    is True only in the degraded case where upstream was unreachable and we
    fell back to data past its freshness window.
    """

    symbol: str
    info: CompanyInfo
    raw: RawFinancials
    consensus: Optional[AnalystConsensus]
    source: DataSourceName
    as_of: Optional[str] = None
    is_stale: bool = False


def _refresh_price_overlay(symbol: str, raw: RawFinancials) -> RawFinancials:
    """Re-reads just the price-derived fields via the cheap fast_info call and
    writes them back as the cache's 15-minute overlay.

    Never raises: the caller already holds a usable (if older) price, and a
    failed overlay refresh must degrade to "slightly stale price," not to a
    failed request. Only fields fast_info actually returned are overridden,
    so a partial response can't blank out a good cached value.
    """
    try:
        price, market_cap = provider.get_quick_price(symbol)
    except Exception:  # noqa: BLE001 -- keep whatever price we already have
        logger.warning("Price overlay refresh failed for symbol=%s", symbol, exc_info=True)
        return raw

    update = {}
    if price is not None:
        update["current_price"] = price
    if market_cap is not None:
        update["market_cap"] = market_cap
    if not update:
        return raw

    with get_conn() as conn:
        fundamentals_cache.put_price_overlay(symbol, price, market_cap, conn=conn)
    return raw.model_copy(update=update)


def _yfinance_consensus(symbol: str) -> Optional[AnalystConsensus]:
    """Best-effort -- analyst coverage is a bonus, never core. Cached
    alongside the statements on the same 7-day clock; consensus can change
    somewhat more often than quarterly financials, so this is a deliberate
    (and disclosed) freshness compromise rather than an exact figure."""
    try:
        return provider.get_analyst_consensus(symbol)
    except Exception:  # noqa: BLE001
        logger.warning("yfinance analyst consensus failed for symbol=%s", symbol, exc_info=True)
        return None


def _serve_cached(query: str, cached, *, is_stale: bool) -> _Fundamentals:
    """Wraps a cache row as a response bundle, re-running the same
    `_looks_like_the_query` guard a live fetch gets. The guard is deterministic
    over (query, info), so a row that passed when written passes again for
    the same query -- but a DIFFERENT query that happens to resolve to this
    symbol is checked on its own merits rather than inheriting a previous
    caller's approval."""
    if not _looks_like_the_query(query, cached.info):
        raise _not_found(query)
    return _Fundamentals(
        symbol=cached.symbol,
        info=cached.info,
        raw=cached.raw,
        consensus=cached.consensus,
        source=DataSourceName.YFINANCE,
        # Deliberately the STATEMENTS timestamp, not CachedFundamentals.as_of
        # (which is the newer of the two clocks). This field answers "how old
        # are these financials?", and the price half is separately guaranteed
        # fresh by its own 15-minute TTL -- reporting the price time here
        # would make week-old statements look like they were fetched minutes
        # ago, which is precisely the kind of quietly-wrong number the rest
        # of this codebase refuses to ship.
        as_of=cached.fetched_at.isoformat(),
        is_stale=is_stale,
    )


def _fetch_company_yfinance_cached(query: str) -> _Fundamentals:
    """Cache-first fundamentals via yfinance -- the keyless default path.

    Failure ladder (see CLAUDE.md's "Sourcing" section):
      1. fresh cache hit            -> serve it, refresh only the price overlay
      2. stale hit, refetch works   -> serve fresh, rewrite cache
      3. stale hit, refetch fails   -> serve the stale row, flagged is_stale
      4. miss, fetch works          -> guard, then cache, then serve
      5. miss, fetch fails          -> raise (404/502 upstream)

    The `_looks_like_the_query` guard always runs BEFORE anything is written,
    so a bad fuzzy match can never be persisted for the next visitor.

    Database connections are opened around database work only and never held
    across a yfinance call. Holding one idle-in-transaction for the seconds
    an upstream fetch takes is fine with one user and becomes real pressure
    on Neon's pooler with many -- so the fully-cached path (the common one)
    costs a single short connection, and a miss costs two short ones with the
    network work happening between them rather than inside them.
    """
    symbol: Optional[str] = None
    cached = None
    with get_conn() as conn:
        cached_resolution = fundamentals_cache.get_resolution(query, conn=conn)
        if cached_resolution:
            symbol = cached_resolution[0]
            cached = fundamentals_cache.get_fundamentals(symbol, conn=conn)

    from_cache = symbol is not None
    if symbol is None:
        symbol, exchange = provider.resolve_symbol(query)
        with get_conn() as conn:
            fundamentals_cache.put_resolution(query, symbol, exchange, conn=conn)
            cached = fundamentals_cache.get_fundamentals(symbol, conn=conn)

    if cached is not None and cached.statements_fresh:
        result = _serve_cached(query, cached, is_stale=False)
        if not cached.price_fresh:
            # Refreshes only current_price/market_cap. `as_of` deliberately
            # still reports when the STATEMENTS were fetched -- they really
            # are up to 7 days old, and blanking it here would claim the
            # whole payload was fetched just now.
            result.raw = _refresh_price_overlay(symbol, result.raw)
        return result

    try:
        info = provider.get_company_info(symbol)
        if not _looks_like_the_query(query, info):
            raise _not_found(query)
        raw = provider.get_raw_financials(symbol)
        consensus = _yfinance_consensus(symbol)
        with get_conn() as conn:
            fundamentals_cache.put_fundamentals(symbol, "yfinance", info, raw, consensus, conn=conn)
        return _Fundamentals(
            symbol=symbol, info=info, raw=raw, consensus=consensus,
            source=DataSourceName.YFINANCE,
        )
    except CompanyNotFoundError:
        # A symbol resolved from cache can go dead (a delisting or rename --
        # e.g. ZOMATO -> ETERNAL), which would otherwise poison this query for
        # the whole RESOLUTION_TTL. Drop the mapping and re-resolve live, once.
        if from_cache:
            logger.warning("Cached resolution for query=%s -> %s went dead; re-resolving", query, symbol)
            # Deliberately does NOT invalidate the fundamentals row for
            # `symbol`: that row is the stale-serve fallback two branches
            # down, and deleting it here would destroy our own safety net
            # every time this fires for a merely transient failure. Fixing
            # the resolution mapping is enough -- if the symbol really is
            # dead, nothing points at its row anymore and it ages out on its
            # own TTL.
            fresh_symbol, _exchange = provider.resolve_symbol(query)
            with get_conn() as conn:
                fundamentals_cache.put_resolution(query, fresh_symbol, _exchange, conn=conn)
            if fresh_symbol != symbol:
                return _fetch_company_yfinance_cached(query)
        if cached is not None:
            # We successfully fetched this symbol before, so it did exist --
            # a sudden "no data" is more often a transient upstream hiccup
            # than a real delisting. Serve what we have, clearly flagged,
            # rather than a 404 for a company the user can see we know about.
            logger.warning("yfinance reported no data for symbol=%s -- serving stale cache", symbol)
            return _serve_cached(query, cached, is_stale=True)
        raise
    except DataProviderError:
        if cached is not None:
            logger.warning("yfinance unavailable for symbol=%s -- serving stale cache", symbol)
            return _serve_cached(query, cached, is_stale=True)
        raise


@app.get("/api/company/{query}", response_model=CompanyFinancialsResponse)
def get_company(
    query: str,
    _rl: None = Depends(_rate_limited),
    current_user: Optional[dict] = Depends(_current_user),
) -> CompanyFinancialsResponse:
    # yfinance backed by the shared Postgres cache (fundamentals_cache.py), so
    # one real upstream fetch serves every visitor looking at that company
    # until it goes stale -- which is what makes a free source viable without
    # the sustained request volume yfinance_provider.py warns gets an IP
    # throttled. yfinance supplies all 21 metrics for ordinary non-financial
    # companies and 12 of 21 for banks/NBFCs, where most gaps are genuinely
    # inapplicable rather than missing.
    try:
        bundle = _fetch_company_yfinance_cached(query)
    except CompanyNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
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

    info, raw = bundle.info, bundle.raw
    # Unchanged: metrics.py stays a pure function over already-fetched
    # numbers and still returns None (rendered "N/A") for anything missing,
    # whether that came from a live fetch or the cache -- the cache
    # round-trips nulls as nulls precisely so this behaviour is identical.
    metric_groups = compute_metric_groups(raw, info.company_name)
    health_snapshot = compute_health_snapshot(metric_groups)
    response = CompanyFinancialsResponse(
        info=info,
        raw=raw,
        metric_groups=metric_groups,
        health_snapshot=health_snapshot,
        analyst_consensus=bundle.consensus,
        consensus_source=bundle.source if bundle.consensus is not None else None,
        fundamentals_as_of=bundle.as_of,
        is_stale=bundle.is_stale,
    )
    _last_company_by_ticker[info.resolved_symbol] = response
    # No-op if current_user is None (anonymous search) -- see
    # auth_service.log_activity's docstring for why that's a deliberate
    # no-guard-needed call site, not an oversight.
    auth_service.log_activity(current_user, "searched", info.company_name)
    return response


def _fetch_price_points(active_symbol: str) -> tuple[list[PricePoint], list[PricePoint]]:
    points = provider.get_price_history(active_symbol)
    try:
        recent_points = provider.get_recent_price_history(active_symbol)
    except Exception:  # noqa: BLE001 -- the 1D/5D views are a bonus, not core
        logger.warning("Couldn't fetch recent price history for symbol=%s", active_symbol, exc_info=True)
        recent_points = []
    return points, recent_points


def _yfinance_price_symbol(symbol: str) -> str:
    """The yfinance-shaped symbol for a price-history request.

    `symbol` normally arrives as /api/company's suffixed `resolved_symbol`
    ("RELIANCE.NS"), which needs no lookup at all -- it returns immediately,
    touching neither the database nor the network. A bare symbol (an old
    bookmark or a hand-typed URL) would otherwise cost the two-probe .NS/.BO
    walk, so it goes through the shared resolution cache.

    Connections are opened only around the database work and deliberately
    NOT held across `resolve_symbol`'s network call -- holding a Neon
    connection idle-in-transaction for seconds is exactly the pattern flagged
    as a scaling concern on /api/company.
    """
    if symbol.endswith((".NS", ".BO")):
        return symbol

    with get_conn() as conn:
        cached = fundamentals_cache.get_resolution(symbol, conn=conn)
    if cached:
        return cached[0]

    resolved, exchange = provider.resolve_symbol(symbol)
    with get_conn() as conn:
        fundamentals_cache.put_resolution(symbol, resolved, exchange, conn=conn)
    return resolved


@app.get("/api/price-history/{symbol}", response_model=PriceHistoryResponse)
def get_price_history(
    symbol: str,
    _rl: None = Depends(_rate_limited),
) -> PriceHistoryResponse:
    # A single yfinance call returns a clean ~5-year weekly series; the
    # shared cache (6-hour TTL) keeps that to one upstream call per symbol.
    resolved = symbol.strip().upper()
    recent_points: list[PricePoint] = []
    history_as_of: Optional[str] = None
    is_stale = False

    try:
        active_symbol = _yfinance_price_symbol(resolved)
        with get_conn() as conn:
            cached_history = fundamentals_cache.get_price_history(active_symbol, conn=conn)

        if cached_history is not None and cached_history.is_fresh:
            points = cached_history.points
            recent_points = cached_history.recent_points
            history_as_of = cached_history.fetched_at.isoformat()
        else:
            try:
                points, recent_points = _fetch_price_points(active_symbol)
                with get_conn() as conn:
                    fundamentals_cache.put_price_history(active_symbol, points, recent_points, conn=conn)
            except (CompanyNotFoundError, DataProviderError):
                # Same degradation ladder as /api/company: a stale chart beats
                # no chart when upstream is unreachable. Only raise when
                # there's genuinely nothing cached to fall back on.
                if cached_history is None:
                    raise
                logger.warning(
                    "yfinance price history unavailable for symbol=%s -- serving stale cache", active_symbol
                )
                points = cached_history.points
                recent_points = cached_history.recent_points
                history_as_of = cached_history.fetched_at.isoformat()
                is_stale = True
    except CompanyNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
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
        active_source=DataSourceName.YFINANCE,
        history_as_of=history_as_of,
        is_stale=is_stale,
    )


_TRADING_RANGES = ("1D", "1W", "1M", "3M", "1Y", "5Y")


# ---------- Paper Trading ----------
# Portfolio state itself (cash/holdings/transactions) is intentionally never
# sent here at all -- it's held entirely client-side (localStorage, see
# frontend/src/lib/portfolio.ts), so there's nothing for these endpoints to
# persist. They use the same module-level `provider` as everything else.


@app.get("/api/trading/search/{query}", response_model=TradingSymbolInfo)
def trading_search(query: str) -> TradingSymbolInfo:
    """Resolves a company name/ticker for Paper Trading's own stock picker --
    intentionally lighter than /api/company (no financial statements, no
    metric computation): just enough to identify what was picked. Reuses
    resolve_symbol/get_company_info (already on YFinanceProvider) and the
    same _looks_like_the_query guard /api/company uses, rather than
    inventing a second symbol-matching path."""
    try:
        symbol, _exchange = provider.resolve_symbol(query)
        info = provider.get_company_info(symbol)
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
        return provider.get_live_quote(symbol)
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
        points = provider.get_intraday_history(symbol, range_key)
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


# Deliberately always returns the exact same body regardless of whether the
# email has an account, is Google-only, or the reset email genuinely failed
# to send -- see auth_service.request_password_reset's docstring for why
# branching on any of that client-visibly turns this into an
# email-enumeration oracle. A send failure is logged server-side
# (gmail_service.py) and swallowed here, not surfaced to the caller.
@app.post("/api/auth/forgot-password")
def forgot_password(request: ForgotPasswordRequest, http_request: Request) -> dict:
    result = auth_service.request_password_reset(request.email)
    if result:
        name, token = result
        # Same-origin deployment (see CLAUDE.md's "Deployment" section) --
        # the request's own Origin header is always this app's real
        # frontend URL, in both local dev and production, so there's no
        # separate FRONTEND_BASE_URL to configure/keep in sync.
        origin = http_request.headers.get("origin") or str(http_request.base_url).rstrip("/")
        reset_link = f"{origin}/?reset_token={token}"
        try:
            gmail_service.send_password_reset_email(request.email, name, reset_link)
        except gmail_service.EmailSendError:
            pass  # already logged server-side in gmail_service.py
    return {"status": "ok", "message": "If an account exists for that email, a reset link has been sent."}


@app.post("/api/auth/reset-password")
def reset_password_endpoint(request: ResetPasswordRequest) -> dict:
    try:
        auth_service.reset_password(request.token, request.new_password)
    except AuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok"}


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

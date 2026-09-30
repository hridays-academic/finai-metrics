"""
Pydantic schemas shared across the API layer. Route handlers should only
ever accept/return these shapes -- never raw yfinance objects or dicts.
"""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class RawFinancials(BaseModel):
    """Financial statement line items, as reported (most recent fiscal year/TTM).

    Any field can be None -- the data provider may not have every line item
    for every company. Downstream metric calculations must handle missing
    inputs by returning an "unavailable" metric rather than guessing.
    """

    currency: str = "INR"

    # Income statement
    revenue: Optional[float] = None
    gross_profit: Optional[float] = None
    operating_income: Optional[float] = None
    net_income: Optional[float] = None
    ebit: Optional[float] = None
    interest_expense: Optional[float] = None

    # Balance sheet
    total_assets: Optional[float] = None
    total_liabilities: Optional[float] = None
    total_equity: Optional[float] = None
    current_assets: Optional[float] = None
    current_liabilities: Optional[float] = None
    cash_and_equivalents: Optional[float] = None
    inventory: Optional[float] = None
    receivables: Optional[float] = None
    total_debt: Optional[float] = None

    # Optional direct figure for ROCE's denominator (Total Assets - Current
    # Liabilities). Only needed when a provider can't supply current
    # liabilities separately but does report/imply capital employed some
    # other way. Most providers leave this
    # unset and let metrics.py derive it from total_assets/current_liabilities.
    capital_employed: Optional[float] = None

    # Market / share data
    market_cap: Optional[float] = None
    current_price: Optional[float] = None
    shares_outstanding: Optional[float] = None
    eps: Optional[float] = None
    book_value_per_share: Optional[float] = None
    dividends_per_share: Optional[float] = None

    # Prior-year balances, used for average-based ratios (ROA, turnover, etc.)
    prior_total_assets: Optional[float] = None
    prior_total_equity: Optional[float] = None
    prior_inventory: Optional[float] = None
    prior_receivables: Optional[float] = None


class CompanyInfo(BaseModel):
    ticker: str
    resolved_symbol: str  # the yfinance symbol actually queried, e.g. RELIANCE.NS
    exchange: str  # "NSE" | "BSE" | "unknown"
    company_name: str
    sector: Optional[str] = None
    industry: Optional[str] = None


class MetricStatus(str, Enum):
    GOOD = "good"
    WARNING = "warning"
    BAD = "bad"
    NEUTRAL = "neutral"  # no conventional benchmark, or benchmark not applicable


class DataSourceName(str, Enum):
    """Which provider served a given piece of data. yfinance is the only one
    (Tapetide was removed 2026-09); kept as an enum so a future provider is
    an additive change. Bharat-SM-Data is deliberately not a member: it's
    been unwired since Tickertape IP-blocked the app's Vercel deployment."""

    YFINANCE = "yfinance"


class Metric(BaseModel):
    key: str
    label: str
    value: Optional[float] = None
    unit: str = ""  # "%", "x", "INR", "" (ratio/dimensionless)
    status: MetricStatus = MetricStatus.NEUTRAL
    benchmark_note: str = ""  # short human-readable note on the healthy range
    formula: str = ""  # short human-readable formula
    definition: str = ""  # plain-English explanation of what the metric measures
    assessment: str = ""  # value-aware "is this company's number good or bad, and why"


class MetricGroup(BaseModel):
    key: str
    label: str
    metrics: list[Metric]


class HealthSnapshot(BaseModel):
    """A single glanceable "how healthy are this company's fundamentals"
    verdict, aggregated from the computed metric statuses. Deliberately
    stops at describing the ratios -- never buy/sell/hold language, which
    would cross from financial education into investment advice."""

    verdict: str  # "Strong Fundamentals" | "Mixed Fundamentals" | "Weak Fundamentals" | "Not Enough Data"
    explanation: str
    good_count: int
    warning_count: int
    bad_count: int
    total_count: int


class AnalystConsensus(BaseModel):
    """Third-party sell-side analyst opinion, aggregated and reported as-is --
    this is NOT Stackly's own view, and must always be displayed with
    that attribution. See CLAUDE.md for why this is a meaningfully different
    (and acceptable) thing from the app generating its own buy/sell/hold call."""

    buy: int
    hold: int
    sell: int
    total: int
    buy_pct: float
    hold_pct: float
    sell_pct: float
    consensus_label: str  # "Buy" | "Hold" | "Sell" -- whichever bucket has the most analysts

    target_low: Optional[float] = None
    target_mean: Optional[float] = None
    target_high: Optional[float] = None
    target_period: Optional[str] = None  # e.g. "FY2027 (period ending Mar 2027)"
    target_date: Optional[str] = None  # same period, as "YYYY-MM-DD" (last day of the month) for charting


class CompanyFinancialsResponse(BaseModel):
    info: CompanyInfo
    raw: RawFinancials
    metric_groups: list[MetricGroup]
    health_snapshot: HealthSnapshot
    analyst_consensus: Optional[AnalystConsensus] = None
    # Which source served analyst_consensus -- None if unavailable.
    consensus_source: Optional[DataSourceName] = None
    # (2026-09) When the fundamentals in this response were actually fetched
    # upstream, ISO 8601. Set only when they came from the shared Postgres
    # cache (see fundamentals_cache.py) -- None means they were fetched live
    # during this request, i.e. "just now". Additive with a default, so any
    # client that doesn't know about it is unaffected.
    fundamentals_as_of: Optional[str] = None
    # True when the upstream provider couldn't be reached and this response
    # is being served from cached data that is past its freshness window
    # (see fundamentals_cache.STATEMENTS_TTL). Serving something real and
    # labelled beats erroring out, but the staleness is reported rather than
    # hidden -- the same honesty rule LiveQuote.is_delayed follows.
    is_stale: bool = False


class PricePoint(BaseModel):
    date: str  # "YYYY-MM-DD"
    open: float
    high: float
    low: float
    close: float
    volume: Optional[float] = None


class PriceHistoryResponse(BaseModel):
    symbol: str
    currency: str = "INR"
    points: list[PricePoint]  # oldest first, ~5yr weekly -- powers the 1Y/3Y/5Y views
    recent_points: list[PricePoint] = []  # oldest first, ~6-7mo daily -- powers the 1D/5D views
    active_source: DataSourceName = DataSourceName.YFINANCE  # which source served this price data
    # (2026-09) Same meaning as CompanyFinancialsResponse's pair: when this
    # series was actually fetched upstream (None = fetched live during this
    # request), and whether it's being served past its freshness window
    # because upstream was unreachable. Additive with defaults.
    history_as_of: Optional[str] = None
    is_stale: bool = False


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    history: list[ChatMessage] = Field(default_factory=list, max_length=20)
    ticker: Optional[str] = None  # if set, backend re-attaches company context


class ChatResponse(BaseModel):
    reply: str


class SignUpRequest(BaseModel):
    email: str
    name: str
    password: str = Field(..., min_length=8, max_length=200)


class LogInRequest(BaseModel):
    email: str
    password: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(..., min_length=8, max_length=200)


class UserPublic(BaseModel):
    """Never includes password_hash/password_salt -- those never leave
    auth_service.py's DB layer. `has_password` is False for a Google-only
    account (see login_with_google)."""

    id: int
    email: str
    name: str
    created_at: str
    has_password: bool
    # Results League identity (all None until the user sets them on their
    # first league action). guardian_consent_status: not_required | pending |
    # granted -- see league_service.forecast_eligibility.
    handle: Optional[str] = None
    age_band: Optional[str] = None
    guardian_consent_status: Optional[str] = None
    school_name: Optional[str] = None
    is_admin: bool = False


class AuthResponse(BaseModel):
    token: str
    user: UserPublic


class GoogleAuthRequest(BaseModel):
    # The ID token JWT from Google Identity Services' credential callback
    # (see frontend/src/lib/googleAuth.ts) -- main.py verifies it against
    # GOOGLE_CLIENT_ID before trusting anything inside it.
    credential: str


class LiveQuote(BaseModel):
    """Powers Paper Trading's polling price ticker. Deliberately its own
    lightweight shape (not RawFinancials/PriceHistoryResponse) -- a poll
    target that fires every few seconds should never carry the weight of a
    full fundamentals/history fetch. `is_delayed`/`source` are surfaced
    explicitly rather than assumed, so the frontend can label the data
    honestly (and so a future real-time provider just flips `is_delayed` to
    False and `source` to whatever it's called, with no frontend change
    needed elsewhere -- see YFinanceProvider.get_live_quote's docstring)."""

    symbol: str
    price: float
    previous_close: Optional[float] = None
    change: Optional[float] = None
    change_pct: Optional[float] = None
    currency: str = "INR"
    is_delayed: bool = True
    source: str = "yfinance"
    as_of: str  # ISO 8601 timestamp, when this quote was fetched (not exchange-reported time)


class IntradayHistoryResponse(BaseModel):
    """Backs Paper Trading's chart -- a distinct shape from
    PriceHistoryResponse because the range set (1D/1W/1M/3M/1Y/5Y) and
    underlying granularity (intraday minute/hour bars for the short ranges)
    are both genuinely different from the main dashboard's weekly/daily
    split. Reuses the same PricePoint shape either way."""

    symbol: str
    range: str  # "1D" | "1W" | "1M" | "3M" | "1Y" | "5Y", echoed back
    currency: str = "INR"
    points: list[PricePoint]
    is_delayed: bool = True
    source: str = "yfinance"


class TradingSymbolInfo(BaseModel):
    """Resolved-symbol result for Paper Trading's own stock picker --
    intentionally smaller than CompanyInfo (no sector/industry) since this
    is just enough to identify what was picked and label the UI."""

    ticker: str
    resolved_symbol: str
    exchange: str
    company_name: str
    currency: str = "INR"


class ActivityEntry(BaseModel):
    action: str  # "signed_up" | "logged_in" | "searched" | "calculator_stock_picked"
    detail: Optional[str] = None  # e.g. the ticker, for search/calculator actions
    created_at: str


class ActivityResponse(BaseModel):
    entries: list[ActivityEntry]

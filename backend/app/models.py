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
    # other way -- see e.g. TapetideProvider. Most providers leave this
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
    """Which provider served a given piece of data -- Tapetide (primary) or
    yfinance (its fallback on Tapetide quota exhaustion). See CLAUDE.md's
    "Sourcing" section: fundamentals moved back to Tapetide (2026-07) after
    Tickertape/Bharat-SM-Data turned out to be IP-blocked from the app's
    Vercel deployment."""

    TAPETIDE = "tapetide"
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
    # Which source served analyst_consensus (Tapetide or its yfinance
    # fallback) -- None if it was never attempted/unavailable. info/raw are
    # NOT reported here since they always come from Bharat-SM-Data now.
    consensus_source: Optional[DataSourceName] = None
    # ISO 8601 timestamp for when Tapetide's daily quota is expected to
    # reset -- the next local midnight IST, per Tapetide's documented daily
    # reset cadence (not dependent on having actually seen a quota-exceeded
    # message first).
    tapetide_reset_at: Optional[str] = None


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
    active_source: DataSourceName = DataSourceName.TAPETIDE  # which source served this price data
    tapetide_reset_at: Optional[str] = None  # see CompanyFinancialsResponse.tapetide_reset_at


class QuotaStatus(BaseModel):
    """Powers the "searches remaining today" counter next to the search bar.
    A local estimate (see TapetideProvider.get_quota_status) -- we have no
    way to read Tapetide's own server-side counter directly."""

    tapetide_calls_used_today: int
    tapetide_calls_remaining_estimate: int
    tapetide_calls_per_search: int  # recount from main.py's actual call sites if this drifts
    tapetide_searches_remaining_estimate: int
    tapetide_reset_at: str  # next local midnight IST


class RecommendedCompany(BaseModel):
    """A homepage suggestion, shown before any search. `verdict`/`explanation`
    are the company's REAL, freshly-computed HealthSnapshot (same function
    that powers a real search's verdict box) -- never a fabricated or
    hand-picked "this one's good" label. Sourced from Bharat-SM-Data
    specifically so loading the homepage costs zero Tapetide quota (see
    main.py's `get_recommendations`) -- unlike a real search, which sources
    fundamentals from Tapetide now (see CLAUDE.md's "Sourcing" section).
    Bharat-SM-Data is currently IP-blocked from this app's Vercel
    deployment, so this endpoint is a known, unresolved gap (see CLAUDE.md)
    -- clicking through to view the company still costs the same Tapetide/
    yfinance calls a normal search would; this endpoint only supplies the
    badge."""

    ticker: str
    name: str
    sector: Optional[str] = None
    verdict: MetricStatus  # "good" | "warning" | "bad" -- "neutral" is never used here
    explanation: str


class RecommendationsResponse(BaseModel):
    date: str  # "YYYY-MM-DD" -- the day this set was computed/rotated for
    companies: list[RecommendedCompany]


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


class UserPublic(BaseModel):
    """Never includes password_hash/password_salt -- those never leave
    auth_service.py's DB layer. `tapetide_key` is the account's saved
    Tapetide key, decrypted and ready to use (None if this account never
    saved one) -- see auth_service.py's get_tapetide_key. Sending the
    decrypted key back to its own owner is fine: anyone with a valid
    session token for this account already has the same trust level.
    `has_password` is False for a Google-only account (see
    login_with_google) -- SettingsPanel.tsx uses it to skip the password-
    verification step before reconfiguring a saved Tapetide key, since
    that check would otherwise always fail for an account with no password
    to verify."""

    id: int
    email: str
    name: str
    created_at: str
    has_password: bool
    tapetide_key: Optional[str] = None


class AuthResponse(BaseModel):
    token: str
    user: UserPublic


class TapetideKeyRequest(BaseModel):
    key: str


class GoogleAuthRequest(BaseModel):
    # The ID token JWT from Google Identity Services' credential callback
    # (see frontend/src/lib/googleAuth.ts) -- main.py verifies it against
    # GOOGLE_CLIENT_ID before trusting anything inside it.
    credential: str


class ActivityEntry(BaseModel):
    action: str  # "signed_up" | "logged_in" | "searched" | "calculator_stock_picked"
    detail: Optional[str] = None  # e.g. the ticker, for search/calculator actions
    created_at: str


class ActivityResponse(BaseModel):
    entries: list[ActivityEntry]

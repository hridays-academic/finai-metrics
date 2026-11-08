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


class FinancialYear(BaseModel):
    """One fiscal year's statement lines, as Yahoo reports them (consolidated).

    Every field can be None. capital_expenditure and dividends_paid are
    stored as positive spends (Yahoo reports cash outflows as negatives).
    cash_and_short_term_investments includes liquid investments such as
    mutual-fund holdings, which Indian companies park a lot of cash in."""

    period_end_date: str  # "YYYY-MM-DD"
    revenue: Optional[float] = None
    operating_income: Optional[float] = None
    depreciation: Optional[float] = None
    net_income: Optional[float] = None
    eps_diluted: Optional[float] = None
    pretax_income: Optional[float] = None
    tax_provision: Optional[float] = None
    total_assets: Optional[float] = None
    total_equity: Optional[float] = None
    total_debt: Optional[float] = None
    cash_and_short_term_investments: Optional[float] = None
    receivables: Optional[float] = None
    # Yahoo's "Other Receivables". Large next to receivables usually means
    # Yahoo moved part of the company's trade receivables (e.g. unbilled
    # revenue) here; metrics.py then shows debtor days as N/A.
    other_receivables: Optional[float] = None
    inventory: Optional[float] = None
    payables: Optional[float] = None
    operating_cash_flow: Optional[float] = None
    capital_expenditure: Optional[float] = None
    free_cash_flow: Optional[float] = None
    dividends_paid: Optional[float] = None


class FinancialQuarter(BaseModel):
    period_end_date: str
    revenue: Optional[float] = None
    operating_income: Optional[float] = None
    depreciation: Optional[float] = None
    net_income: Optional[float] = None


class FinancialHistory(BaseModel):
    """Years and quarters newest first, only the periods Yahoo returned
    (never padded or filled; see metrics.history_table for the display)."""

    annual: list[FinancialYear] = Field(default_factory=list)
    quarterly: list[FinancialQuarter] = Field(default_factory=list)


class HistoryRow(BaseModel):
    """One column of the Research page's history tables. All None when Yahoo
    has nothing for that period."""

    period_end_date: str
    revenue: Optional[float] = None
    ebitda: Optional[float] = None
    ebitda_margin_pct: Optional[float] = None
    net_income: Optional[float] = None


class HistoryTable(BaseModel):
    annual: list[HistoryRow]  # five fiscal years, newest first
    quarterly: list[HistoryRow]  # eight quarter-ends, newest first


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


class MetricPart(BaseModel):
    """A component shown inside a tile, e.g. the three DuPont factors."""

    label: str
    value: Optional[float] = None
    unit: str = ""


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
    parts: Optional[list[MetricPart]] = None


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
    # (2026-11) The date of the share price behind the valuation ratios and
    # raw.current_price/market_cap -- always at least 30 days old (see
    # services/price_lag.py). None when no old-enough price was available,
    # in which case those fields are None too.
    price_as_of: Optional[str] = None
    # (2026-11) Five fiscal years and eight quarters for the Research page's
    # tables, padded with empty rows where Yahoo has nothing. None when the
    # history couldn't be fetched (e.g. an old cache row served stale).
    history: Optional[HistoryTable] = None
    # The fiscal year the ratios are computed from ("YYYY-MM-DD").
    ratios_period_end: Optional[str] = None


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
    recent_points: list[PricePoint] = []  # oldest first, ~6-7mo daily -- its last point ends every chart period
    active_source: DataSourceName = DataSourceName.YFINANCE  # which source served this price data
    # (2026-09) Same meaning as CompanyFinancialsResponse's pair: when this
    # series was actually fetched upstream (None = fetched live during this
    # request), and whether it's being served past its freshness window
    # because upstream was unreachable. Additive with defaults.
    history_as_of: Optional[str] = None
    is_stale: bool = False
    # (2026-11) Date of the newest close in this response; every point is at
    # least 30 days old (see services/price_lag.py).
    price_as_of: Optional[str] = None


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
    email: str = Field(..., max_length=254)
    name: str = Field(..., max_length=100)
    password: str = Field(..., min_length=8, max_length=200)
    # The required "I agree to the Terms and Privacy Policy" checkbox.
    accept_terms: bool = False


class LogInRequest(BaseModel):
    email: str = Field(..., max_length=254)
    password: str = Field(..., max_length=200)


class ForgotPasswordRequest(BaseModel):
    email: str = Field(..., max_length=254)


class DeleteAccountRequest(BaseModel):
    # Must be exactly "DELETE" -- the Settings panel's typed confirmation.
    confirm: str


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
    # When this user agreed to the Terms/Privacy Policy; needs_terms is True
    # until they agree to the current version (auth_service.TERMS_VERSION).
    terms_accepted_at: Optional[str] = None
    needs_terms: bool = False


class AuthResponse(BaseModel):
    token: str
    user: UserPublic


class GoogleAuthRequest(BaseModel):
    # The ID token JWT from Google Identity Services' credential callback
    # (see frontend/src/lib/googleAuth.ts) -- main.py verifies it against
    # GOOGLE_CLIENT_ID before trusting anything inside it.
    credential: str
    # Only matters when this Google account is new: the sign-up checkbox.
    accept_terms: bool = False


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

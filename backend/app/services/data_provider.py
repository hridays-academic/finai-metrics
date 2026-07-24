"""
Abstract interface for a financial data provider.

Why this exists: free Indian-market data sources are unreliable (see
CLAUDE.md). yfinance is wired up today as `YFinanceProvider`, but if it
proves too flaky for a given use case, implement this same interface against
Alpha Vantage / Financial Modeling Prep / a paid source, and swap the single
instantiation in app/main.py. No other file should import yfinance directly.
"""
from abc import ABC, abstractmethod
from typing import Optional

from app.models import AnalystConsensus, CompanyInfo, PricePoint, RawFinancials


class CompanyNotFoundError(Exception):
    """Raised when the ticker/company cannot be resolved to any data."""


class DataProviderError(Exception):
    """Raised for provider-side failures (rate limit, upstream outage, etc)."""


class ProviderQuotaExceededError(DataProviderError):
    """Raised specifically when a provider's call quota is exhausted (as
    opposed to a transient outage or bad request) -- callers can catch this
    distinctly to trigger a fallback to a different provider rather than
    just surfacing a 502."""


class FinancialDataProvider(ABC):
    @abstractmethod
    def resolve_symbol(self, query: str) -> tuple[str, str]:
        """Resolve a user-entered company name or ticker to (symbol, exchange).

        `symbol` is the provider-specific identifier to fetch with (e.g.
        "RELIANCE.NS"). `exchange` is a human-readable label ("NSE"/"BSE").
        Raises CompanyNotFoundError if nothing plausible matches.
        """

    @abstractmethod
    def get_company_info(self, symbol: str) -> CompanyInfo:
        """Fetch descriptive info (name, sector, industry) for a resolved symbol."""

    @abstractmethod
    def get_raw_financials(self, symbol: str) -> RawFinancials:
        """Fetch the raw financial statement + market data line items."""

    @abstractmethod
    def get_price_history(self, symbol: str) -> list[PricePoint]:
        """Fetch ~5 years of weekly OHLCV price history, oldest first -- powers
        the chart's 1Y/3Y/5Y views."""

    @abstractmethod
    def get_recent_price_history(self, symbol: str) -> list[PricePoint]:
        """Fetch a shorter daily-resolution OHLCV window, oldest first -- powers
        the chart's 1D/5D views, where weekly points would be too sparse to
        show anything."""

    @abstractmethod
    def get_analyst_consensus(self, symbol: str) -> Optional[AnalystConsensus]:
        """Fetch third-party sell-side analyst consensus (buy/hold/sell counts,
        target price range), if the provider/company has any coverage.
        Returns None rather than a fabricated/zeroed result when unavailable."""

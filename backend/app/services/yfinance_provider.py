"""
Alternate `FinancialDataProvider` implementation, backed by yfinance.

Kept as a reference implementation of the provider abstraction (see
app/services/data_provider.py) -- `TapetideProvider` is the active default
(wired in app/main.py) because Yahoo Finance's undocumented crumb/rate-limit
gate on its quoteSummary endpoint proved too unreliable in practice for this
app's use case. To reactivate this provider: add `yfinance` (and optionally
`curl_cffi`, which helps yfinance get past Yahoo's bot detection) back to
requirements.txt, `pip install` them, and swap the instantiation in main.py.

yfinance is free and requires no API key, which makes it a good proof-of-
concept source, but it scrapes Yahoo Finance rather than using an official
API: expect occasional missing fields for Indian tickers, stale data, or
transient failures (Yahoo has no documented, guaranteed rate limit -- in
practice, keep request volume modest, e.g. comfortably under ~1-2 requests/
second sustained, or you risk temporary IP throttling). None of that is
handled by retry logic here on purpose -- a failed/missing field should
surface to the user as "unavailable," not be silently retried or guessed.
"""
from datetime import datetime, timedelta
from typing import Optional

import pandas as pd
import yfinance as yf

from app.models import AnalystConsensus, CompanyInfo, PricePoint, RawFinancials
from app.services.data_provider import (
    CompanyNotFoundError,
    DataProviderError,
    FinancialDataProvider,
)

# Small best-effort lookup so users can type a common company name instead of
# a ticker. Not exhaustive by design -- an explicit "TICKER.NS" / "TICKER.BO"
# always works as a fallback, see resolve_symbol().
_NAME_TO_SYMBOL: dict[str, str] = {
    "reliance": "RELIANCE.NS",
    "reliance industries": "RELIANCE.NS",
    "tcs": "TCS.NS",
    "tata consultancy services": "TCS.NS",
    "infosys": "INFY.NS",
    "hdfc bank": "HDFCBANK.NS",
    "icici bank": "ICICIBANK.NS",
    "state bank of india": "SBIN.NS",
    "sbi": "SBIN.NS",
    "hindustan unilever": "HINDUNILVR.NS",
    "hul": "HINDUNILVR.NS",
    "bharti airtel": "BHARTIARTL.NS",
    "airtel": "BHARTIARTL.NS",
    "itc": "ITC.NS",
    "larsen": "LT.NS",
    "larsen & toubro": "LT.NS",
    "larsen and toubro": "LT.NS",
    "l&t": "LT.NS",
    "kotak mahindra bank": "KOTAKBANK.NS",
    "kotak bank": "KOTAKBANK.NS",
    "axis bank": "AXISBANK.NS",
    "maruti suzuki": "MARUTI.NS",
    "maruti": "MARUTI.NS",
    "asian paints": "ASIANPAINT.NS",
    "wipro": "WIPRO.NS",
    "adani enterprises": "ADANIENT.NS",
    "tata motors": "TATAMOTORS.NS",
    "tata steel": "TATASTEEL.NS",
    "sun pharma": "SUNPHARMA.NS",
    "sun pharmaceutical": "SUNPHARMA.NS",
    "bajaj finance": "BAJFINANCE.NS",
    "titan": "TITAN.NS",
    "titan company": "TITAN.NS",
    "ntpc": "NTPC.NS",
    "power grid": "POWERGRID.NS",
    "ultratech cement": "ULTRACEMCO.NS",
    "nestle india": "NESTLEIND.NS",
    "nestle": "NESTLEIND.NS",
    "hcl technologies": "HCLTECH.NS",
    "hcl tech": "HCLTECH.NS",
    "zomato": "ZOMATO.NS",
    "paytm": "PAYTM.NS",
    "adani ports": "ADANIPORTS.NS",
    "jsw steel": "JSWSTEEL.NS",
    "mahindra": "M&M.NS",
    "mahindra and mahindra": "M&M.NS",
    "coal india": "COALINDIA.NS",
    "ongc": "ONGC.NS",
}


def _row(df: Optional[pd.DataFrame], *names: str, col: int = 0) -> Optional[float]:
    """Look up the most recent (col=0) or prior-period (col=1) value for the
    first matching row label -- yfinance's exact label wording drifts across
    versions and statement templates, so we try several aliases."""
    if df is None or df.empty:
        return None
    for name in names:
        if name not in df.index:
            continue
        try:
            value = df.loc[name].iloc[col]
        except (IndexError, KeyError):
            continue
        if value is None or pd.isna(value):
            continue
        return float(value)
    return None


class YFinanceProvider(FinancialDataProvider):
    """Default data provider. Free, no API key required -- see module docstring
    for the accuracy/availability tradeoffs that come with that."""

    def resolve_symbol(self, query: str) -> tuple[str, str]:
        q = query.strip()
        if not q:
            raise CompanyNotFoundError("Please enter a company name or ticker.")

        upper = q.upper()
        if upper.endswith(".NS"):
            return upper, "NSE"
        if upper.endswith(".BO"):
            return upper, "BSE"

        mapped = _NAME_TO_SYMBOL.get(q.lower())
        if mapped:
            return mapped, "NSE" if mapped.endswith(".NS") else "BSE"

        # Fall back to treating the input as a bare ticker on NSE, then BSE.
        for suffix, exchange in ((".NS", "NSE"), (".BO", "BSE")):
            candidate = f"{upper}{suffix}"
            if self._symbol_has_data(candidate):
                return candidate, exchange

        raise CompanyNotFoundError(
            f"Could not find '{query}' on NSE or BSE. Try the exact ticker "
            "with a .NS or .BO suffix, e.g. 'RELIANCE.NS'."
        )

    def _symbol_has_data(self, symbol: str) -> bool:
        try:
            fast_info = yf.Ticker(symbol).fast_info
            return fast_info.get("lastPrice") is not None
        except Exception:
            return False

    def get_company_info(self, symbol: str) -> CompanyInfo:
        try:
            info = yf.Ticker(symbol).info
        except Exception as exc:
            raise DataProviderError(
                f"Couldn't reach the data provider for '{symbol}'. It may be "
                "rate-limited or temporarily down -- please try again shortly."
            ) from exc

        has_price = info and (
            info.get("regularMarketPrice") is not None or info.get("currentPrice") is not None
        )
        if not has_price:
            raise CompanyNotFoundError(f"No data available for '{symbol}'.")

        exchange = "NSE" if symbol.endswith(".NS") else "BSE" if symbol.endswith(".BO") else "unknown"
        return CompanyInfo(
            ticker=symbol,
            resolved_symbol=symbol,
            exchange=exchange,
            company_name=info.get("longName") or info.get("shortName") or symbol,
            sector=info.get("sector"),
            industry=info.get("industry"),
        )

    def get_raw_financials(self, symbol: str) -> RawFinancials:
        ticker = yf.Ticker(symbol)
        try:
            info = ticker.info or {}
            income = ticker.financials
            balance = ticker.balance_sheet
        except Exception as exc:
            raise DataProviderError(
                f"Couldn't fetch financials for '{symbol}'. The data provider "
                "may be rate-limited or temporarily down -- please try again shortly."
            ) from exc

        return RawFinancials(
            currency=info.get("financialCurrency") or "INR",
            # Income statement
            revenue=_row(income, "Total Revenue", "Operating Revenue"),
            gross_profit=_row(income, "Gross Profit"),
            operating_income=_row(income, "Operating Income"),
            net_income=_row(income, "Net Income", "Net Income Common Stockholders"),
            ebit=_row(income, "EBIT"),
            interest_expense=_row(income, "Interest Expense"),
            # Balance sheet
            total_assets=_row(balance, "Total Assets"),
            total_liabilities=_row(
                balance, "Total Liabilities Net Minority Interest", "Total Liab"
            ),
            total_equity=_row(
                balance,
                "Total Equity Gross Minority Interest",
                "Stockholders Equity",
                "Total Stockholder Equity",
            ),
            current_assets=_row(balance, "Current Assets"),
            current_liabilities=_row(balance, "Current Liabilities"),
            cash_and_equivalents=_row(
                balance,
                "Cash And Cash Equivalents",
                "Cash Cash Equivalents And Short Term Investments",
            ),
            inventory=_row(balance, "Inventory"),
            receivables=_row(balance, "Receivables", "Accounts Receivable"),
            total_debt=_row(balance, "Total Debt"),
            # Market / share data
            market_cap=info.get("marketCap"),
            current_price=info.get("currentPrice") or info.get("regularMarketPrice"),
            shares_outstanding=info.get("sharesOutstanding"),
            eps=info.get("trailingEps"),
            book_value_per_share=info.get("bookValue"),
            dividends_per_share=info.get("trailingAnnualDividendRate"),
            # Prior period, for average-balance ratios
            prior_total_assets=_row(balance, "Total Assets", col=1),
            prior_total_equity=_row(
                balance,
                "Total Equity Gross Minority Interest",
                "Stockholders Equity",
                "Total Stockholder Equity",
                col=1,
            ),
            prior_inventory=_row(balance, "Inventory", col=1),
            prior_receivables=_row(balance, "Receivables", "Accounts Receivable", col=1),
        )

    def get_price_history(self, symbol: str) -> list[PricePoint]:
        # Weekly (not daily) to match TapetideProvider's granularity -- see
        # its get_price_history docstring for why weekly is the deliberate
        # choice for a 5-year chart, not just a workaround for a size cap
        # yfinance doesn't even have.
        try:
            hist = yf.Ticker(symbol).history(period="5y", interval="1wk")
        except Exception as exc:
            raise DataProviderError(f"Couldn't fetch price history for '{symbol}': {exc}") from exc
        return _history_to_points(hist)

    def get_recent_price_history(self, symbol: str) -> list[PricePoint]:
        # Daily resolution, for the chart's 1D/5D views -- see
        # TapetideProvider.get_recent_price_history for why this is a
        # separate fetch rather than just slicing the weekly series.
        try:
            hist = yf.Ticker(symbol).history(period="6mo", interval="1d")
        except Exception as exc:
            raise DataProviderError(f"Couldn't fetch recent price history for '{symbol}': {exc}") from exc
        return _history_to_points(hist)

    def get_analyst_consensus(self, symbol: str) -> Optional[AnalystConsensus]:
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info or {}
            recs = ticker.recommendations
        except Exception:
            return None

        buy = hold = sell = 0
        if recs is not None and not recs.empty and "period" in recs.columns:
            current = recs[recs["period"] == "0m"]
            if not current.empty:
                row = current.iloc[0]
                buy = int(row.get("strongBuy", 0) or 0) + int(row.get("buy", 0) or 0)
                hold = int(row.get("hold", 0) or 0)
                sell = int(row.get("sell", 0) or 0) + int(row.get("strongSell", 0) or 0)
        total = buy + hold + sell

        target_low = info.get("targetLowPrice")
        target_mean = info.get("targetMeanPrice")
        target_high = info.get("targetHighPrice")

        if total == 0 and target_mean is None:
            return None

        if total > 0:
            buy_pct = round(buy / total * 100, 1)
            hold_pct = round(hold / total * 100, 1)
            sell_pct = round(sell / total * 100, 1)
            consensus_label = max([("Buy", buy), ("Hold", hold), ("Sell", sell)], key=lambda p: p[1])[0]
        else:
            buy_pct = hold_pct = sell_pct = 0.0
            consensus_label = "No Rating Coverage"

        target_date = None
        if target_mean is not None:
            target_date = (datetime.now() + timedelta(days=365)).strftime("%Y-%m-%d")

        return AnalystConsensus(
            buy=buy, hold=hold, sell=sell, total=total,
            buy_pct=buy_pct, hold_pct=hold_pct, sell_pct=sell_pct,
            consensus_label=consensus_label,
            target_low=target_low, target_mean=target_mean, target_high=target_high,
            target_period="Next 12 months" if target_mean is not None else None,
            target_date=target_date,
        )


def _history_to_points(hist: pd.DataFrame) -> list[PricePoint]:
    points: list[PricePoint] = []
    for index, row in hist.iterrows():
        close = row.get("Close")
        if pd.isna(close):
            continue
        points.append(
            PricePoint(
                date=index.strftime("%Y-%m-%d"),
                open=row.get("Open", close),
                high=row.get("High", close),
                low=row.get("Low", close),
                close=close,
                volume=row.get("Volume"),
            )
        )
    return points

"""
Share prices are only ever served at least PRICE_LAG_DAYS old (2026-11).

Showing current or near-current NSE/BSE prices raises market-data licensing
and SEBI questions this app doesn't need for an educational game, so the
lag is applied in the API itself: the cache keeps full series, and every
response is cut back here. Pure functions, no I/O.

yfinance labels a weekly bar with its Monday but gives it the week's latest
close (the bar dated 2 Nov carries 5 Nov's close, checked live 2026-11-05),
so a weekly bar only counts as old enough once the whole week is: its date
plus 6 days must be on or before the cutoff.
"""
from datetime import date, datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from app.models import PricePoint

PRICE_LAG_DAYS = 30
_WEEK_SPAN = timedelta(days=6)


def today_in_india() -> date:
    return datetime.now(ZoneInfo("Asia/Kolkata")).date()


def cutoff(today: date) -> date:
    return today - timedelta(days=PRICE_LAG_DAYS)


def _day(point: PricePoint) -> date:
    return date.fromisoformat(point.date[:10])


def lag_daily(points: list[PricePoint], today: date) -> list[PricePoint]:
    limit = cutoff(today)
    return [p for p in points if _day(p) <= limit]


def lag_weekly(points: list[PricePoint], today: date) -> list[PricePoint]:
    limit = cutoff(today)
    return [p for p in points if _day(p) + _WEEK_SPAN <= limit]


def latest_lagged_close(
    weekly: list[PricePoint], daily: list[PricePoint], today: date
) -> Optional[tuple[float, str]]:
    """(close, "YYYY-MM-DD") of the newest close that is old enough.

    Prefers the daily series, whose dates are exact trading days. A weekly
    bar's close is dated by the end of its week (+4 days, the Friday), not
    its Monday label.
    """
    lagged_daily = lag_daily(daily, today)
    if lagged_daily:
        last = lagged_daily[-1]
        return last.close, last.date[:10]
    lagged_weekly = lag_weekly(weekly, today)
    if lagged_weekly:
        last = lagged_weekly[-1]
        return last.close, (_day(last) + timedelta(days=4)).isoformat()
    return None


def lagged_market_cap(
    lagged_price: Optional[float],
    shares_outstanding: Optional[float],
    current_market_cap: Optional[float],
    current_price: Optional[float],
) -> Optional[float]:
    """Market cap at the lagged price. Share counts barely move within a
    month, so scaling today's market cap by the price ratio is the fallback
    when the share count is missing."""
    if lagged_price is None:
        return None
    if shares_outstanding:
        return lagged_price * shares_outstanding
    if current_market_cap and current_price:
        return current_market_cap * lagged_price / current_price
    return None

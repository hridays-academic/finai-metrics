"""Pure tests for the 30-day share-price lag -- no database. See
app/services/price_lag.py."""
from datetime import date

import pytest

from app.models import PricePoint
from app.services.price_lag import (
    cutoff,
    lag_daily,
    lag_weekly,
    lagged_market_cap,
    latest_lagged_close,
)

TODAY = date(2026, 11, 5)  # cutoff 2026-10-06


def _pt(d: str, close: float = 100.0) -> PricePoint:
    return PricePoint(date=d, open=close, high=close, low=close, close=close)


def test_cutoff_is_thirty_days_back():
    assert cutoff(TODAY) == date(2026, 10, 6)


def test_daily_keeps_the_cutoff_day_and_drops_anything_newer():
    points = [_pt("2026-10-05"), _pt("2026-10-06"), _pt("2026-10-07"), _pt("2026-11-05")]
    assert [p.date for p in lag_daily(points, TODAY)] == ["2026-10-05", "2026-10-06"]


def test_intraday_timestamps_are_compared_by_day():
    points = [_pt("2026-10-06T15:29:00"), _pt("2026-10-07T09:15:00")]
    assert [p.date for p in lag_daily(points, TODAY)] == ["2026-10-06T15:29:00"]


def test_weekly_bar_needs_its_whole_week_before_the_cutoff():
    # A Monday-labelled bar carries up to Sunday's close, so the bar for the
    # week of 29 Sep (ending 5 Oct) is old enough, but 6 Oct's week isn't:
    # its close could be as late as 12 Oct.
    points = [_pt("2026-09-29"), _pt("2026-10-06"), _pt("2026-11-02")]
    assert [p.date for p in lag_weekly(points, TODAY)] == ["2026-09-29"]


def test_latest_close_prefers_the_exact_daily_date():
    weekly = [_pt("2026-09-29", 90.0)]
    daily = [_pt("2026-10-03", 95.0), _pt("2026-10-06", 97.0), _pt("2026-11-04", 130.0)]
    assert latest_lagged_close(weekly, daily, TODAY) == (97.0, "2026-10-06")


def test_latest_close_falls_back_to_weekly_dated_by_its_friday():
    weekly = [_pt("2026-09-22", 88.0), _pt("2026-09-29", 90.0), _pt("2026-11-02", 130.0)]
    assert latest_lagged_close(weekly, [], TODAY) == (90.0, "2026-10-03")


def test_latest_close_is_none_when_nothing_is_old_enough():
    assert latest_lagged_close([_pt("2026-11-02")], [_pt("2026-11-04")], TODAY) is None


class TestLaggedMarketCap:
    def test_uses_the_share_count_when_known(self):
        assert lagged_market_cap(100.0, 1_000.0, 999_999.0, 1.0) == pytest.approx(100_000.0)

    def test_scales_todays_market_cap_without_a_share_count(self):
        assert lagged_market_cap(90.0, None, 1_200.0, 120.0) == pytest.approx(900.0)

    def test_none_without_a_lagged_price(self):
        assert lagged_market_cap(None, 1_000.0, 1_200.0, 120.0) is None

    def test_none_when_it_cannot_be_derived(self):
        assert lagged_market_cap(90.0, None, None, 120.0) is None

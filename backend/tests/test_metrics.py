"""Pure tests for the Research page's ratios and history tables (no database)."""
from datetime import date

import pytest

from app.models import FinancialHistory, FinancialQuarter, FinancialYear, RawFinancials
from app.services.metrics import (
    PAYABLES_NA,
    RECEIVABLES_NA,
    compute_metric_groups,
    history_table,
    sector_group,
)

CR = 1e7


def year(end: str, **kw) -> FinancialYear:
    return FinancialYear(period_end_date=end, **{k: v * CR if k != "eps_diluted" else v for k, v in kw.items()})


# Maruti Suzuki's FY26 and FY25 figures as Yahoo reports them (Rs crore),
# checked against the audited filing on 2026-11-08.
MARUTI = FinancialHistory(annual=[
    year("2026-03-31", revenue=177094.1, operating_income=14788.4, depreciation=6741.7, net_income=14679.5,
         eps_diluted=466.9, pretax_income=19118.5, tax_provision=4439.0, total_equity=107156.3, total_debt=102.5,
         cash_and_short_term_investments=17324.9, receivables=5342.0, other_receivables=909.7, inventory=11320.6,
         payables=22133.8, operating_cash_flow=19099.9, capital_expenditure=10397.6, dividends_paid=4244.4),
    year("2025-03-31", revenue=147468.6, operating_income=14615.4, depreciation=5608.2, net_income=14500.2,
         eps_diluted=461.2),
    year("2024-03-31", revenue=140932.6),
    year("2023-03-31", revenue=117571.3),
])
RAW = RawFinancials(revenue=177094.1 * CR, net_income=14679.5 * CR, total_equity=107156.3 * CR,
                    prior_total_equity=96239.9 * CR, total_assets=140000 * CR, prior_total_assets=128000 * CR,
                    current_liabilities=36480 * CR, shares_outstanding=31.44 * CR, current_price=12700.0,
                    market_cap=12700.0 * 31.44 * CR)


def metrics(history=MARUTI, raw=RAW, sector="Consumer Cyclical", industry="Auto Manufacturers"):
    groups = compute_metric_groups(raw, "Maruti Suzuki", history, sector, industry)
    return {m.key: m for g in groups for m in g.metrics}, [g.key for g in groups]


def test_sections_in_the_approved_order():
    _, keys = metrics()
    assert keys == ["growth", "profitability", "cash_flow", "working_capital", "returns", "leverage", "valuation"]


def test_growth_and_cagr():
    m, _ = metrics()
    assert m["revenue_growth"].value == pytest.approx(20.09, abs=0.01)
    assert m["revenue_cagr_3y"].value == pytest.approx(((177094.1 / 117571.3) ** (1 / 3) - 1) * 100, abs=1e-3)
    assert m["revenue_cagr_5y"].value is None
    assert "Yahoo Finance has 4" in m["revenue_cagr_5y"].assessment


def test_ebitda_is_operating_profit_plus_depreciation():
    m, _ = metrics()
    assert m["ebitda_margin"].value == pytest.approx((14788.4 + 6741.7) / 177094.1 * 100, abs=1e-3)
    assert m["ebitda_margin"].status.value == "good"  # vehicle makers: 12% or more is strong


def test_cash_flow_ratios():
    m, _ = metrics()
    assert m["cash_conversion"].value == pytest.approx(19099.9 / 14679.5, abs=1e-4)
    assert m["free_cash_flow"].value == pytest.approx((19099.9 - 10397.6) * CR)
    assert m["capex_to_revenue"].status.value == "neutral"


def test_days_of_revenue_and_withheld_payables():
    m, _ = metrics()
    assert m["debtor_days"].value == pytest.approx(5342.0 / 177094.1 * 365, abs=1e-3)
    assert m["inventory_days"].value == pytest.approx(11320.6 / 177094.1 * 365, abs=1e-3)
    assert m["payable_days"].value is None and m["payable_days"].assessment == PAYABLES_NA
    assert m["cash_conversion_cycle"].value is None


def test_debtor_days_withheld_when_yahoo_moved_receivables():
    moved = MARUTI.model_copy(deep=True)
    moved.annual[0].receivables, moved.annual[0].other_receivables = 948 * CR, 3326 * CR  # Mphasis FY26
    m, _ = metrics(history=moved)
    assert m["debtor_days"].value is None and m["debtor_days"].assessment == RECEIVABLES_NA


def test_dupont_multiplies_back_to_roe():
    m, _ = metrics()
    product = 1.0
    for part in m["dupont_roe"].parts:
        product *= part.value / 100 if part.unit == "%" else part.value
    assert product * 100 == pytest.approx(m["roe"].value, rel=1e-3)
    assert m["dupont_roe"].value == pytest.approx(m["roe"].value, abs=1e-3)


def test_valuation_uses_lagged_price_and_paid_dividends():
    m, _ = metrics()
    ev = RAW.market_cap + 102.5 * CR - 17324.9 * CR
    assert m["ev_to_ebitda"].value == pytest.approx(ev / ((14788.4 + 6741.7) * CR), abs=1e-3)
    assert m["dividend_yield"].value == pytest.approx(4244.4 / 31.44 / 12700 * 100, abs=1e-3)
    assert m["payout_ratio"].value == pytest.approx(4244.4 / 14679.5 * 100, abs=1e-3)


def test_net_cash_reads_as_healthy():
    m, _ = metrics()
    assert m["net_debt"].value < 0 and m["net_debt"].status.value == "good"


def test_negative_base_and_losses_are_not_meaningful():
    loss = MARUTI.model_copy(deep=True)
    loss.annual[1].net_income = -10 * CR
    loss.annual[0].pretax_income = -5 * CR
    m, _ = metrics(history=loss)
    assert m["net_profit_growth"].value is None and "zero or negative" in m["net_profit_growth"].assessment
    assert m["effective_tax_rate"].value is None


def test_banks_get_not_meaningful_instead_of_numbers():
    m, _ = metrics(sector="Financial Services", industry="Banks - Regional")
    for key in ("ebitda_margin", "free_cash_flow", "debtor_days", "net_debt", "ev_to_ebitda", "roic"):
        assert m[key].value is None and "banks" in m[key].assessment


def test_no_history_still_renders_every_tile():
    m, _ = metrics(history=None)
    assert m["revenue_growth"].value is None and m["roe"].value is not None


@pytest.mark.parametrize("sector,industry,expected", [
    ("Technology", "Information Technology Services", "it"),
    ("Consumer Defensive", "Household & Personal Products", "fmcg"),
    ("Basic Materials", "Building Materials", "cement"),
    ("Industrials", "Farm & Heavy Construction Machinery", "autos"),
    ("Financial Services", "Banks - Regional", "financial"),
    (None, None, "default"),
])
def test_sector_group(sector, industry, expected):
    assert sector_group(sector, industry) == expected


def test_history_table_pads_missing_periods():
    h = FinancialHistory(
        annual=MARUTI.annual,
        quarterly=[FinancialQuarter(period_end_date="2026-06-30", revenue=100.0, operating_income=10.0,
                                    depreciation=5.0, net_income=8.0)],
    )
    t = history_table(h, date(2026, 11, 8))
    assert [r.period_end_date for r in t.annual] == [
        "2026-03-31", "2025-03-31", "2024-03-31", "2023-03-31", "2022-03-31"]
    assert t.annual[4].revenue is None
    assert t.quarterly[0].period_end_date == "2026-09-30" and t.quarterly[0].revenue is None
    assert len(t.quarterly) == 8 and t.quarterly[-1].period_end_date == "2024-12-31"
    q = t.quarterly[1]
    assert q.ebitda == 15.0 and q.ebitda_margin_pct == pytest.approx(15.0)


def test_history_table_without_data():
    t = history_table(None, date(2026, 1, 15))
    assert t.annual == [] and t.quarterly[0].period_end_date == "2025-12-31"


def test_accounts_in_dollars_never_mix_with_the_rupee_price():
    # Yahoo reports a few Indian companies' accounts in USD (Infosys).
    m, _ = metrics(raw=RAW.model_copy(update={"currency": "USD"}))
    for key in ("ev_to_ebitda", "ev_to_sales", "dividend_yield"):
        assert m[key].value is None and "USD" in m[key].assessment
    assert m["free_cash_flow"].unit == "USD" and m["net_debt"].unit == "USD"
    assert m["payout_ratio"].value is not None  # same-currency ratio is fine
    for key in ("pe_ratio", "pb_ratio", "eps", "earnings_yield", "book_value_per_share"):
        assert m[key].value is None
    assert m["market_cap"].value is not None

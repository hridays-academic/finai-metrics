"""
Pure ratio-calculation functions.

Deliberately provider-agnostic: this module only knows about `RawFinancials`
and never imports yfinance (or any other provider). That keeps it easy to
unit test and means the metrics stay correct even if the data source
underneath is swapped out.

Every metric that's missing an input returns `Metric(value=None, status=NEUTRAL)`
rather than raising -- a gap in the data should show as "N/A" in the UI, never
a fabricated number.

Each metric also carries a plain-English `definition` (what the ratio *is*)
and a value-aware `assessment` (whether *this* company's number is in a
healthy range, why, and what that actually means in practice) -- both shown
in the frontend's hover popup. `assessment` is built from two parts: a
company-named, value-aware sentence (the ratio's actual number and whether
it's healthy) plus a fixed "why this matters" clause per metric (what a
high/low reading actually implies for the business, e.g. why heavy debt is
riskier than the ratio alone conveys). Both stay strictly descriptive/
educational (e.g. "this is below the level typically considered healthy")
and must never be worded as investment advice ("you should sell") -- see
CLAUDE.md on why that line matters.
"""
from datetime import date
from typing import Optional

from app.models import (
    FinancialHistory,
    FinancialYear,
    HealthSnapshot,
    HistoryRow,
    HistoryTable,
    Metric,
    MetricGroup,
    MetricPart,
    MetricStatus,
    RawFinancials,
)


def _safe_div(numerator: Optional[float], denominator: Optional[float]) -> Optional[float]:
    if numerator is None or denominator is None or denominator == 0:
        return None
    return numerator / denominator


def _avg(current: Optional[float], prior: Optional[float]) -> Optional[float]:
    if current is not None and prior is not None:
        return (current + prior) / 2
    return current


def _status_high_good(value: float, good: float, warn: float) -> MetricStatus:
    """Higher is better (e.g. current ratio, margins, coverage)."""
    if value >= good:
        return MetricStatus.GOOD
    if value >= warn:
        return MetricStatus.WARNING
    return MetricStatus.BAD


def _status_low_good(value: float, good: float, warn: float) -> MetricStatus:
    """Lower is better (e.g. debt-to-equity, debt-to-assets)."""
    if value <= good:
        return MetricStatus.GOOD
    if value <= warn:
        return MetricStatus.WARNING
    return MetricStatus.BAD


def _fmt(value: float, unit: str) -> str:
    if unit == "%":
        return f"{value:.1f}%"
    if unit == "x":
        return f"{value:.2f}x"
    if unit == "days":
        return f"{value:.0f} days"
    return f"{value:,.2f}"


def _build_assessment(
    company_name: str, value: float, unit: str, status: MetricStatus, good: float, warn: float, direction: str, why: str
) -> str:
    v = _fmt(value, unit)
    g = _fmt(good, unit)
    w = _fmt(warn, unit)
    if direction == "high":
        if status == MetricStatus.GOOD:
            base = f"{company_name}'s {v} is in a healthy range for this ratio (typically at or above {g})."
        elif status == MetricStatus.WARNING:
            base = (
                f"{company_name}'s {v} is moderate, below the {g} level usually considered strong, "
                "though not yet a warning sign."
            )
        else:
            base = (
                f"{company_name}'s {v} is below the {w} level typically considered healthy, "
                "which is usually seen as a warning sign."
            )
    else:
        if status == MetricStatus.GOOD:
            base = f"{company_name}'s {v} is in a healthy range for this ratio (typically at or below {g})."
        elif status == MetricStatus.WARNING:
            base = (
                f"{company_name}'s {v} is moderate, above the {g} level usually considered conservative, "
                "though not yet a warning sign."
            )
        else:
            base = f"{company_name}'s {v} is above the {w} level typically considered risky."
    return f"{base} {why}"


def _metric(
    key: str,
    label: str,
    value: Optional[float],
    unit: str,
    definition: str,
    formula: str,
    benchmark_note: str,
    why: str,
    company_name: str,
    *,
    good: Optional[float] = None,
    warn: Optional[float] = None,
    direction: str = "high",
    override_status: Optional[MetricStatus] = None,
    override_assessment: Optional[str] = None,
    na_reason: Optional[str] = None,
) -> Metric:
    if value is None:
        status = MetricStatus.NEUTRAL
        assessment = na_reason or "Not available for this company from the current data source."
    elif override_status is not None:
        status = override_status
        assessment = f"{override_assessment or benchmark_note} {why}"
    elif good is None:
        status = MetricStatus.NEUTRAL
        assessment = f"{benchmark_note} {why}"
    else:
        status = _status_high_good(value, good, warn) if direction == "high" else _status_low_good(value, good, warn)
        assessment = _build_assessment(company_name, value, unit, status, good, warn, direction, why)

    return Metric(
        key=key,
        label=label,
        value=round(value, 4) if value is not None else None,
        unit=unit,
        status=status,
        benchmark_note=benchmark_note,
        formula=formula,
        definition=definition,
        assessment=assessment,
    )


# ---------- Sectors ----------
# Benchmarks that genuinely differ by industry use the company's own sector,
# read from Yahoo's sector/industry labels. Everything else uses one bar.

_SECTOR_NAMES = {
    "it": "IT services companies",
    "fmcg": "consumer goods (FMCG) companies",
    "cement": "cement companies",
    "autos": "vehicle makers",
    "default": "most companies",
}

# (good, warn): higher-is-better for margins, lower-is-better for days.
_SECTOR_BENCHMARKS = {
    "ebitda_margin": {"default": (15, 8), "it": (18, 12), "fmcg": (18, 12), "cement": (18, 12), "autos": (12, 8)},
    "debtor_days": {"default": (60, 90), "it": (75, 100), "fmcg": (30, 45), "cement": (30, 60), "autos": (30, 45)},
    "inventory_days": {"default": (60, 120), "it": (30, 60), "fmcg": (45, 75), "cement": (45, 75), "autos": (30, 60)},
}

FINANCIAL_NA = (
    "Not meaningful for banks and lenders: lending is their business, so borrowing, cash and "
    "working capital don't mean what they mean for other companies."
)

# From the 2026-11 check of FY26 figures against the 7 pilot companies'
# audited filings: Yahoo's payables matched for 5, but were 75% too high for
# Sagar Cements and 14% too low for Escorts, with nothing in the data to tell
# which companies are affected. Receivables matched for 6; for Mphasis Yahoo
# had moved unbilled revenue to "Other Receivables" (77% too low).
PAYABLES_NA = (
    "Not shown: Yahoo Finance's payables figure didn't match the trade payables in the "
    "company's own filing for 2 of the 7 companies we checked (one was 75% too high), and "
    "there's no way to tell from the data which companies are affected."
)
RECEIVABLES_NA = (
    "Not shown: Yahoo Finance files most of this company's receivables (such as revenue "
    "earned but not yet billed) under a separate heading, so its figure doesn't match the "
    "company's own trade receivables."
)

CURRENCY_NA = (
    "Not shown: Yahoo Finance reports this company's accounts in {currency} while its share "
    "price is in rupees, so this would mix two currencies."
)

DAYS_OF_REVENUE_NOTE = (
    "Measured in days of revenue, not days of cost of goods. Yahoo Finance's cost figure for many "
    "Indian companies covers raw materials only, which would make these days look several times "
    "longer than they are. Revenue is reported the same way by every company, so this compares "
    "fairly between companies, but it reads lower than a textbook cost-based figure."
)


def sector_group(sector: Optional[str], industry: Optional[str]) -> str:
    s, i = (sector or "").lower(), (industry or "").lower()
    if "financial" in s or "bank" in i:
        return "financial"
    if s == "technology" or "information technology" in i or "software" in i:
        return "it"
    if "consumer defensive" in s:
        return "fmcg"
    if "building materials" in i:
        return "cement"
    if "auto" in i or "farm & heavy" in i:
        return "autos"
    return "default"


def _bench(name: str, sg: str) -> tuple[float, float, str]:
    table = _SECTOR_BENCHMARKS[name]
    key = sg if sg in table else "default"
    good, warn = table[key]
    return good, warn, _SECTOR_NAMES[key]


# ---------- History helpers ----------

def _year(h: Optional[FinancialHistory], i: int) -> Optional[FinancialYear]:
    return h.annual[i] if h is not None and len(h.annual) > i else None


def _ebitda(operating_income: Optional[float], depreciation: Optional[float]) -> Optional[float]:
    """Operating profit + depreciation and amortisation. Not Yahoo's own
    EBITDA row, which adds other income on top (TCS FY25: 71,369 cr vs
    67,535 cr this way) and so doesn't match how Indian companies report it."""
    if operating_income is None or depreciation is None:
        return None
    return operating_income + depreciation


def _growth(new: Optional[float], old: Optional[float]) -> tuple[Optional[float], Optional[str]]:
    if new is None or old is None:
        return None, None
    if old <= 0:
        return None, "Not meaningful when the earlier year's figure was zero or negative."
    return (new / old - 1) * 100, None


def _cagr(new: Optional[float], old: Optional[float], years: int) -> tuple[Optional[float], Optional[str]]:
    if new is None or old is None:
        return None, None
    if old <= 0 or new <= 0:
        return None, "Not meaningful when either year's figure was zero or negative."
    return ((new / old) ** (1 / years) - 1) * 100, None


def _pct(v: Optional[float]) -> Optional[float]:
    return v * 100 if v is not None else None


def _sub(a: Optional[float], b: Optional[float]) -> Optional[float]:
    return a - b if a is not None and b is not None else None


def _days(balance: Optional[float], revenue: Optional[float]) -> Optional[float]:
    ratio = _safe_div(balance, revenue)
    return ratio * 365 if ratio is not None else None


def _years_with_revenue(h: Optional[FinancialHistory]) -> int:
    return sum(1 for y in h.annual if y.revenue is not None) if h is not None else 0


# ---------- Groups ----------

def compute_metric_groups(
    raw: RawFinancials,
    company_name: str,
    history: Optional[FinancialHistory] = None,
    sector: Optional[str] = None,
    industry: Optional[str] = None,
) -> list[MetricGroup]:
    """The Research page's ratio sections. `raw` is the latest fiscal year
    (plus a share price at least 30 days old); `history` adds earlier years
    and the cash flow statement. Both come from the same Yahoo download."""
    sg = sector_group(sector, industry)
    return [
        _growth_group(history, company_name, sg),
        _profitability_group(raw, history, company_name, sg),
        _cash_flow_group(history, company_name, sg, raw.currency),
        _working_capital_group(raw, history, company_name, sg),
        _returns_group(raw, history, company_name, sg),
        _leverage_group(raw, history, company_name, sg),
        _valuation_group(raw, history, company_name, sg),
    ]


def _growth_group(h: Optional[FinancialHistory], company_name: str, sg: str) -> MetricGroup:
    y0, y1, y3, y5 = _year(h, 0), _year(h, 1), _year(h, 3), _year(h, 5)
    fin = sg == "financial"
    get = lambda y, f: getattr(y, f) if y is not None else None  # noqa: E731
    rev_yoy, rev_yoy_na = _growth(get(y0, "revenue"), get(y1, "revenue"))
    cagr3, cagr3_na = _cagr(get(y0, "revenue"), get(y3, "revenue"), 3)
    cagr5, cagr5_na = _cagr(get(y0, "revenue"), get(y5, "revenue"), 5)
    years = _years_with_revenue(h)
    if cagr5 is None and cagr5_na is None:
        cagr5_na = f"Needs six years of results. Yahoo Finance has {years} for this company."
    if cagr3 is None and cagr3_na is None and years < 4:
        cagr3_na = f"Needs four years of results. Yahoo Finance has {years} for this company."
    e0 = _ebitda(get(y0, "operating_income"), get(y0, "depreciation"))
    e1 = _ebitda(get(y1, "operating_income"), get(y1, "depreciation"))
    ebitda_g, ebitda_na = (None, FINANCIAL_NA) if fin else _growth(e0, e1)
    np_g, np_na = _growth(get(y0, "net_income"), get(y1, "net_income"))
    eps_g, eps_na = _growth(get(y0, "eps_diluted"), get(y1, "eps_diluted"))

    common = dict(good=10, warn=0)
    return MetricGroup(
        key="growth",
        label="Growth",
        metrics=[
            _metric(
                "revenue_growth", "Revenue Growth", rev_yoy, "%",
                "How much more (or less) the company sold in its latest fiscal year than in the year before.",
                "(Revenue this year / Revenue last year - 1) x 100",
                "Above 10% is strong growth; below 0% means sales shrank.",
                "One year can be lifted or dragged by a one-off, so read it next to the 3-year rate.",
                company_name, na_reason=rev_yoy_na, **common,
            ),
            _metric(
                "revenue_cagr_3y", "Revenue CAGR, 3 years", cagr3, "%",
                "The steady yearly growth rate that would take revenue from three years ago to this year's level.",
                "(Revenue this year / Revenue 3 years ago) ^ (1/3) - 1",
                "Above 10% a year is strong growth for an established company.",
                "Averaging over three years smooths out a single good or bad year.",
                company_name, na_reason=cagr3_na, **common,
            ),
            _metric(
                "revenue_cagr_5y", "Revenue CAGR, 5 years", cagr5, "%",
                "The steady yearly growth rate that would take revenue from five years ago to this year's level.",
                "(Revenue this year / Revenue 5 years ago) ^ (1/5) - 1",
                "Above 10% a year is strong growth for an established company.",
                "Five years usually spans a full business cycle, good years and bad.",
                company_name, na_reason=cagr5_na, **common,
            ),
            _metric(
                "ebitda_growth", "EBITDA Growth", ebitda_g, "%",
                "How much the profit from operations (before interest, tax, depreciation and "
                "amortisation) changed from the year before.",
                "(EBITDA this year / EBITDA last year - 1) x 100, EBITDA = operating profit + depreciation",
                "Above 10% is strong; growing faster than revenue means margins widened.",
                "Comparing this with revenue growth shows whether costs are rising faster or slower than sales.",
                company_name, na_reason=ebitda_na, **common,
            ),
            _metric(
                "net_profit_growth", "Net Profit Growth", np_g, "%",
                "How much the bottom-line profit changed from the year before.",
                "(Net profit this year / Net profit last year - 1) x 100",
                "Above 10% is strong; one-off gains or losses can swing it.",
                "Net profit includes interest, tax and one-off items, so it moves more than operating profit.",
                company_name, na_reason=np_na, **common,
            ),
            _metric(
                "eps_growth", "EPS Growth", eps_g, "%",
                "How much profit per share changed from the year before.",
                "(Diluted EPS this year / Diluted EPS last year - 1) x 100",
                "Above 10% is strong.",
                "If this trails net profit growth, new shares were issued and each share's slice got smaller.",
                company_name, na_reason=eps_na, **common,
            ),
        ],
    )


def _profitability_group(r: RawFinancials, h: Optional[FinancialHistory], company_name: str, sg: str) -> MetricGroup:
    y0 = _year(h, 0)
    fin = sg == "financial"
    gross_margin = _pct(_safe_div(r.gross_profit, r.revenue))
    operating_margin = _pct(_safe_div(r.operating_income, r.revenue))
    net_margin = _pct(_safe_div(r.net_income, r.revenue))
    ebitda = _ebitda(y0.operating_income, y0.depreciation) if y0 else None
    ebitda_margin = None if fin else _pct(_safe_div(ebitda, y0.revenue if y0 else None))
    em_good, em_warn, em_sector = _bench("ebitda_margin", sg)
    tax_rate, tax_na = None, None
    if y0 is not None and y0.pretax_income is not None and y0.tax_provision is not None:
        if y0.pretax_income > 0:
            tax_rate = y0.tax_provision / y0.pretax_income * 100
        else:
            tax_na = "Not meaningful when profit before tax was zero or negative."

    return MetricGroup(
        key="profitability",
        label="Profitability",
        metrics=[
            _metric(
                "gross_margin", "Gross Margin", gross_margin, "%",
                "The percentage of revenue left after subtracting the direct cost of producing "
                "goods or services, before overhead, marketing, or admin costs.",
                "Gross Profit / Revenue x 100",
                "Varies a lot by industry; compare against sector peers rather than an absolute bar.",
                "A thin gross margin leaves little room to absorb rising costs or fund growth "
                "before even reaching operating expenses.",
                company_name,
                good=40, warn=20,
            ),
            _metric(
                "ebitda_margin", "EBITDA Margin", ebitda_margin, "%",
                "The share of revenue left as profit from operations before interest, tax, "
                "depreciation and amortisation. It's the margin most Indian companies quote in "
                "their results.",
                "(Operating profit + Depreciation) / Revenue x 100",
                f"For {em_sector}, {em_good:.0f}% or more is strong and below {em_warn:.0f}% is weak.",
                "Built from operating profit, so it leaves out other income such as interest "
                "earned on cash, which Yahoo's own EBITDA figure includes.",
                company_name,
                good=em_good, warn=em_warn, na_reason=FINANCIAL_NA if fin else None,
            ),
            _metric(
                "operating_margin", "Operating Margin", operating_margin, "%",
                "The percentage of revenue left after covering both direct costs and day-to-day "
                "operating expenses, before interest and taxes, a measure of core business "
                "efficiency.",
                "Operating Income / Revenue x 100",
                "Reflects core operating efficiency before interest and tax.",
                "This strips out interest and tax, so it isolates how efficiently the core "
                "business itself is run, separate from how it's financed or taxed.",
                company_name,
                good=15, warn=5,
            ),
            _metric(
                "net_margin", "Net Profit Margin", net_margin, "%",
                "The percentage of revenue that ultimately becomes profit, after every expense, "
                "interest payment, and tax is paid.",
                "Net Income / Revenue x 100",
                "Above ~10% is generally considered healthy, but varies by sector.",
                "This is the bottom line after everything (interest, tax, one-off items), so "
                "it can swing more than operating margin for reasons unrelated to day-to-day "
                "performance.",
                company_name,
                good=10, warn=3,
            ),
            _metric(
                "other_income_share", "Other Income, % of PBT", None, "%",
                "How much of profit before tax came from outside the main business, such as "
                "interest on cash or gains on investments.",
                "Other income / Profit before tax x 100",
                "A high share means profit leans on things other than the core business.",
                "",
                company_name,
                na_reason=(
                    "Yahoo Finance doesn't report Indian companies' other income separately (its "
                    "nearest figure for TCS in FY25 was 59 crore, against about 3,962 crore in the "
                    "filing), so this shows N/A rather than a wrong number."
                ),
            ),
            _metric(
                "effective_tax_rate", "Effective Tax Rate", tax_rate, "%",
                "The share of profit before tax that went to tax in the year.",
                "Tax expense / Profit before tax x 100",
                "Most Indian companies pay about 25%, the main corporate rate under the new regime.",
                "A rate far from 25% can come from tax breaks, losses carried forward or "
                "one-off adjustments, so it's worth checking why.",
                company_name, na_reason=tax_na,
            ),
        ],
    )


def _cash_flow_group(h: Optional[FinancialHistory], company_name: str, sg: str, r_currency: str = "INR") -> MetricGroup:
    y0 = _year(h, 0)
    fin = sg == "financial"
    na = FINANCIAL_NA if fin else None
    ocf = None if fin or y0 is None else y0.operating_cash_flow
    capex = None if fin or y0 is None else y0.capital_expenditure
    revenue = y0.revenue if y0 else None
    fcf = _sub(ocf, capex)
    fcf_margin = _pct(_safe_div(fcf, revenue))
    conversion, conversion_na = None, na
    if not fin and y0 is not None and ocf is not None and y0.net_income is not None:
        if y0.net_income > 0:
            conversion = ocf / y0.net_income
        else:
            conversion_na = "Not meaningful when net profit was zero or negative."
    capex_share = _pct(_safe_div(capex, revenue))

    ocf_status = None if ocf is None else (MetricStatus.GOOD if ocf > 0 else MetricStatus.BAD)
    fcf_status = None if fcf is None else (MetricStatus.GOOD if fcf > 0 else MetricStatus.WARNING)
    return MetricGroup(
        key="cash_flow",
        label="Cash Flow",
        metrics=[
            _metric(
                "operating_cash_flow", "Operating Cash Flow", ocf, r_currency,
                "The cash the business itself brought in during the year, after paying suppliers, "
                "staff and tax. Profit is an accounting figure; this is actual cash.",
                "From the cash flow statement",
                "Positive is healthy; negative means operations used more cash than they produced.",
                "A company can report a profit while cash flows out, for example when customers pay late.",
                company_name,
                override_status=ocf_status,
                override_assessment=(
                    None if ocf is None else
                    "The business generated cash from its operations." if ocf > 0 else
                    "The business used more cash than it generated from operations this year."
                ),
                na_reason=na,
            ),
            _metric(
                "free_cash_flow", "Free Cash Flow", fcf, r_currency,
                "Operating cash flow left after spending on factories, equipment and other long-term "
                "assets. It's the cash available for dividends, paying down debt or saving.",
                "Operating cash flow - Capital expenditure",
                "Positive is healthy. Negative can be fine for a company building capacity, but it has to be funded.",
                "A company investing heavily for growth can show negative free cash flow for a few years.",
                company_name,
                override_status=fcf_status,
                override_assessment=(
                    None if fcf is None else
                    "Operating cash covered capital spending, with cash left over." if fcf > 0 else
                    "Capital spending was larger than operating cash flow, so the gap came from savings or borrowing."
                ),
                na_reason=na,
            ),
            _metric(
                "fcf_margin", "FCF Margin", fcf_margin, "%",
                "Free cash flow as a share of revenue: how many rupees of spare cash each 100 rupees of sales left.",
                "Free cash flow / Revenue x 100",
                "Above 8% is strong; below 0% means spending outran operating cash.",
                "Useful for comparing cash generation between companies of different sizes.",
                company_name, good=8, warn=0, na_reason=na,
            ),
            _metric(
                "cash_conversion", "Cash Conversion", conversion, "x",
                "How much operating cash came in for each rupee of reported net profit.",
                "Operating cash flow / Net profit",
                "0.9x or more suggests profits are backed by cash; below 0.6x is worth a closer look.",
                "Low conversion often means money is stuck in unpaid customer bills or stock.",
                company_name, good=0.9, warn=0.6, na_reason=conversion_na,
            ),
            _metric(
                "capex_to_revenue", "Capex, % of Revenue", capex_share, "%",
                "How much of its revenue the company spent on long-term assets such as plants, "
                "machines and offices during the year.",
                "Capital expenditure / Revenue x 100",
                "No single healthy level: factories and cement plants need far more than software firms.",
                "A jump usually means new capacity is being built, which can lift sales later.",
                company_name, na_reason=na,
            ),
        ],
    )


def _working_capital_group(r: RawFinancials, h: Optional[FinancialHistory], company_name: str, sg: str) -> MetricGroup:
    current_ratio = _safe_div(r.current_assets, r.current_liabilities)
    quick_assets = (
        r.current_assets - r.inventory
        if r.current_assets is not None and r.inventory is not None
        else None
    )
    quick_ratio = _safe_div(quick_assets, r.current_liabilities)
    working_capital = (
        r.current_assets - r.current_liabilities
        if r.current_assets is not None and r.current_liabilities is not None
        else None
    )
    y0 = _year(h, 0)
    # Indian companies keep much of their cash in liquid funds and deposits,
    # which Yahoo files as short-term investments, so they count as cash here
    # (as in the textbook cash ratio: cash plus marketable securities).
    liquid = y0.cash_and_short_term_investments if y0 and y0.cash_and_short_term_investments is not None \
        else r.cash_and_equivalents
    cash_ratio = _safe_div(liquid, r.current_liabilities)

    wc_status = None
    wc_assessment = None
    if working_capital is not None:
        wc_status = MetricStatus.GOOD if working_capital > 0 else MetricStatus.BAD
        wc_assessment = (
            "Current assets exceed current liabilities, meaning there's a cash cushion for "
            "day-to-day operations."
            if working_capital > 0
            else "Current liabilities exceed current assets, meaning short-term obligations "
            "outweigh short-term resources, which is worth watching."
        )

    fin = sg == "financial"
    na = FINANCIAL_NA if fin else None
    revenue = y0.revenue if y0 else None
    debtor, debtor_na = None, na
    if not fin and y0 is not None:
        if y0.receivables is not None and y0.other_receivables is not None and y0.other_receivables > y0.receivables:
            debtor_na = RECEIVABLES_NA
        else:
            debtor = _days(y0.receivables, revenue)
    inventory = None if fin else _days(y0.inventory if y0 else None, revenue)
    # Payable days and the cycle built on them are withheld: see PAYABLES_NA.
    payable, ccc = None, None
    d_good, d_warn, d_sector = _bench("debtor_days", sg)
    i_good, i_warn, i_sector = _bench("inventory_days", sg)

    return MetricGroup(
        key="working_capital",
        label="Working Capital",
        metrics=[
            _metric(
                "current_ratio", "Current Ratio", current_ratio, "x",
                "Compares what a company owns short-term (cash, inventory, receivables) to what "
                "it owes short-term (bills, short-term debt), a check on whether it can cover "
                "its near-term obligations.",
                "Current Assets / Current Liabilities",
                "Healthy range is roughly 1.5x-3x; below 1x can signal short-term cash strain.",
                "A low current ratio can force a company to raise emergency cash, through debt "
                "or selling assets at a discount, if a large bill comes due unexpectedly.",
                company_name,
                good=1.5, warn=1.0,
            ),
            _metric(
                "quick_ratio", "Quick Ratio", quick_ratio, "x",
                "Also called the Acid-Test ratio. Like the current ratio, but excludes "
                "inventory, since inventory can be slow or hard to sell quickly. It's a stricter "
                "test of whether short-term bills can be paid right away.",
                "(Current Assets - Inventory) / Current Liabilities",
                "Above 1x means short-term obligations are covered without selling inventory.",
                "This matters most for businesses that hold slow-moving inventory (like "
                "manufacturers), where the current ratio alone can overstate how quickly cash "
                "is really available.",
                company_name,
                good=1.0, warn=0.5,
            ),
            _metric(
                "cash_ratio", "Cash Ratio", cash_ratio, "x",
                "The strictest liquidity test: can the company cover its short-term bills using "
                "only cash and short-term investments it could sell quickly, without collecting "
                "receivables or selling inventory?",
                "(Cash + Short-term investments) / Current Liabilities",
                "Measures ability to cover short-term liabilities with cash alone; >0.5x is strong.",
                "This is the most conservative liquidity check, since it ignores unpaid customer "
                "bills and unsold inventory entirely, useful for judging how a company would "
                "cope if collections suddenly slowed.",
                company_name,
                good=0.5, warn=0.2,
            ),
            _metric(
                "working_capital", "Working Capital", working_capital, r.currency,
                "The rupee amount left over after subtracting short-term liabilities from "
                "short-term assets, the cash cushion available to run day-to-day operations.",
                "Current Assets - Current Liabilities",
                "Positive means current assets exceed current liabilities.",
                "A negative number here doesn't automatically mean trouble. Some large, "
                "cash-generating businesses run on negative working capital by design, but "
                "it's worth checking why alongside the current and quick ratios.",
                company_name,
                override_status=wc_status, override_assessment=wc_assessment,
            ),
            _metric(
                "debtor_days", "Debtor Days", debtor, "days",
                "On average, how many days customers take to pay what they owe.",
                "Trade receivables / Revenue x 365",
                f"For {d_sector}, {d_good:.0f} days or fewer is healthy and over {d_warn:.0f} is slow.",
                "Rising debtor days can mean customers are paying later, which ties up cash.",
                company_name, good=d_good, warn=d_warn, direction="low", na_reason=debtor_na,
            ),
            _metric(
                "inventory_days", "Inventory (days of revenue)", inventory, "days",
                "How many days of sales the company holds as stock (raw materials, work in "
                f"progress and finished goods). {DAYS_OF_REVENUE_NOTE}",
                "Inventory / Revenue x 365",
                f"For {i_sector}, {i_good:.0f} days or fewer is lean and over {i_warn:.0f} is heavy.",
                "Stock that piles up ties up cash and can be a sign that sales are slowing.",
                company_name, good=i_good, warn=i_warn, direction="low", na_reason=na,
            ),
            _metric(
                "payable_days", "Payables (days of revenue)", payable, "days",
                f"How long, in days of sales, the company takes to pay its suppliers. {DAYS_OF_REVENUE_NOTE}",
                "Trade payables / Revenue x 365",
                "No single healthy level: paying later saves cash but can strain suppliers.",
                "Long payable days can reflect bargaining power, or difficulty paying bills.",
                company_name, na_reason=na or PAYABLES_NA,
            ),
            _metric(
                "cash_conversion_cycle", "Cash Conversion Cycle", ccc, "days",
                "Roughly how many days pass between paying for stock and collecting cash from "
                f"customers. Built from the three days figures, all in days of revenue. {DAYS_OF_REVENUE_NOTE}",
                "Debtor days + Inventory days - Payable days",
                "Shorter is better; below zero means suppliers effectively fund the business.",
                "A lengthening cycle means more cash is tied up in running the business.",
                company_name, good=30, warn=90, direction="low", na_reason=na or PAYABLES_NA,
            ),
        ],
    )


def _returns_group(r: RawFinancials, h: Optional[FinancialHistory], company_name: str, sg: str) -> MetricGroup:
    avg_equity = _avg(r.total_equity, r.prior_total_equity)
    avg_assets = _avg(r.total_assets, r.prior_total_assets)
    roe = _pct(_safe_div(r.net_income, avg_equity))
    roa = _pct(_safe_div(r.net_income, avg_assets))
    capital_employed = r.capital_employed
    if capital_employed is None and r.total_assets is not None and r.current_liabilities is not None:
        capital_employed = r.total_assets - r.current_liabilities
    roce = _pct(_safe_div(r.ebit, capital_employed))
    asset_turnover = _safe_div(r.revenue, avg_assets)

    y0 = _year(h, 0)
    fin = sg == "financial"
    roic, roic_na = None, FINANCIAL_NA if fin else None
    if not fin and y0 is not None:
        invested = None
        if y0.total_equity is not None and y0.total_debt is not None:
            invested = y0.total_equity + y0.total_debt
        if y0.pretax_income is not None and y0.tax_provision is not None and y0.pretax_income <= 0:
            roic_na = "Not meaningful when profit before tax was zero or negative."
        elif y0.pretax_income and y0.tax_provision is not None and y0.operating_income is not None:
            nopat = y0.operating_income * (1 - y0.tax_provision / y0.pretax_income)
            roic = _pct(_safe_div(nopat, invested))

    net_margin = _safe_div(r.net_income, r.revenue)
    leverage = _safe_div(avg_assets, avg_equity)
    dupont = None
    parts = None
    if net_margin is not None and asset_turnover is not None and leverage is not None:
        dupont = net_margin * asset_turnover * leverage * 100
        parts = [
            MetricPart(label="Margin", value=round(net_margin * 100, 4), unit="%"),
            MetricPart(label="Turnover", value=round(asset_turnover, 4), unit="x"),
            MetricPart(label="Leverage", value=round(leverage, 4), unit="x"),
        ]

    dupont_metric = _metric(
        "dupont_roe", "ROE, DuPont breakdown", dupont, "%",
        "Splits return on equity into three parts: how much profit each sale keeps (margin), how "
        "much the assets sell (asset turnover) and how much of the assets are funded by borrowing "
        "(leverage). Multiplying the three gives ROE.",
        "Net margin x Asset turnover x (Average assets / Average equity)",
        "Same ROE as above, shown as its three drivers.",
        "Two companies with the same ROE can get there very differently: one through high "
        "margins, another through heavy borrowing, which carries more risk.",
        company_name, good=15, warn=8,
    )
    dupont_metric.parts = parts

    return MetricGroup(
        key="returns",
        label="Returns",
        metrics=[
            _metric(
                "roe", "ROE", roe, "%",
                "Return on Equity: how much profit a company generates for every rupee "
                "shareholders have invested, a core measure of how efficiently it rewards its "
                "owners.",
                "Net Income / Average Total Equity x 100",
                "Above ~15% is generally considered strong for shareholders.",
                "A high ROE driven mainly by heavy borrowing (check Debt-to-Equity alongside "
                "this) is a different, riskier story than one driven by genuinely efficient "
                "operations.",
                company_name,
                good=15, warn=8,
            ),
            _metric(
                "roa", "ROA", roa, "%",
                "Return on Assets: how much profit a company generates for every rupee of "
                "assets it owns, regardless of how those assets were financed.",
                "Net Income / Average Total Assets x 100",
                "Measures how efficiently assets generate profit.",
                "Comparing this to ROE shows how much of the company's returns come from "
                "leverage. A big gap between the two usually means debt is doing a lot of "
                "the work.",
                company_name,
                good=5, warn=2,
            ),
            _metric(
                "roce", "ROCE", roce, "%",
                "Return on Capital Employed: how efficiently a company uses all the capital "
                "invested in it, both shareholder equity and borrowed money, to generate profit.",
                "EBIT / (Total Assets - Current Liabilities) x 100",
                "Above ~15% suggests efficient use of both equity and debt capital.",
                "Because this includes both equity and debt in the denominator, it's a fairer "
                "efficiency comparison between companies with different capital structures than "
                "ROE alone.",
                company_name,
                good=15, warn=8,
            ),
            _metric(
                "roic", "ROIC", roic, "%",
                "Return on Invested Capital: the after-tax operating profit earned on all the money "
                "put into the business by shareholders and lenders.",
                "Operating profit x (1 - Tax rate) / (Equity + Debt) at year end x 100",
                "Above 15% suggests the business earns well on the money invested in it.",
                "Leaves out interest and other income, so it judges the business itself, not how "
                "it's financed or where its spare cash sits.",
                company_name, good=15, warn=8, na_reason=roic_na,
            ),
            _metric(
                "asset_turnover", "Asset Turnover", asset_turnover, "x",
                "How much revenue a company generates for every rupee of assets it owns, a "
                "measure of how productively assets are being used.",
                "Revenue / Average Total Assets",
                "Higher means more revenue generated per unit of assets; varies widely by industry.",
                "Capital-intensive businesses (like utilities or manufacturers) naturally run "
                "lower here than asset-light ones (like software), compare within the same "
                "industry, not across.",
                company_name,
                good=1.0, warn=0.5,
            ),
            dupont_metric,
        ],
    )


def _leverage_group(r: RawFinancials, h: Optional[FinancialHistory], company_name: str, sg: str) -> MetricGroup:
    debt_to_equity = _safe_div(r.total_debt, r.total_equity)
    interest_coverage = _safe_div(r.ebit, r.interest_expense)
    debt_to_assets = _safe_div(r.total_debt, r.total_assets)

    y0 = _year(h, 0)
    fin = sg == "financial"
    na = FINANCIAL_NA if fin else None
    net_debt = None if fin or y0 is None else _sub(y0.total_debt, y0.cash_and_short_term_investments)
    ebitda = None if fin or y0 is None else _ebitda(y0.operating_income, y0.depreciation)
    ebitda_na = na
    if not fin and ebitda is not None and ebitda <= 0:
        ebitda, ebitda_na = None, "Not meaningful when EBITDA was zero or negative."
    nd_ebitda = _safe_div(net_debt, ebitda)
    debt_ebitda = _safe_div(y0.total_debt if y0 and not fin else None, ebitda)

    net_cash = net_debt is not None and net_debt <= 0
    return MetricGroup(
        key="leverage",
        label="Leverage",
        metrics=[
            _metric(
                "debt_to_equity", "Debt-to-Equity", debt_to_equity, "x",
                "How much a company relies on borrowed money compared to money invested by "
                "shareholders. Higher means more of the business is funded by debt.",
                "Total Debt / Total Equity",
                "Below 1x is conservative; above 2x indicates heavier reliance on debt.",
                "Higher debt raises fixed interest obligations that must be paid regardless of "
                "how business is going, which can turn a bad year into a much worse one.",
                company_name,
                good=1.0, warn=2.0, direction="low",
            ),
            _metric(
                "debt_to_assets", "Debt-to-Assets", debt_to_assets, "x",
                "The share of a company's total assets that are financed by debt rather than "
                "equity.",
                "Total Debt / Total Assets",
                "Share of assets financed by debt; lower generally means lower solvency risk.",
                "This shows what fraction of everything the company owns was actually paid for "
                "with borrowed money, versus shareholders' own capital.",
                company_name,
                good=0.4, warn=0.6, direction="low",
            ),
            _metric(
                "interest_coverage", "Interest Coverage", interest_coverage, "x",
                "How many times over a company's operating earnings could cover its interest "
                "payments, a measure of how easily it can service its debt.",
                "EBIT / Interest Expense",
                "Below 1.5x can signal difficulty servicing debt from operating earnings.",
                "This is a more direct test of debt safety than Debt-to-Equity alone: a "
                "company can carry a lot of debt and still be fine if its earnings comfortably "
                "cover the interest.",
                company_name,
                good=3.0, warn=1.5,
            ),
            _metric(
                "net_debt", "Net Debt", net_debt, r.currency,
                "Borrowings minus cash and short-term investments. A negative figure means the "
                "company holds more cash than it owes (net cash).",
                "Total debt - (Cash + Short-term investments)",
                "Net cash (zero or below) is the safest position.",
                "Cash can repay debt at short notice, so net debt is a truer measure of the burden than debt alone.",
                company_name,
                override_status=None if net_debt is None else (MetricStatus.GOOD if net_cash else MetricStatus.NEUTRAL),
                override_assessment=(
                    None if net_debt is None else
                    "The company holds more cash and short-term investments than debt." if net_cash else
                    "The company owes more than it holds in cash and short-term investments. "
                    "Net debt to EBITDA shows whether that's a heavy load."
                ),
                na_reason=na,
            ),
            _metric(
                "net_debt_to_ebitda", "Net Debt / EBITDA", nd_ebitda, "x",
                "Roughly how many years of operating profit it would take to repay net debt.",
                "Net debt / EBITDA",
                "Below 1x is comfortable and above 3x is heavy. Below zero means net cash.",
                "Lenders watch this closely; a high figure leaves less room if profits fall.",
                company_name,
                good=1.0, warn=3.0, direction="low", na_reason=ebitda_na,
            ),
            _metric(
                "debt_to_ebitda", "Debt / EBITDA", debt_ebitda, "x",
                "Total borrowing compared with a year's operating profit, before counting any cash.",
                "Total debt / EBITDA",
                "Below 1.5x is comfortable; above 3.5x is heavy.",
                "Compared with net debt to EBITDA, this ignores cash, so it shows the gross burden.",
                company_name,
                good=1.5, warn=3.5, direction="low", na_reason=ebitda_na,
            ),
        ],
    )


def _valuation_group(r: RawFinancials, h: Optional[FinancialHistory], company_name: str, sg: str) -> MetricGroup:
    y0 = _year(h, 0)
    # Statement figures in another currency can't be set against the rupee price,
    # and Yahoo's per-share figures for such companies don't line up either
    # (Infosys showed a P/E of 13 against a usual ~25).
    mixed = r.currency != "INR"
    mixed_na = CURRENCY_NA.format(currency=r.currency) if mixed else None
    pe_ratio = None if mixed else _safe_div(r.current_price, r.eps)
    pb_ratio = None if mixed else _safe_div(r.current_price, r.book_value_per_share)
    eps = None if mixed else r.eps
    bvps = None if mixed else r.book_value_per_share
    # Dividends actually paid in the last fiscal year, per share. Yahoo's own
    # per-share fields are unreliable for Indian stocks: its trailing annual
    # rate came back 0 for 5 of the 7 pilot companies, and its dividend rate
    # is only the latest single dividend (Escorts: 33 of the 51 paid).
    dps = None if mixed else _safe_div(y0.dividends_paid if y0 else None, r.shares_outstanding)
    if dps is None and not mixed and r.dividends_per_share:
        dps = r.dividends_per_share
    dividend_yield = _pct(_safe_div(dps, r.current_price))

    fin = sg == "financial"
    na = FINANCIAL_NA if fin else mixed_na
    ev = None
    if not fin and not mixed and y0 is not None and r.market_cap is not None and y0.total_debt is not None \
            and y0.cash_and_short_term_investments is not None:
        ev = r.market_cap + y0.total_debt - y0.cash_and_short_term_investments
    ebitda = _ebitda(y0.operating_income, y0.depreciation) if y0 else None
    ev_ebitda = _safe_div(ev, ebitda) if ebitda is not None and ebitda > 0 else None
    ev_sales = _safe_div(ev, y0.revenue if y0 else None)
    earnings_yield = _pct(_safe_div(eps, r.current_price))
    payout, payout_na = None, None
    if y0 is not None and y0.dividends_paid is not None and y0.net_income is not None:
        if y0.net_income > 0:
            payout = y0.dividends_paid / y0.net_income * 100
        else:
            payout_na = "Not meaningful when net profit was zero or negative."

    # r.current_price is a close at least 30 days old (main.py's
    # _with_lagged_price), hence "Share Price" rather than "Current Price".
    # Valuation ratios don't have a universal "healthy" direction (a low P/E
    # can mean "cheap" or "distressed" depending on context) so these stay
    # NEUTRAL/informational rather than good/bad colored, deliberately.
    return MetricGroup(
        key="valuation",
        label="Valuation",
        metrics=[
            _metric(
                "pe_ratio", "P/E Ratio", pe_ratio, "x",
                "How much investors are currently paying for each rupee of the company's annual "
                "earnings, used to compare how \"expensive\" a stock is relative to its profits.",
                "Share Price / EPS",
                "Compare against sector peers and its own history. It depends on context.",
                "A high P/E can mean investors expect strong future growth, or that the stock "
                "is simply expensive relative to current earnings; it doesn't tell you which on "
                "its own.",
                company_name, na_reason=mixed_na,
            ),
            _metric(
                "earnings_yield", "Earnings Yield", earnings_yield, "%",
                "Earnings per share as a percentage of the share price: the P/E ratio turned upside down.",
                "EPS / Share Price x 100",
                "Often compared with bond yields; it depends on context.",
                "Easier than P/E to compare with an interest rate, since both are a yearly percentage.",
                company_name, na_reason=mixed_na,
            ),
            _metric(
                "ev_to_ebitda", "EV / EBITDA", ev_ebitda, "x",
                "The value of the whole business (shares plus net debt) compared with a year's "
                "operating profit.",
                "(Market cap + Debt - Cash and short-term investments) / EBITDA",
                "Compare with sector peers; it depends on context.",
                "Unlike P/E, it isn't changed by how much debt a company uses, so it compares "
                "companies with different borrowing more fairly.",
                company_name, na_reason=na,
            ),
            _metric(
                "ev_to_sales", "EV / Sales", ev_sales, "x",
                "The value of the whole business compared with a year's revenue.",
                "(Market cap + Debt - Cash and short-term investments) / Revenue",
                "Compare with sector peers; it depends on context.",
                "Useful when profits are small or negative, since revenue is still there to compare.",
                company_name, na_reason=na,
            ),
            _metric(
                "pb_ratio", "P/B Ratio", pb_ratio, "x",
                "How much investors are currently paying relative to the company's net worth "
                "(assets minus liabilities) per share.",
                "Share Price / Book Value per Share",
                "Below 1x can indicate undervaluation or underlying distress. Check further.",
                "This is most meaningful for asset-heavy businesses (like banks or "
                "manufacturers), less so for asset-light ones (like software) where most "
                "value isn't on the balance sheet.",
                company_name, na_reason=mixed_na,
            ),
            _metric(
                "book_value_per_share", "Book Value per Share", bvps, "INR",
                "Shareholders' equity divided by the number of shares: the accounting net worth behind each share.",
                "Shareholders' equity / Shares outstanding",
                "No healthy level on its own; it's the denominator of P/B.",
                "Growing book value over the years usually means the company is keeping and reinvesting profits.",
                company_name, na_reason=mixed_na,
            ),
            _metric(
                "eps", "EPS", eps, "INR",
                "Earnings per Share over the last 12 months: the portion of a company's profit "
                "allocated to each individual share outstanding.",
                "Net Income (last 12 months) / Shares Outstanding",
                "Net income attributable to each outstanding share.",
                "On its own this is hard to compare across companies with different share "
                "counts. It's most useful tracked over time for the same company.",
                company_name, na_reason=mixed_na,
            ),
            _metric(
                "dividend_yield", "Dividend Yield", dividend_yield, "%",
                "The annual dividend payment expressed as a percentage of the share "
                "price, a measure of cash income relative to the stock's price.",
                "(Dividends paid in the last fiscal year / Shares) / Share Price x 100",
                "Annual dividend income relative to share price.",
                "A very high yield can sometimes mean the market expects a dividend cut, since "
                "yield rises automatically as a falling share price shrinks the denominator.",
                company_name, na_reason=mixed_na,
            ),
            _metric(
                "payout_ratio", "Dividend Payout Ratio", payout, "%",
                "The share of the year's net profit paid out to shareholders as dividends.",
                "Dividends paid in the year (cash flow statement) / Net profit x 100",
                "No single healthy level: growing companies keep more, mature ones pay out more.",
                "Uses dividends actually paid during the year. Indian companies usually pay the "
                "final dividend after the year ends, so this mixes last year's final dividend "
                "with this year's interim ones.",
                company_name, na_reason=payout_na,
            ),
            _metric(
                "market_cap", "Market Cap", r.market_cap, "INR",
                "The total market value of all a company's outstanding shares: share price "
                "multiplied by number of shares.",
                "Share Price x Shares Outstanding",
                "Total market value of outstanding shares.",
                "This is what the market currently thinks the whole company is worth. It's a "
                "starting point for classifying company size, not a judgment of value for money.",
                company_name,
            ),
        ],
    )


# ---------- History tables ----------

_QUARTER_ENDS = ("03-31", "06-30", "09-30", "12-31")


def _last_quarter_end(today: date) -> date:
    candidates = [date(today.year, int(q[:2]), int(q[3:])) for q in _QUARTER_ENDS]
    past = [d for d in candidates if d <= today]
    return max(past) if past else date(today.year - 1, 12, 31)


def _quarter_ends(latest: date, count: int) -> list[str]:
    year, idx = latest.year, _QUARTER_ENDS.index(latest.isoformat()[5:])
    out = []
    for _ in range(count):
        out.append(f"{year}-{_QUARTER_ENDS[idx]}")
        idx -= 1
        if idx < 0:
            idx, year = 3, year - 1
    return out


def _history_row(end: str, revenue, operating_income, depreciation, net_income) -> HistoryRow:
    ebitda = _ebitda(operating_income, depreciation)
    margin = _pct(_safe_div(ebitda, revenue)) if revenue and revenue > 0 else None
    return HistoryRow(period_end_date=end, revenue=revenue, ebitda=ebitda, ebitda_margin_pct=margin,
                      net_income=net_income)


def history_table(h: Optional[FinancialHistory], today: date, years: int = 5, quarters: int = 8) -> HistoryTable:
    """Five fiscal years and eight quarter-ends, newest first. The periods
    are generated, not taken from the data, so a period Yahoo lacks shows as
    an empty row instead of silently disappearing (yfinance often skips a
    quarter). Quarters end at the last quarter-end on or before `today`."""
    annual: list[HistoryRow] = []
    by_year = {y.period_end_date: y for y in (h.annual if h else [])}
    if by_year:
        latest = date.fromisoformat(max(by_year))
        for k in range(years):
            try:
                end = latest.replace(year=latest.year - k).isoformat()
            except ValueError:  # 29 Feb
                end = latest.replace(year=latest.year - k, day=28).isoformat()
            y = by_year.get(end)
            annual.append(_history_row(end, y.revenue, y.operating_income, y.depreciation, y.net_income)
                          if y else HistoryRow(period_end_date=end))
    by_quarter = {q.period_end_date: q for q in (h.quarterly if h else [])}
    quarterly = []
    for end in _quarter_ends(_last_quarter_end(today), quarters):
        q = by_quarter.get(end)
        quarterly.append(_history_row(end, q.revenue, q.operating_income, q.depreciation, q.net_income)
                         if q else HistoryRow(period_end_date=end))
    return HistoryTable(annual=annual, quarterly=quarterly)


_GROUP_NOUNS = {
    "working_capital": "liquidity",
    "profitability": "profitability",
    "leverage": "leverage",
    "returns": "returns",
}


def compute_health_snapshot(metric_groups: list[MetricGroup]) -> HealthSnapshot:
    """Aggregates the already-computed metric statuses into a single glanceable
    "how healthy are this company's fundamentals" summary. Deliberately stops
    at describing the ratios themselves -- never translates into buy/sell/hold
    language, which would cross from financial education into investment
    advice (see CLAUDE.md)."""
    group_scores: dict[str, float] = {}
    good = warning = bad = 0

    for group in metric_groups:
        if group.key not in _GROUP_NOUNS:
            continue  # valuation is intentionally excluded (no good/bad direction)
        weights = {"good": 1.0, "warning": 0.5, "bad": 0.0}
        scored = [weights[m.status.value] for m in group.metrics if m.status != MetricStatus.NEUTRAL]
        if scored:
            group_scores[group.key] = sum(scored) / len(scored)
        for m in group.metrics:
            if m.status == MetricStatus.GOOD:
                good += 1
            elif m.status == MetricStatus.WARNING:
                warning += 1
            elif m.status == MetricStatus.BAD:
                bad += 1

    total = good + warning + bad
    if total == 0:
        return HealthSnapshot(
            verdict="Not Enough Data",
            explanation="Not enough ratios are available for this company to assess overall fundamental health.",
            good_count=0, warning_count=0, bad_count=0, total_count=0,
        )

    score = (good * 1.0 + warning * 0.5) / total
    if score >= 0.7:
        verdict = "Strong Fundamentals"
    elif score >= 0.4:
        verdict = "Mixed Fundamentals"
    else:
        verdict = "Weak Fundamentals"

    best_key = max(group_scores, key=group_scores.get) if group_scores else None
    worst_key = min(group_scores, key=group_scores.get) if group_scores else None
    strong_phrase = (
        f"strong {_GROUP_NOUNS[best_key]}" if best_key and group_scores[best_key] >= 0.66 else None
    )
    weak_phrase = (
        f"weak {_GROUP_NOUNS[worst_key]}" if worst_key and group_scores[worst_key] <= 0.33 and worst_key != best_key else None
    )

    if strong_phrase and weak_phrase:
        explanation = f"Driven by {strong_phrase}, weighed down by {weak_phrase}."
    elif strong_phrase:
        explanation = f"Driven by {strong_phrase}, with the rest of the ratios in a healthy-to-moderate range."
    elif weak_phrase:
        explanation = f"Weighed down by {weak_phrase}, with the rest of the ratios in a healthy-to-moderate range."
    else:
        explanation = "A mix of healthy and moderate signals across liquidity, profitability, leverage, and efficiency ratios."

    return HealthSnapshot(
        verdict=verdict,
        explanation=explanation,
        good_count=good, warning_count=warning, bad_count=bad, total_count=total,
    )

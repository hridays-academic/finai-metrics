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
from typing import Optional

from app.models import HealthSnapshot, Metric, MetricGroup, MetricStatus, RawFinancials


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
                f"{company_name}'s {v} is moderate -- below the {g} level usually considered strong, "
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
                f"{company_name}'s {v} is moderate -- above the {g} level usually considered conservative, "
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
) -> Metric:
    if value is None:
        status = MetricStatus.NEUTRAL
        assessment = "Not available for this company from the current data source."
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


def compute_metric_groups(raw: RawFinancials, company_name: str) -> list[MetricGroup]:
    return [
        _liquidity_group(raw, company_name),
        _profitability_group(raw, company_name),
        _leverage_group(raw, company_name),
        _efficiency_group(raw, company_name),
        _valuation_group(raw, company_name),
    ]


def _liquidity_group(r: RawFinancials, company_name: str) -> MetricGroup:
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
    cash_ratio = _safe_div(r.cash_and_equivalents, r.current_liabilities)

    wc_status = None
    wc_assessment = None
    if working_capital is not None:
        wc_status = MetricStatus.GOOD if working_capital > 0 else MetricStatus.BAD
        wc_assessment = (
            "Current assets exceed current liabilities, meaning there's a cash cushion for "
            "day-to-day operations."
            if working_capital > 0
            else "Current liabilities exceed current assets, meaning short-term obligations "
            "outweigh short-term resources -- worth watching."
        )

    return MetricGroup(
        key="liquidity",
        label="Liquidity",
        metrics=[
            _metric(
                "current_ratio", "Current Ratio", current_ratio, "x",
                "Compares what a company owns short-term (cash, inventory, receivables) to what "
                "it owes short-term (bills, short-term debt) -- a check on whether it can cover "
                "its near-term obligations.",
                "Current Assets / Current Liabilities",
                "Healthy range is roughly 1.5x-3x; below 1x can signal short-term cash strain.",
                "A low current ratio can force a company to raise emergency cash -- through debt "
                "or selling assets at a discount -- if a large bill comes due unexpectedly.",
                company_name,
                good=1.5, warn=1.0,
            ),
            _metric(
                "quick_ratio", "Quick Ratio (Acid-Test)", quick_ratio, "x",
                "Like the current ratio, but excludes inventory, since inventory can be slow or "
                "hard to sell quickly -- a stricter test of whether short-term bills can be paid "
                "right away.",
                "(Current Assets - Inventory) / Current Liabilities",
                "Above 1x means short-term obligations are covered without selling inventory.",
                "This matters most for businesses that hold slow-moving inventory (like "
                "manufacturers), where the current ratio alone can overstate how quickly cash "
                "is really available.",
                company_name,
                good=1.0, warn=0.5,
            ),
            _metric(
                "working_capital", "Working Capital", working_capital, "INR",
                "The rupee amount left over after subtracting short-term liabilities from "
                "short-term assets -- the cash cushion available to run day-to-day operations.",
                "Current Assets - Current Liabilities",
                "Positive means current assets exceed current liabilities.",
                "A negative number here doesn't automatically mean trouble -- some large, "
                "cash-generating businesses run on negative working capital by design -- but "
                "it's worth checking why alongside the current and quick ratios.",
                company_name,
                override_status=wc_status, override_assessment=wc_assessment,
            ),
            _metric(
                "cash_ratio", "Cash Ratio", cash_ratio, "x",
                "The strictest liquidity test: can the company cover its short-term bills using "
                "only cash and cash equivalents, without collecting receivables or selling "
                "inventory?",
                "Cash & Equivalents / Current Liabilities",
                "Measures ability to cover short-term liabilities with cash alone; >0.5x is strong.",
                "This is the most conservative liquidity check, since it ignores unpaid customer "
                "bills and unsold inventory entirely -- useful for judging how a company would "
                "cope if collections suddenly slowed.",
                company_name,
                good=0.5, warn=0.2,
            ),
        ],
    )


def _profitability_group(r: RawFinancials, company_name: str) -> MetricGroup:
    gross_margin = _safe_div(r.gross_profit, r.revenue)
    operating_margin = _safe_div(r.operating_income, r.revenue)
    net_margin = _safe_div(r.net_income, r.revenue)
    avg_equity = _avg(r.total_equity, r.prior_total_equity)
    avg_assets = _avg(r.total_assets, r.prior_total_assets)
    roe = _safe_div(r.net_income, avg_equity)
    roa = _safe_div(r.net_income, avg_assets)
    capital_employed = r.capital_employed
    if capital_employed is None and r.total_assets is not None and r.current_liabilities is not None:
        capital_employed = r.total_assets - r.current_liabilities
    roce = _safe_div(r.ebit, capital_employed)

    def pct(v: Optional[float]) -> Optional[float]:
        return v * 100 if v is not None else None

    gross_margin, operating_margin, net_margin, roe, roa, roce = (
        pct(gross_margin), pct(operating_margin), pct(net_margin), pct(roe), pct(roa), pct(roce)
    )

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
                "operating_margin", "Operating Margin", operating_margin, "%",
                "The percentage of revenue left after covering both direct costs and day-to-day "
                "operating expenses, before interest and taxes -- a measure of core business "
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
                "This is the bottom line after everything -- interest, tax, one-off items -- so "
                "it can swing more than operating margin for reasons unrelated to day-to-day "
                "performance.",
                company_name,
                good=10, warn=3,
            ),
            _metric(
                "roe", "Return on Equity (ROE)", roe, "%",
                "How much profit a company generates for every rupee shareholders have invested "
                "-- a core measure of how efficiently it rewards its owners.",
                "Net Income / Average Total Equity x 100",
                "Above ~15% is generally considered strong for shareholders.",
                "A high ROE driven mainly by heavy borrowing (check Debt-to-Equity alongside "
                "this) is a different, riskier story than one driven by genuinely efficient "
                "operations.",
                company_name,
                good=15, warn=8,
            ),
            _metric(
                "roa", "Return on Assets (ROA)", roa, "%",
                "How much profit a company generates for every rupee of assets it owns, "
                "regardless of how those assets were financed.",
                "Net Income / Average Total Assets x 100",
                "Measures how efficiently assets generate profit.",
                "Comparing this to ROE shows how much of the company's returns come from "
                "leverage -- a big gap between the two usually means debt is doing a lot of "
                "the work.",
                company_name,
                good=5, warn=2,
            ),
            _metric(
                "roce", "Return on Capital Employed (ROCE)", roce, "%",
                "How efficiently a company uses all the capital invested in it -- both "
                "shareholder equity and borrowed money -- to generate profit.",
                "EBIT / (Total Assets - Current Liabilities) x 100",
                "Above ~15% suggests efficient use of both equity and debt capital.",
                "Because this includes both equity and debt in the denominator, it's a fairer "
                "efficiency comparison between companies with different capital structures than "
                "ROE alone.",
                company_name,
                good=15, warn=8,
            ),
        ],
    )


def _leverage_group(r: RawFinancials, company_name: str) -> MetricGroup:
    debt_to_equity = _safe_div(r.total_debt, r.total_equity)
    interest_coverage = _safe_div(r.ebit, r.interest_expense)
    debt_to_assets = _safe_div(r.total_debt, r.total_assets)

    return MetricGroup(
        key="leverage",
        label="Leverage / Solvency",
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
                "interest_coverage", "Interest Coverage Ratio", interest_coverage, "x",
                "How many times over a company's operating earnings could cover its interest "
                "payments -- a measure of how easily it can service its debt.",
                "EBIT / Interest Expense",
                "Below 1.5x can signal difficulty servicing debt from operating earnings.",
                "This is a more direct test of debt safety than Debt-to-Equity alone -- a "
                "company can carry a lot of debt and still be fine if its earnings comfortably "
                "cover the interest.",
                company_name,
                good=3.0, warn=1.5,
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
        ],
    )


def _efficiency_group(r: RawFinancials, company_name: str) -> MetricGroup:
    avg_assets = _avg(r.total_assets, r.prior_total_assets)
    asset_turnover = _safe_div(r.revenue, avg_assets)

    cogs = (
        r.revenue - r.gross_profit
        if r.revenue is not None and r.gross_profit is not None
        else None
    )
    avg_inventory = _avg(r.inventory, r.prior_inventory)
    inventory_turnover = _safe_div(cogs if cogs is not None else r.revenue, avg_inventory)

    avg_receivables = _avg(r.receivables, r.prior_receivables)
    receivables_turnover = _safe_div(r.revenue, avg_receivables)

    return MetricGroup(
        key="efficiency",
        label="Efficiency",
        metrics=[
            _metric(
                "asset_turnover", "Asset Turnover", asset_turnover, "x",
                "How much revenue a company generates for every rupee of assets it owns -- a "
                "measure of how productively assets are being used.",
                "Revenue / Average Total Assets",
                "Higher means more revenue generated per unit of assets; varies widely by industry.",
                "Capital-intensive businesses (like utilities or manufacturers) naturally run "
                "lower here than asset-light ones (like software) -- compare within the same "
                "industry, not across.",
                company_name,
                good=1.0, warn=0.5,
            ),
            _metric(
                "inventory_turnover", "Inventory Turnover", inventory_turnover, "x",
                "How many times a company sells and replaces its entire inventory in a year -- "
                "higher generally means inventory isn't sitting idle.",
                "COGS / Average Inventory (falls back to Revenue if COGS unavailable)",
                "Higher generally means inventory is sold and replenished more often.",
                "Slow turnover can mean unsold stock tying up cash, or an early sign of "
                "weakening demand for what the company sells.",
                company_name,
                good=6.0, warn=3.0,
            ),
            _metric(
                "receivables_turnover", "Receivables Turnover", receivables_turnover, "x",
                "How many times a year a company collects its average outstanding customer "
                "payments -- higher means customers are paying faster.",
                "Revenue / Average Receivables",
                "Higher means customer collections happen faster.",
                "A falling number over time can be an early warning that customers are taking "
                "longer to pay -- sometimes a signal of their own financial stress.",
                company_name,
                good=8.0, warn=4.0,
            ),
        ],
    )


def _valuation_group(r: RawFinancials, company_name: str) -> MetricGroup:
    pe_ratio = _safe_div(r.current_price, r.eps)
    pb_ratio = _safe_div(r.current_price, r.book_value_per_share)
    dividend_yield = _safe_div(r.dividends_per_share, r.current_price)
    dividend_yield = dividend_yield * 100 if dividend_yield is not None else None

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
                "earnings -- used to compare how \"expensive\" a stock is relative to its profits.",
                "Current Price / EPS",
                "Compare against sector peers and historical average -- context-dependent.",
                "A high P/E can mean investors expect strong future growth -- or that the stock "
                "is simply expensive relative to current earnings; it doesn't tell you which on "
                "its own.",
                company_name,
            ),
            _metric(
                "pb_ratio", "P/B Ratio", pb_ratio, "x",
                "How much investors are currently paying relative to the company's net worth "
                "(assets minus liabilities) per share.",
                "Current Price / Book Value per Share",
                "Below 1x can indicate undervaluation or underlying distress -- check further.",
                "This is most meaningful for asset-heavy businesses (like banks or "
                "manufacturers) -- less so for asset-light ones (like software) where most "
                "value isn't on the balance sheet.",
                company_name,
            ),
            _metric(
                "eps", "Earnings per Share (EPS)", r.eps, "INR",
                "The portion of a company's profit allocated to each individual share outstanding.",
                "Net Income / Shares Outstanding",
                "Net income attributable to each outstanding share.",
                "On its own this is hard to compare across companies with different share "
                "counts -- it's most useful tracked over time for the same company.",
                company_name,
            ),
            _metric(
                "dividend_yield", "Dividend Yield", dividend_yield, "%",
                "The annual dividend payment expressed as a percentage of the current share "
                "price -- a measure of cash income relative to the stock's price.",
                "Dividends per Share / Current Price x 100",
                "Annual dividend income relative to share price.",
                "A very high yield can sometimes mean the market expects a dividend cut, since "
                "yield rises automatically as a falling share price shrinks the denominator.",
                company_name,
            ),
            _metric(
                "market_cap", "Market Capitalization", r.market_cap, "INR",
                "The total market value of all a company's outstanding shares -- share price "
                "multiplied by number of shares.",
                "Current Price x Shares Outstanding",
                "Total market value of outstanding shares.",
                "This is what the market currently thinks the whole company is worth -- a "
                "starting point for classifying company size, not a judgment of value for money.",
                company_name,
            ),
        ],
    )


_GROUP_NOUNS = {
    "liquidity": "liquidity",
    "profitability": "profitability",
    "leverage": "leverage",
    "efficiency": "efficiency",
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

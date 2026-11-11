"""Research phase 4: the rule-based "In-depth analysis" section.

Fixed sentence templates and thresholds, approved by Hriday on 2026-11-11
(vault: Areas/Analysis templates (for approval).md); change only with
approval. Pure functions over numbers already on the page (history tables,
ratio tiles, the 30-day-old share price). Every sentence shows its number;
a sentence is skipped when a number it needs is missing. No AI. The peer P/E
comparison (V2) is added by the page once the peers have loaded.
"""
from datetime import date
from typing import Optional

from app.models import FinancialHistory, HistoryTable, MetricGroup
from app.services.metrics import RECEIVABLES_NA, _bench, sector_group

CR = 1e7
GROWTH_GAP = 5.0  # percentage points
MARGIN_STEP = 1.0  # percentage points
STEADY_RANGE = 2.0  # M3 needs all four quarters within this many points
CASH_GOOD, CASH_WEAK = 0.9, 0.6
DAYS_STEP = 5.0
TYPICAL = {"margin": 10.0, "turnover": 1.0, "leverage": 2.0}
ROIC_REF = 15.0
ND_MODERATE, ND_HIGH = 1.0, 3.0
COVERAGE_LOW = 3.0

SECTOR_QUESTIONS = {
    "cement": ("Will volumes keep growing after the monsoon, and can prices per tonne hold?",
               "Are fuel and freight costs per tonne rising or falling?"),
    "autos": ("What do the monthly sales releases already say about this quarter's units?",
              "Are discounts rising, which can lift units but squeeze the margin?"),
    "fmcg": ("Is growth coming from selling more packs (volume) or mostly from price increases?",
             "Are raw material costs, such as palm oil or copra, rising or easing?"),
    "it": ("Are clients in the company's main industries still spending?",
           "How much of rupee revenue growth is the currency rather than the business?"),
    "other": ("What drove revenue last quarter, and is it likely to repeat?",
              "Are costs rising faster than prices?"),
}
MAX_QUESTIONS = 4


def _indian(n: float) -> str:
    """12345678 -> "1,23,45,678" (Indian digit grouping), no decimals."""
    s = str(int(round(abs(n))))
    head, tail = s[:-3], s[-3:]
    parts = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    if head:
        parts.insert(0, head)
    return ("-" if n < 0 else "") + ",".join(parts + [tail])


def cr(v: float) -> str:
    return _indian(v / CR)


def p1(v: float) -> str:
    return f"{v:.1f}"


def a_pct(v: float) -> str:
    """"a 4.0%" / "an 8.3%": the article as the number is read aloud (eight, eleven, eighteen, eighty)."""
    n = p1(v)
    whole = n.split(".")[0]
    return f"{'an' if whole.startswith('8') or whole in ('11', '18') else 'a'} {n}%"


def x2(v: float) -> str:
    return f"{v:.2f}"


def fy(iso: str) -> str:
    return f"FY{iso[2:4]}" if iso[5:7] == "03" else f"the year to {_month(iso)}"


def _month(iso: str) -> str:
    return date.fromisoformat(iso).strftime("%b %Y")


def _day(iso: str) -> str:
    d = date.fromisoformat(iso[:10])
    return f"{d.day} {d.strftime('%b %Y')}"


def _metric_values(groups: list[MetricGroup]) -> dict:
    return {m.key: m for g in groups for m in g.metrics}


def _growth(h: FinancialHistory, out: list, shown: set):
    years = h.annual
    if len(years) < 2 or years[0].revenue is None or years[1].revenue is None:
        return
    y0, y1 = years[0], years[1]
    g1 = (y0.revenue / y1.revenue - 1) * 100 if y1.revenue > 0 else None
    cagr3 = None
    if len(years) >= 4 and years[3].revenue and years[3].revenue > 0 and y0.revenue > 0:
        y3 = years[3]
        cagr3 = ((y0.revenue / y3.revenue) ** (1 / 3) - 1) * 100
        if cagr3 >= 0:
            out.append(("G1", f"Revenue grew {p1(cagr3)}% a year over the last three years, from ₹{cr(y3.revenue)} cr "
                              f"in {fy(y3.period_end_date)} to ₹{cr(y0.revenue)} cr in {fy(y0.period_end_date)}."))
        else:
            out.append(("G1b", f"Revenue shrank {p1(abs(cagr3))}% a year over the last three years, from "
                               f"₹{cr(y3.revenue)} cr in {fy(y3.period_end_date)} to ₹{cr(y0.revenue)} cr in "
                               f"{fy(y0.period_end_date)}."))
    if g1 is not None and cagr3 is not None:
        if g1 >= cagr3 + GROWTH_GAP:
            out.append(("G2", f"In {fy(y0.period_end_date)} revenue grew {p1(g1)}%, faster than its three-year pace of "
                              f"{p1(cagr3)}%, which suggests growth picked up last year."))
        elif g1 <= cagr3 - GROWTH_GAP:
            out.append(("G3", f"In {fy(y0.period_end_date)} revenue grew {p1(g1)}%, slower than its three-year pace of "
                              f"{p1(cagr3)}%, which suggests growth slowed last year."))
            shown.add(("G3", p1(g1), p1(cagr3)))
    # Guard (2026-11-11): only for a profit. On a loss, a tax credit makes the
    # net loss smaller than the pre-tax loss, which is not a one-off gain.
    one_off = (y0.net_income is not None and y0.pretax_income is not None and y0.pretax_income > 0
               and y0.net_income > y0.pretax_income)
    if one_off:
        out.append(("G6", f"Net profit (₹{cr(y0.net_income)} cr) was higher than profit before tax "
                          f"(₹{cr(y0.pretax_income)} cr), which usually points to a one-off gain, such as from selling "
                          f"a business. Check the notes in the results before reading too much into profit growth."))
        shown.add(("G6",))
    if g1 is not None and y0.net_income is not None and y1.net_income and y1.net_income > 0:
        np_g = (y0.net_income / y1.net_income - 1) * 100
        if np_g - g1 >= GROWTH_GAP and not one_off:
            out.append(("G4", f"Net profit grew faster than revenue ({p1(np_g)}% against {p1(g1)}%), so more of each "
                              f"rupee of sales became profit."))
        elif np_g - g1 <= -GROWTH_GAP:
            out.append(("G5", f"Net profit grew more slowly than revenue ({p1(np_g)}% against {p1(g1)}%), so less of "
                              f"each rupee of sales became profit."))


def _margins(table: HistoryTable, m: dict, sg: str, out: list, shown: set):
    quarters = [q for q in table.quarterly if q.ebitda_margin_pct is not None][:4]
    if len(quarters) >= 3:
        last, first = quarters[0], quarters[-1]
        change = last.ebitda_margin_pct - first.ebitda_margin_pct
        if change >= MARGIN_STEP:
            out.append(("M1", f"EBITDA margin rose from {p1(first.ebitda_margin_pct)}% in {_month(first.period_end_date)} "
                              f"to {p1(last.ebitda_margin_pct)}% in {_month(last.period_end_date)}."))
        elif change <= -MARGIN_STEP:
            out.append(("M2", f"EBITDA margin fell from {p1(first.ebitda_margin_pct)}% in {_month(first.period_end_date)} "
                              f"to {p1(last.ebitda_margin_pct)}% in {_month(last.period_end_date)}."))
            shown.add(("M2", p1(first.ebitda_margin_pct), p1(last.ebitda_margin_pct)))
        elif len(quarters) == 4 and max(q.ebitda_margin_pct for q in quarters) \
                - min(q.ebitda_margin_pct for q in quarters) <= STEADY_RANGE:
            # Guard: "steady" only when all four quarters sit close together.
            values = [q.ebitda_margin_pct for q in quarters]
            out.append(("M3", f"EBITDA margin held roughly steady over the last four quarters, between "
                              f"{p1(min(values))}% and {p1(max(values))}%."))
    if len(table.annual) >= 2 and table.annual[0].ebitda_margin_pct is not None \
            and table.annual[1].ebitda_margin_pct is not None:
        y0, y1 = table.annual[0], table.annual[1]
        change = y0.ebitda_margin_pct - y1.ebitda_margin_pct
        if abs(change) >= MARGIN_STEP:
            out.append(("M4", f"For the full year, EBITDA margin {'rose' if change > 0 else 'fell'} from "
                              f"{p1(y1.ebitda_margin_pct)}% in {fy(y1.period_end_date)} to {p1(y0.ebitda_margin_pct)}% "
                              f"in {fy(y0.period_end_date)}."))
            if sg != "financial":
                good, warn, sector_name = _bench("ebitda_margin", sg)
                where = "above" if y0.ebitda_margin_pct >= good else "within" if y0.ebitda_margin_pct >= warn else "below"
                out.append(("M5", f"That is {where} the range that is usual for {sector_name} ({good:.0f}% or more is "
                                  f"strong, under {warn:.0f}% is weak)."))


def _cash(h: FinancialHistory, m: dict, out: list, shown: set):
    y0 = h.annual[0] if h.annual else None
    if y0 is None:
        return
    when = fy(y0.period_end_date)
    cc = m.get("cash_conversion")
    if cc is not None and cc.value is not None:
        v = cc.value
        if v >= CASH_GOOD:
            out.append(("C1", f"Profits appear to be backed by cash: operating cash flow was {x2(v)}x net profit in {when}."))
        elif v >= CASH_WEAK:
            out.append(("C2", f"Only part of the profit turned into cash ({x2(v)}x net profit in {when}), which may mean "
                              f"money is tied up in unpaid bills or stock."))
        else:
            out.append(("C3", f"Operating cash flow was well below profit ({x2(v)}x net profit in {when}), so it is "
                              f"worth checking working capital in the results."))
    if y0.operating_cash_flow is None or y0.capital_expenditure is None:
        return
    fcf = y0.operating_cash_flow - y0.capital_expenditure
    if fcf < 0:
        out.append(("C4", f"Capital spending (₹{cr(y0.capital_expenditure)} cr) was larger than operating cash flow "
                          f"(₹{cr(y0.operating_cash_flow)} cr), so free cash flow was negative. That is common while a "
                          f"company builds new capacity, but the gap has to be funded from savings or borrowing."))
        shown.add(("C4", cr(y0.capital_expenditure)))
    elif fcf > 0 and m.get("payout_ratio") and m["payout_ratio"].value is not None and y0.dividends_paid is not None:
        out.append(("C5", f"After capital spending, ₹{cr(fcf)} cr of free cash flow was left, and the company paid "
                          f"₹{cr(y0.dividends_paid)} cr in dividends during the year."))


def _days(balance: Optional[float], revenue: Optional[float]) -> Optional[float]:
    if balance is None or not revenue:
        return None
    return balance / revenue * 365


def _working_capital(h: FinancialHistory, m: dict, out: list, shown: set):
    if len(h.annual) < 2:
        return
    y0, y1 = h.annual[0], h.annual[1]
    debtor_now = m.get("debtor_days")
    usable = debtor_now is not None and debtor_now.value is not None and debtor_now.assessment != RECEIVABLES_NA
    if usable and not (y1.other_receivables is not None and y1.receivables is not None
                       and y1.other_receivables > y1.receivables):
        d0, d1 = debtor_now.value, _days(y1.receivables, y1.revenue)
        if d1 is not None:
            if d0 - d1 >= DAYS_STEP:
                out.append(("W1", f"Debtor days rose from {d1:.0f} to {d0:.0f}, which suggests customers are taking "
                                  f"longer to pay."))
                shown.add(("W1", f"{d0:.0f}"))
            elif d1 - d0 >= DAYS_STEP:
                out.append(("W2", f"Debtor days fell from {d1:.0f} to {d0:.0f}, which suggests customers are paying faster."))
    inv_now = m.get("inventory_days")
    if inv_now is not None and inv_now.value is not None:
        i0, i1 = inv_now.value, _days(y1.inventory, y1.revenue)
        if i1 is not None:
            if i0 - i1 >= DAYS_STEP:
                out.append(("W3", f"Stock rose from {i1:.0f} to {i0:.0f} days of revenue, which may mean goods are "
                                  f"building up faster than they sell."))
            elif i1 - i0 >= DAYS_STEP:
                out.append(("W4", f"Stock fell from {i1:.0f} to {i0:.0f} days of revenue, which suggests goods are "
                                  f"moving out faster."))


def _returns(m: dict, out: list):
    dupont = m.get("dupont_roe")
    if dupont is not None and dupont.value is not None and dupont.parts:
        parts = {p.label: p.value for p in dupont.parts}
        margin, turn, lev = parts.get("Margin"), parts.get("Turnover"), parts.get("Leverage")
        # Guard: "comes mainly from" means nothing for a zero or negative ROE.
        if None not in (margin, turn, lev) and dupont.value > 0:
            roe = p1(dupont.value)
            scores = {"margin": margin / TYPICAL["margin"], "turnover": turn / TYPICAL["turnover"],
                      "leverage": lev / TYPICAL["leverage"]}
            main, score = max(scores.items(), key=lambda kv: kv[1])
            if score <= 1:
                out.append(("R4", f"ROE of {roe}% reflects {a_pct(margin)} net margin, asset turnover of {x2(turn)}x and "
                                  f"leverage of {x2(lev)}x, with no single part standing out."))
            elif main == "margin":
                out.append(("R1", f"ROE of {roe}% comes mainly from a high profit margin ({p1(margin)}% net margin), "
                                  f"with asset turnover of {x2(turn)}x and leverage of {x2(lev)}x."))
            elif main == "turnover":
                out.append(("R2", f"ROE of {roe}% comes mainly from using its assets intensively (asset turnover of "
                                  f"{x2(turn)}x), with {a_pct(margin)} net margin and leverage of {x2(lev)}x."))
            else:
                out.append(("R3", f"ROE of {roe}% comes mainly from borrowing (leverage of {x2(lev)}x), with "
                                  f"{a_pct(margin)} net margin and asset turnover of {x2(turn)}x. Returns built on debt "
                                  f"can fall faster if profits drop."))
    roic = m.get("roic")
    if roic is not None and roic.value is not None:
        out.append(("R5", f"Return on invested capital was {p1(roic.value)}%, "
                          f"{'above' if roic.value >= ROIC_REF else 'below'} the 15% often seen as a sign of a business "
                          f"that earns well on its capital."))


def _debt(m: dict, out: list):
    nd = m.get("net_debt")
    nde = m.get("net_debt_to_ebitda")
    if nd is not None and nd.value is not None:
        if nd.value <= 0:
            out.append(("D1", f"The company holds more cash and short-term investments than debt (net cash of "
                              f"₹{cr(-nd.value)} cr)."))
        elif nde is not None and nde.value is not None:
            if nde.value > ND_HIGH:
                out.append(("D3", f"Net debt was {x2(nde.value)}x a year's EBITDA, which is high: a fall in profit may "
                                  f"make the debt harder to service."))
            elif nde.value >= ND_MODERATE:
                out.append(("D2", f"Net debt was {x2(nde.value)}x a year's EBITDA, a moderate level."))
    ic = m.get("interest_coverage")
    if ic is not None and ic.value is not None and ic.value < COVERAGE_LOW:
        out.append(("D4", f"Operating profit covered interest only {x2(ic.value)}x, so interest takes a large share of profit."))


def _valuation(m: dict, price_as_of: Optional[str], out: list):
    pe = m.get("pe_ratio")
    # Guard: a negative P/E (a loss) is not a valuation multiple.
    if pe is not None and pe.value is not None and pe.value > 0 and price_as_of:
        out.append(("V1", f"At the share price on {_day(price_as_of)} (at least 30 days old), the shares traded at "
                          f"{p1(pe.value)}x the last twelve months' earnings."))


def _questions(shown: set, sector: str) -> list[tuple[str, str]]:
    triggered = []
    for item in sorted(shown, key=lambda t: ["M2", "G3", "W1", "C4", "G6"].index(t[0])):
        tag = item[0]
        if tag == "M2":
            triggered.append(("Q1", f"Margin fell from {item[1]}% to {item[2]}% over recent quarters: will costs keep "
                                    f"rising, or can price increases catch up?"))
        elif tag == "G3":
            triggered.append(("Q2", f"Growth slowed to {item[1]}% last year from a {item[2]}% pace: is demand slowing, or "
                                    f"was the year before unusually strong?"))
        elif tag == "W1":
            triggered.append(("Q3", f"Debtor days rose to {item[1]}: are customers paying more slowly, and could that "
                                    f"squeeze cash?"))
        elif tag == "C4":
            triggered.append(("Q4", f"Free cash flow was negative after ₹{item[1]} cr of capital spending: when might the "
                                    f"new capacity start adding sales?"))
        elif tag == "G6":
            triggered.append(("Q5", "Last year's profit included what looks like a one-off: what would profit growth be "
                                    "without it?"))
    standing = [(f"S{i + 1}", q) for i, q in enumerate(SECTOR_QUESTIONS.get(sector, SECTOR_QUESTIONS["other"]))]
    return (triggered + standing)[:MAX_QUESTIONS]


SECTIONS = (("growth", "Growth"), ("margins", "Margins"), ("cash", "Cash"), ("working_capital", "Working capital"),
            ("returns", "Returns"), ("debt", "Debt"), ("valuation", "Valuation"))


def build_analysis(history: Optional[FinancialHistory], table: Optional[HistoryTable], groups: list[MetricGroup],
                   sector: Optional[str], industry: Optional[str], price_as_of: Optional[str]) -> dict:
    """{"sections": [{key, title, sentences: [{id, text}]}], "questions": [{id, text}], "pe": positive P/E or None}."""
    m = _metric_values(groups)
    sg = sector_group(sector, industry)
    shown: set = set()
    per: dict[str, list] = {k: [] for k, _ in SECTIONS}
    if history is not None:
        _growth(history, per["growth"], shown)
        if sg != "financial":
            _cash(history, m, per["cash"], shown)
            _working_capital(history, m, per["working_capital"], shown)
    if table is not None:
        _margins(table, m, sg, per["margins"], shown)
    _returns(m, per["returns"])
    _debt(m, per["debt"])
    _valuation(m, price_as_of, per["valuation"])
    question_sector = sg if sg in SECTOR_QUESTIONS else "other"
    return {
        "sections": [{"key": k, "title": t, "sentences": [{"id": i, "text": s} for i, s in per[k]]}
                     for k, t in SECTIONS if per[k]],
        "questions": [{"id": i, "text": q} for i, q in _questions(shown, question_sector)],
        "pe": m["pe_ratio"].value if m.get("pe_ratio") and (m["pe_ratio"].value or 0) > 0 else None,
    }

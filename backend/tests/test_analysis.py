"""Phase 4 analysis (services/analysis.py): every approved template and the
guards that stop a sentence from saying something false. Pure, no database."""
from datetime import date

from app.models import (
    FinancialHistory,
    FinancialQuarter,
    FinancialYear,
    HistoryRow,
    HistoryTable,
    Metric,
    MetricGroup,
    MetricPart,
)
from app.services.analysis import _indian, a_pct, build_analysis
from app.services.metrics import RECEIVABLES_NA

CR = 1e7


def year(end, **kw):
    return FinancialYear(period_end_date=end, **{k: v * CR if k != "eps_diluted" else v for k, v in kw.items()})


def metrics(**values):
    ms = []
    for key, v in values.items():
        if key == "dupont":
            roe, margin, turn, lev = v
            ms.append(Metric(key="dupont_roe", label="", value=roe, parts=[
                MetricPart(label="Margin", value=margin, unit="%"), MetricPart(label="Turnover", value=turn, unit="x"),
                MetricPart(label="Leverage", value=lev, unit="x")]))
        elif isinstance(v, tuple):  # (value, assessment)
            ms.append(Metric(key=key, label="", value=v[0], assessment=v[1]))
        else:
            ms.append(Metric(key=key, label="", value=v))
    return [MetricGroup(key="all", label="", metrics=ms)]


def table(quarters=(), years=()):
    return HistoryTable(
        quarterly=[HistoryRow(period_end_date=d, ebitda_margin_pct=m) for d, m in quarters],
        annual=[HistoryRow(period_end_date=d, ebitda_margin_pct=m) for d, m in years],
    )


def ids(result):
    return [s["id"] for sec in result["sections"] for s in sec["sentences"]]


def text(result, sid):
    return next(s["text"] for sec in result["sections"] for s in sec["sentences"] if s["id"] == sid)


def run(h=None, t=None, m=None, sector="Consumer Cyclical", industry="Auto Manufacturers", price="2026-10-10"):
    return build_analysis(h, t, m or metrics(), sector, industry, price)


GROWING = FinancialHistory(annual=[
    year("2026-03-31", revenue=177094, net_income=14680, pretax_income=19118, operating_cash_flow=19100,
         capital_expenditure=10398, dividends_paid=4244, receivables=5342, inventory=11321),
    year("2025-03-31", revenue=147469, net_income=14500, receivables=6540, inventory=6913),
    year("2024-03-31", revenue=140933),
    year("2023-03-31", revenue=113765),
])


def test_indian_grouping():
    assert _indian(177094) == "1,77,094" and _indian(999) == "999" and _indian(12345678) == "1,23,45,678"


def test_article_before_a_percentage():
    assert a_pct(8.3) == "an 8.3%" and a_pct(11.0) == "an 11.0%" and a_pct(18.4) == "an 18.4%"
    assert a_pct(84.0) == "an 84.0%" and a_pct(4.0) == "a 4.0%" and a_pct(1.5) == "a 1.5%" and a_pct(110.0) == "a 110.0%"


def test_growth_sentences():
    r = run(GROWING)
    assert ids(r)[:2] == ["G1", "G5"]
    assert text(r, "G1") == ("Revenue grew 15.9% a year over the last three years, from ₹1,13,765 cr in FY23 to "
                             "₹1,77,094 cr in FY26.")
    assert "1.2% against 20.1%" in text(r, "G5")


def test_shrinking_and_speeding_up():
    h = FinancialHistory(annual=[year("2026-03-31", revenue=90), year("2025-03-31", revenue=70),
                                 year("2024-03-31", revenue=100), year("2023-03-31", revenue=120)])
    r = run(h)
    assert "G1b" in ids(r) and "G2" in ids(r)


def test_slowdown_triggers_question():
    h = FinancialHistory(annual=[year("2026-03-31", revenue=101), year("2025-03-31", revenue=100),
                                 year("2024-03-31", revenue=80), year("2023-03-31", revenue=60)])
    r = run(h)
    assert "G3" in ids(r) and r["questions"][0]["id"] == "Q2"


def test_one_off_gain_only_on_a_profit():
    profit = FinancialHistory(annual=[year("2026-03-31", revenue=110, net_income=239, pretax_income=181),
                                      year("2025-03-31", revenue=100, net_income=120)])
    assert "G6" in ids(run(profit)) and "G4" not in ids(run(profit))
    loss = FinancialHistory(annual=[year("2026-03-31", revenue=110, net_income=-11, pretax_income=-123),
                                    year("2025-03-31", revenue=100, net_income=-200)])
    assert "G6" not in ids(run(loss))


def test_margins_quarterly_and_annual():
    falling = table([("2026-09-30", 9.1), ("2026-06-30", 8.3), ("2026-03-31", 11.9), ("2025-12-31", 11.7)],
                    [("2026-03-31", 12.2), ("2025-03-31", 13.7)])
    r = run(t=falling)
    assert text(r, "M2") == "EBITDA margin fell from 11.7% in Dec 2025 to 9.1% in Sep 2026."
    assert "M4" in ids(r) and text(r, "M5").startswith("That is above the range that is usual for vehicle makers")
    assert r["questions"][0]["id"] == "Q1"
    steady = table([("2026-09-30", 10.2), ("2026-06-30", 10.8), ("2026-03-31", 9.9), ("2025-12-31", 10.0)])
    assert "M3" in ids(run(t=steady))
    wide = table([("2026-09-30", 10.4), ("2026-06-30", 6.4), ("2026-03-31", 8.0), ("2025-12-31", 10.0)])
    assert not {"M1", "M2", "M3"} & set(ids(run(t=wide)))


def test_cash_sentences():
    assert "C1" in ids(run(GROWING, m=metrics(cash_conversion=1.3, payout_ratio=28.9)))
    assert "C5" in ids(run(GROWING, m=metrics(cash_conversion=1.3, payout_ratio=28.9)))
    assert "C2" in ids(run(GROWING, m=metrics(cash_conversion=0.7)))
    assert "C3" in ids(run(GROWING, m=metrics(cash_conversion=0.5)))
    capex = FinancialHistory(annual=[year("2026-03-31", revenue=100, operating_cash_flow=216, capital_expenditure=423),
                                     year("2025-03-31", revenue=90)])
    r = run(capex)
    assert "C4" in ids(r) and any(q["id"] == "Q4" for q in r["questions"])


def test_working_capital_days():
    r = run(GROWING, m=metrics(debtor_days=11.0, inventory_days=23.3))
    assert text(r, "W2") == "Debtor days fell from 16 to 11, which suggests customers are paying faster."
    assert "W3" in ids(r)
    withheld = run(GROWING, m=metrics(debtor_days=(None, RECEIVABLES_NA)))
    assert not {"W1", "W2"} & set(ids(withheld))


def test_dupont_drivers_and_guard():
    assert "R1" in ids(run(m=metrics(dupont=(21.1, 21.0, 0.79, 1.27))))
    assert "with an 8.3% net margin" in text(run(m=metrics(dupont=(14.4, 8.3, 1.27, 1.38))), "R2")
    assert "R3" in ids(run(m=metrics(dupont=(18.0, 4.0, 1.0, 4.5))))
    assert "R4" in ids(run(m=metrics(dupont=(9.0, 6.0, 0.9, 1.6))))
    assert not {"R1", "R2", "R3", "R4"} & set(ids(run(m=metrics(dupont=(-0.6, -0.4, 0.59, 2.38)))))
    assert "below the 15%" in text(run(m=metrics(roic=10.6)), "R5")


def test_debt_sentences():
    assert "net cash of ₹17,222 cr" in text(run(m=metrics(net_debt=-17222 * CR)), "D1")
    assert "D2" in ids(run(m=metrics(net_debt=10 * CR, net_debt_to_ebitda=2.0)))
    assert "D3" in ids(run(m=metrics(net_debt=10 * CR, net_debt_to_ebitda=5.92)))
    assert "D4" in ids(run(m=metrics(interest_coverage=0.26)))
    assert not {"D2", "D3"} & set(ids(run(m=metrics(net_debt=10 * CR, net_debt_to_ebitda=0.5))))


def test_valuation_only_for_a_positive_pe():
    r = run(m=metrics(pe_ratio=30.8))
    assert text(r, "V1") == ("At the share price on 10 Oct 2026 (at least 30 days old), the shares traded at 30.8x the "
                             "last twelve months' earnings.")
    assert r["pe"] == 30.8
    neg = run(m=metrics(pe_ratio=-42.7))
    assert "V1" not in ids(neg) and neg["pe"] is None


def test_questions_capped_at_four_and_sector_standing():
    r = run(sector="Basic Materials", industry="Building Materials")
    assert [q["id"] for q in r["questions"]] == ["S1", "S2"]
    assert r["questions"][0]["text"].startswith("Will volumes keep growing")
    other = run(sector="Healthcare", industry="Drug Manufacturers")
    assert other["questions"][0]["text"].startswith("What drove revenue")


def test_banks_skip_cash_and_working_capital():
    r = run(GROWING, m=metrics(cash_conversion=1.3, debtor_days=11.0), sector="Financial Services",
            industry="Banks - Regional")
    assert not {"C1", "W2"} & set(ids(r))


def test_copy_rules_in_every_sentence():
    r = run(GROWING, table([("2026-09-30", 9.1), ("2026-06-30", 8.3), ("2026-03-31", 11.9), ("2025-12-31", 11.7)],
                           [("2026-03-31", 12.2), ("2025-03-31", 13.7)]),
            metrics(cash_conversion=1.3, payout_ratio=28.9, debtor_days=11.0, inventory_days=23.3,
                    dupont=(14.4, 8.3, 1.27, 1.38), roic=10.6, net_debt=-1 * CR, pe_ratio=30.8))
    lines = [s["text"] for sec in r["sections"] for s in sec["sentences"]] + [q["text"] for q in r["questions"]]
    assert len(lines) > 10
    for line in lines:
        assert "—" not in line and " -- " not in line and "!" not in line

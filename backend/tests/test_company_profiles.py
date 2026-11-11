"""Approved profile data (company_profiles.py): pure checks, no database."""
import pytest

from app import company_profiles as cp

# Filed FY26 revenue from operations (Rs crore), from each audited results filing.
FILED_REVENUE = {"ESCORTS": 11540.26, "MARICO": 13611.0, "DABUR": 13192.57, "JYOTHYLAB": 2944.29, "MPHASIS": 15879.65}


@pytest.mark.parametrize("ticker,revenue", FILED_REVENUE.items())
def test_segments_add_up_to_filed_revenue(ticker, revenue):
    assert round(sum(s.revenue_cr for s in cp.PROFILES[ticker].segments), 2) == revenue


def test_single_business_companies_have_a_note_and_no_split():
    for t in ("MARUTI", "SAGCEM"):
        p = cp.PROFILES[t]
        assert p.single_business and not p.segments and p.segment_note


def test_never_links_marico_bangladesh_report():
    for p in cp.PROFILES.values():
        assert "investorspdf/Annual_Report_2025-26" not in (p.annual_report_url or "")
    assert cp.PROFILES["MARICO"].annual_report_url is None


def test_peers_exclude_self_and_cap_at_five():
    assert "DABUR.NS" not in cp.peers_for("DABUR.NS", "fmcg")
    assert cp.peers_for("MPHASIS.NS", "it") == ["COFORGE.NS", "PERSISTENT.NS", "HEXT.NS", "TECHM.NS"]
    assert cp.peers_for("TECHM.NS", "it") == ["COFORGE.NS", "PERSISTENT.NS", "HEXT.NS", "MPHASIS.NS"]
    assert cp.peers_for("RELIANCE.NS", None) == []
    assert all(len(cp.peers_for(f"{t}.NS", None)) <= 5 for t in cp.PROFILES)


def test_every_company_has_an_investor_relations_link():
    assert all(p.ir_url and p.ir_url.startswith("https://") for p in cp.PROFILES.values())

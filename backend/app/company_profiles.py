"""Approved profile data for the Research page (phase 3).

Segments, investor-relations and annual-report links for the pilot
companies were researched from official filings and company sites and
approved by Hriday on 2026-11-10 (vault: Areas/Pilot Companies.md). Change
them only with approval, like league_config.py. Peers are chosen per company
for the pilot set and per sector otherwise; every symbol was checked live on
Yahoo (2026-11-10; LTIM.NS was dead and left out).
"""
from dataclasses import dataclass, field
from typing import Optional


@dataclass(frozen=True)
class Segment:
    label: str
    revenue_cr: float


@dataclass(frozen=True)
class CompanyProfile:
    ticker: str
    # Either segments, or single_business=True with the note saying so.
    segments: tuple[Segment, ...] = ()
    single_business: bool = False
    segment_note: Optional[str] = None
    segment_period: str = "FY26 (year to 31 Mar 2026)"
    segment_source_url: Optional[str] = None
    ir_url: Optional[str] = None
    annual_report_url: Optional[str] = None
    annual_report_label: Optional[str] = None
    peers: tuple[str, ...] = field(default_factory=tuple)


PROFILES: dict[str, CompanyProfile] = {p.ticker: p for p in (
    CompanyProfile(
        "MARUTI", single_business=True,
        segment_note="Maruti reports one business: making and selling cars, parts and accessories. Its other "
                     "activities (servicing, pre-owned cars, fleet and car finance) are small next to it.",
        segment_source_url="https://nsearchives.nseindia.com/corporate/MARUTI_28042026144002_STxIntimation_QuickResults_31Mar2026.pdf",
        ir_url="https://www.marutisuzuki.com/corporate/investors",
        peers=("HYUNDAI.NS", "M&M.NS", "TMPV.NS"),
    ),
    CompanyProfile(
        "SAGCEM", single_business=True,
        segment_note="Sagar reports one business: making and selling cement and cement-related products.",
        segment_source_url="https://nsearchives.nseindia.com/corporate/SAGCEM_13052026210455_SclNsEBsELetters13052026Reg33signed.pdf",
        ir_url="https://sagarcements.in/investors/overview",
        annual_report_url="https://sagarcements.in/wp-content/uploads/2026/05/SCL-45th-Integrated-Report-2025-2026.pdf",
        annual_report_label="45th Integrated Report 2025-26",
        peers=("ULTRACEMCO.NS", "SHREECEM.NS", "DALBHARAT.NS", "RAMCOCEM.NS", "JKLAKSHMI.NS"),
    ),
    CompanyProfile(
        "ESCORTS",
        segments=(Segment("Agri machinery", 9841.19), Segment("Construction equipment", 1685.92),
                  Segment("Unallocated", 13.15)),
        segment_note="Excludes the railway business, which was sold during the year (discontinued).",
        segment_source_url="https://nsearchives.nseindia.com/corporate/ixbrl/INTEGRATED_FILING_INDAS_156067_07052026183412_iXBRL_WEB.html",
        ir_url="https://www.escortskubota.com/investors",
        peers=("M&M.NS", "VSTTILLERS.NS", "ACE.NS"),
    ),
    CompanyProfile(
        "MARICO",
        segments=(Segment("India", 10348.0), Segment("International", 3263.0)),
        segment_source_url="https://nsearchives.nseindia.com/corporate/ixbrl/INTEGRATED_FILING_INDAS_155723_05052026230618_iXBRL_WEB.html",
        # The site's obvious annual-report PDF is Marico Bangladesh's, not Marico Limited's: never link it.
        ir_url="https://marico.com/india/investors",
        peers=("HINDUNILVR.NS", "GODREJCP.NS", "DABUR.NS", "EMAMILTD.NS", "JYOTHYLAB.NS"),
    ),
    CompanyProfile(
        "DABUR",
        segments=(Segment("Consumer care", 10864.07), Segment("Food", 2015.55), Segment("Retail", 106.56),
                  Segment("Other", 167.48), Segment("Unallocated", 38.91)),
        segment_source_url="https://nsearchives.nseindia.com/corporate/ixbrl/INTEGRATED_FILING_INDAS_156029_07052026173844_iXBRL_WEB.html",
        ir_url="https://www.dabur.com/investor",
        annual_report_url="https://www.dabur.com/digital-annual-report-2025-26/index.php",
        annual_report_label="Digital annual report 2025-26",
        peers=("HINDUNILVR.NS", "GODREJCP.NS", "MARICO.NS", "EMAMILTD.NS", "JYOTHYLAB.NS"),
    ),
    CompanyProfile(
        "JYOTHYLAB",
        segments=(Segment("Fabric care", 1345.88), Segment("Dishwashing", 959.31), Segment("Personal care", 320.84),
                  Segment("Household insecticides", 196.04), Segment("Others", 122.22)),
        segment_note="Standalone figures: Jyothy has had no subsidiaries since March 2025.",
        segment_source_url="https://www.jyothylabs.com/wp-content/uploads/2026/05/SE_Intimation_Outcome.pdf",
        ir_url="https://www.jyothylabs.com/investor/announcements/",
        peers=("HINDUNILVR.NS", "GODREJCP.NS", "DABUR.NS", "MARICO.NS", "EMAMILTD.NS"),
    ),
    CompanyProfile(
        "MPHASIS",
        segments=(Segment("Banking and financial services", 8378.61), Segment("Technology, media and telecom", 2869.64),
                  Segment("Insurance", 2344.38), Segment("Logistics and transportation", 871.88),
                  Segment("Others", 1545.62), Segment("Currency hedges", -130.48)),
        segment_note="Mphasis splits revenue by the industries its clients are in, not by product. "
                     "Currency hedges reduced reported revenue slightly.",
        segment_source_url="https://nsearchives.nseindia.com/corporate/ixbrl/INTEGRATED_FILING_INDAS_154491_29042026235749_iXBRL_WEB.html",
        ir_url="https://www.mphasis.com/home/corporate/investors.html",
        annual_report_url="https://www.mphasis.com/content/dam/mphasis-com/global/en/investors/annual-reports/2026/mphasis-annual-report-2026.pdf",
        annual_report_label="Annual report 2025-26",
        peers=("COFORGE.NS", "PERSISTENT.NS", "HEXT.NS", "TECHM.NS"),
    ),
)}

# Peers for any other company in the league's four sectors.
SECTOR_PEERS: dict[str, tuple[str, ...]] = {
    "cement": ("ULTRACEMCO.NS", "SHREECEM.NS", "AMBUJACEM.NS", "DALBHARAT.NS", "RAMCOCEM.NS"),
    "autos": ("MARUTI.NS", "M&M.NS", "TMPV.NS", "HYUNDAI.NS", "BAJAJ-AUTO.NS"),
    "fmcg": ("HINDUNILVR.NS", "GODREJCP.NS", "DABUR.NS", "MARICO.NS", "EMAMILTD.NS"),
    "it": ("TECHM.NS", "COFORGE.NS", "PERSISTENT.NS", "HEXT.NS", "MPHASIS.NS"),
}


def profile_for(symbol: str) -> Optional[CompanyProfile]:
    return PROFILES.get(symbol.split(".")[0].upper())


def peers_for(symbol: str, sector: Optional[str]) -> list[str]:
    """Up to five peer symbols, never the company itself."""
    p = profile_for(symbol)
    chosen = list(p.peers) if p and p.peers else list(SECTOR_PEERS.get(sector or "", ()))
    return [s for s in chosen if s.upper() != symbol.upper()][:5]

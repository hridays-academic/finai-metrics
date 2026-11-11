"""The Research page's profile block (phase 3): what the company does, its
segments, official documents and peers. Approved data comes from
company_profiles.py and league_config.py; Yahoo supplies the rest, labelled.
"""
from datetime import date
from typing import Optional

import psycopg

from app import company_profiles, league_config
from app.models import CompanyInfo, CompanyProfileOut, DocumentLink, SegmentOut
from app.news_config import NEWS_SECTORS
from app.services.metrics import sector_group

# Filings worth listing as documents, newest of each kind.
_DOCUMENT_TYPES = {"results": "Latest results", "commentary": "Latest presentation or call transcript"}


def build_profile(conn: psycopg.Connection, info: CompanyInfo, today: date) -> CompanyProfileOut:
    symbol = info.resolved_symbol
    ticker = symbol.split(".")[0].upper()
    company = conn.execute(
        "SELECT id, description FROM companies WHERE provider_symbol = %s ORDER BY is_demo LIMIT 1", (symbol,)
    ).fetchone()

    description, source = None, None
    approved = (company["description"] if company else None) or \
        league_config.market_config("IN").company_descriptions.get(ticker)
    if approved:
        description, source = approved, "Stackly"
    elif info.summary:
        description, source = info.summary, "Yahoo Finance"

    next_results: Optional[str] = None
    if company:
        row = conn.execute(
            "SELECT min(e.results_date) AS d FROM forecast_events e JOIN fiscal_periods p ON p.id = e.period_id "
            "WHERE p.company_id = %s AND e.results_date >= %s AND e.status <> 'draft'", (company["id"], today),
        ).fetchone()
        next_results = row["d"].isoformat() if row and row["d"] else None

    p = company_profiles.profile_for(symbol)
    segments: list[SegmentOut] = []
    if p and p.segments:
        total = sum(s.revenue_cr for s in p.segments)
        segments = [SegmentOut(label=s.label, revenue_cr=s.revenue_cr, share_pct=round(s.revenue_cr / total * 100, 1))
                    for s in p.segments]

    documents: list[DocumentLink] = []
    if p and p.ir_url:
        documents.append(DocumentLink(label="Investor relations", url=p.ir_url, source="Company website"))
    if p and p.annual_report_url:
        documents.append(DocumentLink(label=p.annual_report_label or "Annual report", url=p.annual_report_url,
                                      source="Company website"))
    if company:
        for key, label in _DOCUMENT_TYPES.items():
            f = conn.execute(
                "SELECT url, subject, filed_at FROM exchange_filings WHERE company_id = %s AND event_type = %s "
                "ORDER BY filed_at DESC LIMIT 1", (company["id"], key),
            ).fetchone()
            if f:
                documents.append(DocumentLink(label=f"{label}: {f['subject']}", url=f["url"],
                                              date=f["filed_at"].date().isoformat(), source="NSE filing"))
    documents.append(DocumentLink(
        label="All exchange filings", source="NSE",
        url=f"https://www.nseindia.com/get-quotes/equity?symbol={ticker}"))

    sg = sector_group(info.sector, info.industry)
    hq = ", ".join(x for x in (info.city, info.country) if x) or None
    return CompanyProfileOut(
        description=description, description_source=source, headquarters=hq, website=info.website,
        employees=info.employees, next_results_date=next_results,
        single_business=bool(p and p.single_business), segments=segments,
        segment_note=p.segment_note if p else None,
        segment_period=p.segment_period if p and (p.segments or p.single_business) else None,
        segment_source_url=p.segment_source_url if p else None,
        documents=documents,
        peers=company_profiles.peers_for(symbol, sg if sg in NEWS_SECTORS else None),
    )

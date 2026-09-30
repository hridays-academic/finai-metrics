"""
Data for the forecast page's research table: yfinance's recent quarters
(cached, labelled with Yahoo's own definitions) plus admin-entered actuals
(the league's definitions). The two are shown side by side and never merged:
they measure slightly different things.

Connection discipline matches main.py: the database connection is never
held across the yfinance call.
"""
import json
import logging
from datetime import datetime, timedelta, timezone

from app.league_models import QuarterRow, ResearchHistoryOut
from app.services import league_admin
from app.services.data_provider import DataProviderError
from app.services.db import get_conn
from app.services.league_service import LeagueError
from app.services.providers import provider

logger = logging.getLogger("finai")

HISTORY_TTL = timedelta(days=7)
PROVIDER_SOURCE = "Yahoo Finance (via yfinance), may be delayed or incomplete"
PROVIDER_DEFINITION = (
    "Revenue = Yahoo's Total Revenue. Operating margin = Yahoo's Operating Income / Total Revenue. "
    "These are Yahoo's definitions, not the league's -- compare with care."
)


def _rows(quarters: list[dict]) -> list[QuarterRow]:
    out = []
    for q in quarters:
        rev, op = q.get("revenue"), q.get("operating_income")
        margin = (op / rev * 100) if rev not in (None, 0) and op is not None else None
        out.append(QuarterRow(period_end_date=q["period_end_date"], revenue=rev, operating_margin_pct=margin))
    return out


def company_history(company_id: int) -> ResearchHistoryOut:
    with get_conn() as conn:
        company = conn.execute("SELECT provider_symbol FROM companies WHERE id = %s", (company_id,)).fetchone()
        if company is None:
            raise LeagueError(404, "company_not_found", "No such company.")
        actuals = league_admin.list_actuals(conn, company_id)
        symbol = company["provider_symbol"]
        cached = None
        if symbol:
            cached = conn.execute(
                "SELECT quarters_json, fetched_at FROM statement_history_cache WHERE symbol = %s", (symbol,)
            ).fetchone()

    quarters, as_of = [], None
    if cached is not None:
        quarters, as_of = json.loads(cached["quarters_json"]), cached["fetched_at"]
    fresh = as_of is not None and datetime.now(timezone.utc) - as_of < HISTORY_TTL
    if symbol and not fresh:
        try:
            quarters = provider.get_quarterly_income(symbol)
            as_of = datetime.now(timezone.utc)
            with get_conn() as conn:
                conn.execute(
                    """
                    INSERT INTO statement_history_cache (symbol, quarters_json, fetched_at) VALUES (%s, %s, now())
                    ON CONFLICT (symbol) DO UPDATE SET quarters_json = EXCLUDED.quarters_json, fetched_at = now()
                    """,
                    (symbol, json.dumps(quarters)),
                )
        except DataProviderError:
            logger.warning("Quarterly history unavailable for %s; serving %s", symbol,
                           "stale cache" if cached else "nothing", exc_info=True)

    return ResearchHistoryOut(
        provider_rows=_rows(quarters),
        provider_source=PROVIDER_SOURCE,
        provider_definition=PROVIDER_DEFINITION,
        provider_as_of=as_of,
        actuals=actuals,
    )

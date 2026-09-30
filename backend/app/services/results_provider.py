"""
Where reported results ("actuals") come from. Deliberately separate from
FinancialDataProvider: that one serves the research panel (Yahoo's own
definitions); this one supplies the numbers forecasts are SCORED against,
which must match each event's stored metric definitions exactly.
"""
from abc import ABC, abstractmethod

import psycopg


class ResultsProvider(ABC):
    @abstractmethod
    def get_actuals(self, conn: psycopg.Connection, company_id: int, period_id: int) -> dict[str, dict]:
        """{metric_key: {"value", "definition_key", "source_url"}} for one
        company period. Missing metrics are simply absent -- never estimated."""


class ManualResultsProvider(ResultsProvider):
    """Admin-entered actuals (the `actuals` table). The only provider for the
    India pilot: results are read from each company's filing by a person, with
    a mandatory source link."""

    def get_actuals(self, conn: psycopg.Connection, company_id: int, period_id: int) -> dict[str, dict]:
        rows = conn.execute(
            """
            SELECT a.metric_key, a.value, a.definition_key, a.source_url
            FROM actuals a JOIN fiscal_periods p ON p.id = a.period_id
            WHERE a.period_id = %s AND p.company_id = %s
            """,
            (period_id, company_id),
        ).fetchall()
        return {
            r["metric_key"]: {
                "value": r["value"], "definition_key": r["definition_key"], "source_url": r["source_url"],
            }
            for r in rows
        }


class SecEdgarResultsProvider(ResultsProvider):
    """Placeholder for US companies (not built).

    How it could work: SEC EDGAR publishes each filer's XBRL facts as JSON
    (https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json, keyless,
    but it requires a descriptive User-Agent and allows ~10 requests/second).
    Quarterly 10-Q facts such as `Revenues` /
    `RevenueFromContractWithCustomerExcludingAssessedTax` and
    `OperatingIncomeLoss` carry `fp` (Q1-Q3) and `frame` (e.g. CY2026Q2);
    Q4 must be derived from the 10-K annual figure minus Q1-Q3. Filers use
    different tags for the same concept, so each US metric definition would
    need an explicit tag list, plus a companies -> CIK mapping. Actuals would
    still be written to the same `actuals` table with an sec.gov source_url.
    """

    def get_actuals(self, conn: psycopg.Connection, company_id: int, period_id: int) -> dict[str, dict]:
        raise NotImplementedError("US results via SEC EDGAR are not implemented yet; see the class docstring.")

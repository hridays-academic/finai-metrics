"""
The one rule for which quarters the public can see (the January fix, phase 11).

`quarters_shown_publicly` is the single source of truth. A company's quarter
is shown when:

- a scored league event is for it, or it is that event's year-ago quarter
  ("Just reported" and the results pages, which show last year's figure);
- a draft, open or locked league event is for it, or it is one of the 8
  quarters before that event (the event page's 8-quarter chart, which holds
  its year-ago and last quarter). Drafts count: a draft opens by itself once
  last year's figures are in, so its quarters are hidden from the pool the
  moment the event is scheduled, not the moment it opens;
- it holds any league figure (not archive), because league charts show
  every league figure.

Both sides read this set. League charts, Research and the worksheet show an
archive figure only when its quarter is in it (so in January a Q3 FY27
event shows Q3 FY26 as last year even though Q3 FY26 was approved as an
archive quarter). Quick rounds, the daily challenge and Practice never use a
quarter in it (practice._practice_rows). It is worked out on every request,
so a quarter leaves the pool when an event is scheduled and comes back when
it stops being shown.
"""
from typing import Optional

import psycopg

from app.services.league_admin import year_ago_label

HISTORY_QUARTERS = 8

Quarter = tuple[int, str, int]  # (company id, FY label, quarter)


def previous_quarters(fy_label: str, quarter: int, n: int) -> list[tuple[str, int]]:
    """The n quarters before (fy_label, quarter), newest first."""
    out = []
    for _ in range(n):
        fy_label, quarter = (year_ago_label(fy_label), 4) if quarter == 1 else (fy_label, quarter - 1)
        out.append((fy_label, quarter))
    return out


def _shown(conn: psycopg.Connection, company_id: Optional[int]) -> set[Quarter]:
    only = "" if company_id is None else " AND p.company_id = %(c)s"
    out: set[Quarter] = set()
    for r in conn.execute(
        """SELECT p.company_id, p.fiscal_year_label, p.fiscal_quarter, e.status
           FROM forecast_events e JOIN fiscal_periods p ON p.id = e.period_id
           WHERE e.kind = 'league'""" + only,
        {"c": company_id},
    ).fetchall():
        c, fy, q = r["company_id"], r["fiscal_year_label"], r["fiscal_quarter"]
        out.add((c, fy, q))
        before = [(year_ago_label(fy), q)] if r["status"] == "scored" else previous_quarters(fy, q, HISTORY_QUARTERS)
        out.update((c, bfy, bq) for bfy, bq in before)
    for r in conn.execute(
        """SELECT DISTINCT p.company_id, p.fiscal_year_label, p.fiscal_quarter
           FROM actuals a JOIN fiscal_periods p ON p.id = a.period_id
           WHERE NOT a.archive""" + only,
        {"c": company_id},
    ).fetchall():
        out.add((r["company_id"], r["fiscal_year_label"], r["fiscal_quarter"]))
    return out


def quarters_shown_publicly(conn: psycopg.Connection, company_id: int) -> set[tuple[str, int]]:
    """(FY label, quarter) for every quarter of one company that a public page shows."""
    return {(fy, q) for _c, fy, q in _shown(conn, company_id)}


def all_quarters_shown_publicly(conn: psycopg.Connection) -> set[Quarter]:
    """The same rule for every company at once (for the practice pool)."""
    return _shown(conn, None)

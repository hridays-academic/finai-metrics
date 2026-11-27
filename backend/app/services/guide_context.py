"""
What the AI guide may see (phase 12; vault: Areas/AI guide plan, section c).

The browser says only which page it is on (a kind and ids, `GuidePage`); it
never sends page text or figures. This module rebuilds the page's context on
the server from public read functions, and is the only place that decides
what the model sees. Two rules on top of "only what a signed-out visitor
sees":

- No figure for a quarter in the play pool (quick rounds, the daily
  challenge, Practice), even where some other page shows it.
- No figure for the own quarter of a league event that isn't scored yet,
  even if an admin has typed the result in before scoring.

`hidden_quarters()` is that combined set; every figure passes `_shown()`.
The card's own answer is never read here at all (nothing calls
practice._complete or reads the card's own quarter).
"""
from dataclasses import dataclass, field
from typing import Literal, Optional

import psycopg
from pydantic import BaseModel, Field

from app.glossary import glossary
from app.league_config import market_config
from app.services import league_admin, play, practice
from app.services.league_scoring import _actuals, _matching, outcome
from app.services.league_service import LeagueError

Quarter = tuple[int, str, int]

PageKind = Literal["home", "learn", "practice", "round", "practice_case", "results", "research"]
# Pages where a reply must never state a range or a figure for the quarter.
ROUND_KINDS = ("round", "practice_case")


class GuidePage(BaseModel):
    kind: PageKind
    card_id: Optional[str] = Field(default=None, max_length=40)
    code: Optional[str] = Field(default=None, pattern=r"^[0-9a-z]{6}$")
    event_id: Optional[int] = Field(default=None, ge=1)
    symbol: Optional[str] = Field(default=None, max_length=30)
    mystery: bool = True

    model_config = {"extra": "forbid"}  # a forged figure or page text has nowhere to go


@dataclass
class Context:
    kind: str
    text: str
    in_round: bool = False
    mystery: bool = False
    # Words a reply must not contain (the hidden company's name in Mystery
    # mode). Checked on the way out, never sent to the model.
    forbidden_names: list[str] = field(default_factory=list)


# How Stackly works, for the model's context. Facts, not user-facing wording.
FACTS = """How Stackly works (facts you may explain):
- Students forecast Indian listed companies' quarterly results as ranges (a low and a high), not single numbers.
- A range should catch the real result about 8 times in 10. A narrower range scores more, but only if the result lands inside it.
- Last year's figure for the same quarter is the "lazy guess": a range centred on it is the baseline to beat.
- Quick rounds: about 10 cards, each one number from a past quarter. Three or five hits in a row give a combo multiplier; one card may be a gold card with a bonus.
- The daily challenge: the same 10 cards for everyone that day; it counts once.
- Practice: past quarters with the company named, or hidden in Mystery mode. Difficulty colours: emerald Easy, cobalt Medium, violet Hard. Hard unlocks at Level 2.
- The Results League: forecast a company before its results date; ranges are scored when the results come out.
- Levels come from points over time. There are no prizes and no money.
- The guide (you) is Stackly's AI guide, not a person."""


def hidden_quarters(conn: psycopg.Connection) -> set[Quarter]:
    pool = {(r["company_id"], r["fiscal_year_label"], r["fiscal_quarter"]) for r in practice._practice_rows(conn)}
    unscored = {(r["company_id"], r["fiscal_year_label"], r["fiscal_quarter"]) for r in conn.execute(
        """SELECT p.company_id, p.fiscal_year_label, p.fiscal_quarter FROM forecast_events e
           JOIN fiscal_periods p ON p.id = e.period_id WHERE e.kind = 'league' AND e.status <> 'scored'""").fetchall()}
    return pool | unscored


def _num(v: Optional[float], unit: str) -> str:
    return "not available" if v is None else f"{round(v, 1)}{unit}"


def _definitions(keys: Optional[set[str]] = None) -> str:
    entries = [e for e in glossary("IN") if keys is None or e["term"] in keys]
    return "\n".join(f"- {e['term']}: {e['definition']}" for e in entries)


def _year_ago(fy: str) -> str:
    return league_admin.year_ago_label(fy)


def build(conn: psycopg.Connection, page: GuidePage) -> Context:
    hidden = hidden_quarters(conn)
    if page.kind in ("home", "learn", "practice"):
        return Context(kind=page.kind, text=f"The student is on the {page.kind} page.\n\n{FACTS}\n\nTerms:\n{_definitions()}")
    if page.kind == "round":
        return _round(conn, page, hidden)
    if page.kind == "practice_case":
        return _practice_case(conn, page, hidden)
    if page.kind == "results":
        return _results(conn, page, hidden)
    return _research(conn, page, hidden)


def _round(conn: psycopg.Connection, page: GuidePage, hidden: set[Quarter]) -> Context:
    if not page.card_id:
        raise LeagueError(422, "card_required", "Which card is this?")
    card = next((c for c in play.cards(conn, mystery=page.mystery) if c.id == page.card_id), None)
    if card is None:
        raise LeagueError(404, "card_not_found", "That card isn't in play any more.")
    event_id, _ = play._parse(card.id)
    row = practice._load(conn, practice.code_for(event_id))
    c, fy, q = row["company_id"], row["fiscal_year_label"], row["fiscal_quarter"]
    pfy, pq = play._previous_quarter(fy, q)
    last_year = card.last_year if (c, _year_ago(fy), q) not in hidden else None
    last_quarter = card.last_quarter if (c, pfy, pq) not in hidden else None
    who = (f"A mystery company in {card.sector_name}: {card.mystery_line or 'no description'}. The company is hidden; "
           "never guess or hint at its name." if page.mystery
           else f"{card.name}, {card.sector_name}, {card.quarter}.")
    text = (f"The student is playing a {card.difficulty or ''} card in a round.\n{who}\n"
            f"The number to forecast: {card.label} ({card.unit}).\n"
            f"Last year's figure for the same quarter (shown on the card): {_num(last_year, card.unit)}.\n"
            f"Last quarter's figure (shown on the card): {_num(last_quarter, card.unit)}.\n"
            "You do not know this quarter's result and must never give it, a range, a midpoint, or say whether it "
            "will be above or below any number.\n\n"
            f"{FACTS}\n\nTerms:\n{_definitions()}")
    return Context(kind="round", text=text, in_round=True, mystery=page.mystery,
                   forbidden_names=[row["company_name"], row["ticker"]] if page.mystery else [])


def _practice_case(conn: psycopg.Connection, page: GuidePage, hidden: set[Quarter]) -> Context:
    row = practice._load(conn, page.code or "")
    c, fy, q = row["company_id"], row["fiscal_year_label"], row["fiscal_quarter"]
    year_ago = _actuals(conn, c, _year_ago(fy), q) if (c, _year_ago(fy), q) not in hidden else {}
    lines = []
    for m in row["metric_definitions"]["metrics"]:
        lines.append(f"- {m['label']} ({m['unit']}): last year {_num(_matching(year_ago, m), m['unit'])}")
    who = (f"A mystery company in {practice._sector_name(row)}: {practice._mystery_line(row)}. The company is hidden; "
           "never guess or hint at its name." if page.mystery
           else f"{row['company_name']}, {practice._sector_name(row)}, {row['season_label']}.")
    text = (f"The student is forecasting a past quarter in Practice.\n{who}\nThe numbers to forecast:\n"
            + "\n".join(lines)
            + "\nYou do not know this quarter's results and must never give them, a range, a midpoint, or say "
            "whether one will be above or below any number.\n\n"
            f"{FACTS}\n\nTerms:\n{_definitions()}")
    return Context(kind="practice_case", text=text, in_round=True, mystery=page.mystery,
                   forbidden_names=[row["company_name"], row["ticker"]] if page.mystery else [])


def _results(conn: psycopg.Connection, page: GuidePage, hidden: set[Quarter]) -> Context:
    if page.event_id is None:
        raise LeagueError(422, "event_required", "Which results page is this?")
    out = outcome(conn, None, page.event_id)  # 404 unless a scored league event
    ev = out.event
    own_shown = (ev.company.id, ev.fiscal_year_label, ev.fiscal_quarter) not in hidden
    ago_shown = (ev.company.id, _year_ago(ev.fiscal_year_label), ev.fiscal_quarter) not in hidden
    lines = []
    for m in out.metrics:
        parts = [f"- {m.label}:"]
        parts.append(f"result {_num(m.actual, m.unit)}" if own_shown else "result (not available to you)")
        parts.append(f"last year {_num(m.lazy, m.unit)}" if ago_shown else "last year (not available to you)")
        if own_shown and m.crowd_median is not None:
            parts.append(f"students' median forecast {_num(m.crowd_median, m.unit)}")
        if own_shown and m.note:
            parts.append(f"approved note on why: {m.note}")
        lines.append(" ".join(parts))
    text = (f"The student is on the results page for {ev.company.name} ({ev.season_label}), which is scored.\n"
            + "\n".join(lines)
            + "\nExplain why a number came out as it did only from the approved notes above; if there is no note, "
            "say the page has no explanation for that number rather than inventing one.\n\n"
            f"{FACTS}\n\nTerms:\n{_definitions()}")
    return Context(kind="results", text=text)


def _research(conn: psycopg.Connection, page: GuidePage, hidden: set[Quarter]) -> Context:
    company = None
    if page.symbol:
        company = conn.execute(
            """SELECT id, name, sector, market_code FROM companies
               WHERE upper(provider_symbol) = upper(%s) AND NOT is_demo ORDER BY id LIMIT 1""",
            (page.symbol.strip(),)).fetchone()
    if company is None:
        return Context(kind="research", text=(
            "The student is on the Research page. You can't see the figures on the screen for this company; "
            "explain terms and how to read the page, and say you can't see its numbers if asked.\n\n"
            f"{FACTS}\n\nTerms:\n{_definitions()}"))
    actuals = [a for a in league_admin.list_actuals(conn, company["id"], public=True)
               if (company["id"], a.fiscal_year_label, a.fiscal_quarter) not in hidden]
    cfg = market_config(company["market_code"])
    labels = {m.key: (m.label, m.unit) for m in cfg.core_metrics}
    quarters: dict[tuple[str, int], list[str]] = {}
    for a in actuals:
        label, unit = labels.get(a.metric_key, (a.metric_key.replace("_", " "), ""))
        quarters.setdefault((a.fiscal_year_label, a.fiscal_quarter), []).append(f"{label} {_num(a.value, unit)}")
    newest = sorted(quarters, key=lambda k: (k[0], k[1]), reverse=True)[:8]
    lines = [f"- Q{q} {fy}: " + ", ".join(quarters[(fy, q)]) for fy, q in newest]
    text = (f"The student is on the Research page for {company['name']}. The league's own figures (from filings) "
            "that the page shows:\n" + ("\n".join(lines) or "- none yet")
            + "\nThe page also shows Yahoo Finance's figures, which use different definitions; you can't see them.\n\n"
            f"{FACTS}\n\nTerms:\n{_definitions()}")
    return Context(kind="research", text=text)


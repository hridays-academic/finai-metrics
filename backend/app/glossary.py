"""Glossary for the research workspace (and later the tutor, which answers
glossary questions from this text without calling a model).

New entries approved by Hriday on 2026-11-13 (Areas/Research workspace
wording). The three forecast numbers and the sector KPIs reuse their
approved league definitions from league_config, so a definition is never
written twice."""
from app.league_config import market_config

NEW_TERMS: tuple[tuple[str, str], ...] = (
    ("Base effect", "When last year's quarter was unusually weak, this year's growth looks high, and the other way "
                    "round. The base is the number growth is measured against."),
    ("Year on year (YoY)", "Compared with the same quarter one year earlier."),
    ("Percentage point", "The plain difference between two percentages. A margin going from 10% to 12% is up 2 "
                         "percentage points (and up 20% in relative terms)."),
    ("Price and mix", "Two reasons average price per unit changes: the company charges more for the same product "
                      "(price), or customers buy more of the expensive products (mix)."),
    ("Realisation", "Cement and steel makers' word for the average price they actually got per tonne, after discounts."),
    ("Underlying volume growth (UVG)", "How much more an FMCG company sold, in packs or tonnes, compared with a year "
                                       "ago, leaving out price changes."),
    ("Constant currency", "Growth worked out as if exchange rates hadn't changed, so it shows the real change in "
                          "business."),
    ("Operating leverage", "When some costs stay fixed, profit rises faster than sales when sales grow, and falls "
                           "faster when they shrink."),
    ("Consolidated and standalone", "Consolidated figures include the company's subsidiaries; standalone figures are "
                                    "the parent company alone. The league uses consolidated."),
    ("Dispatches", "Vehicles sent from the factory to dealers. Monthly auto sales releases count dispatches, not what "
                   "customers bought."),
    ("Utilisation", "For IT companies, the share of staff working on paid client projects. Lower utilisation means "
                    "more staff waiting between projects."),
    ("Guidance", "A company's own statement of what it expects, such as revenue growth for the year."),
    ("Lazy guess", "Last year's number for the same quarter. You earn a bonus if the middle of your range is closer "
                   "to the result than it."),
    ("80% range", "A range you expect the real number to fall inside about 8 times in 10."),
)


def glossary(market: str = "IN") -> list[dict]:
    cfg = market_config(market)
    league = [{"term": m.label, "definition": m.definition, "source": "league"} for m in cfg.core_metrics]
    league += [
        {"term": f"{t.metric.label} ({cfg.sector_explainers[t.sector].display_name})",
         "definition": t.metric.definition, "source": "league"}
        for t in cfg.kpi_templates.values()
    ]
    new = [{"term": term, "definition": text, "source": "glossary"} for term, text in NEW_TERMS]
    return sorted(league + new, key=lambda e: e["term"].lower())

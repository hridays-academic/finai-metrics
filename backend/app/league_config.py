"""
Per-market configuration for the Results League: metric definitions,
sector KPI templates, reason tags, input bounds and scoring constants.
Components and routes read these from here (the frontend via
GET /api/league/config) rather than hard-coding any of it, so adding a
market is data + config, not code.

Definition text is the contract actuals are entered against. Each metric
and KPI has a versioned definition_key; an actual recorded under one key is
never scored or used as a lazy baseline against another. To change a
definition, add a new key (".v2") rather than editing the text of an
existing one, or past actuals silently change meaning.
"""
from dataclasses import dataclass, field

from app.services.scoring import ScoringConfig

REVENUE_GROWTH = "revenue_growth_yoy"
OPERATING_MARGIN = "operating_margin"
SECTOR_KPI = "sector_kpi"


@dataclass(frozen=True)
class MetricDefinition:
    key: str  # revenue_growth_yoy | operating_margin | sector_kpi
    definition_key: str  # versioned, e.g. "in.operating_margin.v1"
    label: str
    unit: str  # "%" or "pp"-style units shown next to inputs
    definition: str  # exact text actuals must be computed by
    min_value: float  # sane bounds for forecast inputs and actuals
    max_value: float


@dataclass(frozen=True)
class KpiTemplate:
    sector: str
    metric: MetricDefinition
    source_hint: str  # where the admin finds the actual


@dataclass(frozen=True)
class ReasonTag:
    key: str
    label: str


@dataclass(frozen=True)
class MarketConfig:
    code: str
    timezone: str
    currency: str
    core_metrics: tuple[MetricDefinition, ...]
    kpi_templates: dict[str, KpiTemplate]
    reason_tags: tuple[ReasonTag, ...]
    # Sectors that can't join the league yet (e.g. operating margin doesn't
    # apply to banks); also excluded from Practice.
    excluded_sectors: frozenset[str]
    # Lock defaults to this local time on the day before results_date.
    default_lock_local_time: str = "23:59"
    scoring: ScoringConfig = field(default_factory=ScoringConfig)
    # Crowd median is withheld until at least this many people forecast.
    min_forecasters_for_crowd: int = 5


_IN_CORE_METRICS = (
    MetricDefinition(
        key=REVENUE_GROWTH,
        definition_key="in.revenue_growth_yoy.v1",
        label="Revenue growth (YoY)",
        unit="%",
        definition=(
            "Percent change in consolidated revenue from operations versus the same "
            "quarter of the previous fiscal year, as reported in the company's results filing."
        ),
        min_value=-100.0,
        max_value=500.0,
    ),
    MetricDefinition(
        key=OPERATING_MARGIN,
        definition_key="in.operating_margin.v1",
        label="Operating margin",
        unit="%",
        definition=(
            "Consolidated EBITDA excluding other income, as a percent of revenue from "
            "operations: (revenue from operations - total expenses + depreciation and "
            "amortisation + finance costs) / revenue from operations."
        ),
        min_value=-100.0,
        max_value=100.0,
    ),
)

# DRAFT (2026-09) -- awaiting product sign-off. Each KPI must be something
# the company itself discloses every quarter; only set up a KPI for
# companies that actually report it.
_IN_KPI_TEMPLATES = {
    "cement": KpiTemplate(
        sector="cement",
        metric=MetricDefinition(
            key=SECTOR_KPI,
            definition_key="in.cement.volume_growth_yoy.v1",
            label="Sales volume growth (YoY)",
            unit="%",
            definition=(
                "Percent change in consolidated cement sales volume (million tonnes) "
                "versus the same quarter last year, as stated by the company."
            ),
            min_value=-60.0,
            max_value=150.0,
        ),
        source_hint="Results press release or investor presentation (volume in MT).",
    ),
    "autos": KpiTemplate(
        sector="autos",
        metric=MetricDefinition(
            key=SECTOR_KPI,
            definition_key="in.autos.unit_volume_growth_yoy.v1",
            label="Unit sales growth (YoY)",
            unit="%",
            definition=(
                "Percent change in total vehicles sold in the quarter (domestic plus "
                "exports) versus the same quarter last year, from the company's own "
                "sales disclosures."
            ),
            min_value=-60.0,
            max_value=150.0,
        ),
        source_hint="Company's monthly sales releases summed for the quarter, or the results filing.",
    ),
    "fmcg": KpiTemplate(
        sector="fmcg",
        metric=MetricDefinition(
            key=SECTOR_KPI,
            definition_key="in.fmcg.underlying_volume_growth.v1",
            label="Underlying volume growth",
            unit="%",
            definition=(
                "Underlying (domestic) volume growth versus the same quarter last year, "
                "exactly as the company discloses it. Only for companies that report it."
            ),
            min_value=-40.0,
            max_value=60.0,
        ),
        source_hint="Results press release (often labelled UVG).",
    ),
    "it": KpiTemplate(
        sector="it",
        metric=MetricDefinition(
            key=SECTOR_KPI,
            definition_key="in.it.cc_revenue_growth_yoy.v1",
            label="Constant-currency revenue growth (YoY)",
            unit="%",
            definition=(
                "Revenue growth versus the same quarter last year in constant currency, "
                "as reported by the company."
            ),
            min_value=-40.0,
            max_value=80.0,
        ),
        source_hint="Results press release or fact sheet.",
    ),
}

_IN_REASON_TAGS = (
    ReasonTag("more_volume", "More volume"),
    ReasonTag("price_increases", "Price increases"),
    ReasonTag("better_mix", "Better product mix"),
    ReasonTag("new_capacity", "New capacity"),
    ReasonTag("lower_input_costs", "Lower input costs"),
    ReasonTag("higher_input_costs", "Higher input costs"),
    ReasonTag("demand_slowdown", "Demand slowdown"),
    ReasonTag("other", "Other"),
)

MARKETS: dict[str, MarketConfig] = {
    "IN": MarketConfig(
        code="IN",
        timezone="Asia/Kolkata",
        currency="INR",
        core_metrics=_IN_CORE_METRICS,
        kpi_templates=_IN_KPI_TEMPLATES,
        reason_tags=_IN_REASON_TAGS,
        excluded_sectors=frozenset({"banks", "nbfc"}),
    ),
}


def market_config(code: str) -> MarketConfig:
    try:
        return MARKETS[code]
    except KeyError:
        raise KeyError(f"No Results League config for market {code!r}") from None


def all_definitions(config: MarketConfig) -> dict[str, MetricDefinition]:
    """Every definition in a market, keyed by definition_key."""
    defs = {m.definition_key: m for m in config.core_metrics}
    defs.update({t.metric.definition_key: t.metric for t in config.kpi_templates.values()})
    return defs

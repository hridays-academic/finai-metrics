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
    # Companies known NOT to disclose this KPI. Their events get no sector
    # KPI at all -- a missing KPI is never estimated.
    non_disclosing_tickers: frozenset[str] = frozenset()


@dataclass(frozen=True)
class SectorExplainer:
    """'How this business makes money', shown at the top of a company page.
    Written for complete beginners."""

    sector: str
    display_name: str
    sells: str
    sales_drivers: str
    cost_drivers: str
    checklist: tuple[str, ...]


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
    sector_explainers: dict[str, SectorExplainer] = field(default_factory=dict)
    # Default one-line card descriptions by ticker; a description saved on
    # the company row (admin form) takes precedence.
    company_descriptions: dict[str, str] = field(default_factory=dict)


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

# Approved 2026-10-16. Each KPI must be something the company itself
# discloses every quarter; a company that doesn't disclose it gets no sector
# KPI on its events (never an estimate).
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
            # v2: scope pinned to every vehicle type in the monthly release.
            definition_key="in.autos.unit_volume_growth_yoy.v2",
            label="Total units sold, growth (YoY)",
            unit="%",
            definition=(
                "Percent change in total units sold in the quarter versus the same quarter last "
                "year: domestic plus exports, all vehicle types in the company's monthly sales "
                "release, summed over the quarter's three months."
            ),
            min_value=-60.0,
            max_value=150.0,
        ),
        source_hint="The company's three monthly sales releases for the quarter (total units, all vehicle types).",
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
        non_disclosing_tickers=frozenset({"ITC", "NESTLEIND"}),
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

# Approved 2026-10-19.
_IN_SECTOR_EXPLAINERS = {
    "cement": SectorExplainer(
        sector="cement",
        display_name="Cement",
        sells=(
            "Cement: the grey powder that holds concrete together. It's sold by the tonne to builders, "
            "contractors and local dealers. Cement is heavy and costly to move, so most of it is sold "
            "within a few hundred kilometres of the plant that made it."
        ),
        sales_drivers=(
            "Sales = tonnes sold x price per tonne. Tonnes follow construction: new homes, roads, bridges "
            "and government building projects. Building slows in the monsoon (July to September), so "
            "that quarter is usually weaker than the ones around it. Prices move with local competition."
        ),
        cost_drivers=(
            "Energy and transport. Plants burn coal and petcoke to heat their kilns, and every tonne has "
            "to be trucked or railed to customers. When fuel prices fall, margins usually rise. When "
            "they climb, margins get squeezed."
        ),
        checklist=(
            "Has the company opened new plants in the past year? More capacity usually means more tonnes sold.",
            "Were cement prices higher or lower this quarter than a year ago?",
            "Are coal and petcoke prices up or down? That's the biggest swing in margin.",
            "Look at the same quarter last year in the table. Was it unusually strong or weak?",
        ),
    ),
    "autos": SectorExplainer(
        sector="autos",
        display_name="Autos",
        sells=(
            "Vehicles: cars, motorcycles, scooters, tractors or trucks, depending on the company. It "
            "also sells spare parts. Most vehicles are sold through dealers in India, and some are exported."
        ),
        sales_drivers=(
            "Sales = units sold x average price per vehicle. Units depend on demand: the festive season, "
            "harvests and village incomes, and loan interest rates. The price per vehicle rises when "
            "buyers choose pricier models (an SUV instead of a small car). Companies publish units sold "
            "every month, so most of the quarter's unit count is public before results day. Some "
            "companies also sell construction machines such as cranes and backhoe loaders, which "
            "follow building activity rather than farm incomes."
        ),
        cost_drivers=(
            "Raw materials (steel, aluminium, rubber, plastics, and batteries for electric models) are "
            "the biggest cost by far. Discounts to clear stock and advertising also eat into margins."
        ),
        checklist=(
            "Add up the company's three monthly sales releases for the quarter. That's the units KPI, and a big clue for revenue.",
            "Did it sell more of its expensive models, or more of its cheap ones?",
            "Are steel and aluminium prices up or down since last year?",
            "How did exports do? Weak export markets can drag total units down.",
        ),
    ),
    "fmcg": SectorExplainer(
        sector="fmcg",
        display_name="Everyday goods (FMCG)",
        sells=(
            "Things people buy again and again: soap, shampoo, toothpaste, biscuits, tea and packaged "
            "food. They're sold through millions of small neighbourhood shops, supermarkets and online."
        ),
        sales_drivers=(
            "Sales = how many packs people buy (volume) x price per pack. Companies raise prices when "
            "their costs go up. Volume depends on how much households are spending, especially in "
            "villages, where spending rises and falls with the monsoon and farm incomes."
        ),
        cost_drivers=(
            "Raw materials (palm oil, milk, wheat, sugar, tea leaves) and packaging made from "
            "crude-oil-based plastics. Advertising is also a big expense, because these brands compete "
            "for shelf space and attention."
        ),
        checklist=(
            "Revenue growth is roughly volume growth plus price increases. Did the company raise prices in the past year?",
            "What did the company say last quarter about demand in villages and in cities?",
            "Are palm oil and packaging costs up or down?",
            "The volume KPI only appears if the company discloses it. If it doesn't, this event has no sector KPI.",
        ),
    ),
    "it": SectorExplainer(
        sector="it",
        display_name="IT services",
        sells=(
            "Technology work for other businesses: building and running software and systems for banks, "
            "shops, airlines and manufacturers, mostly in the US and Europe. Clients pay per project, "
            "per hour, or through contracts lasting several years."
        ),
        sales_drivers=(
            "Sales depend on how many deals the company wins and how much its clients spend on "
            "technology. Most revenue is earned in dollars, euros and pounds, so when the rupee weakens, "
            "revenue in rupees goes up even with no extra work. That's why IT companies also report "
            "constant-currency growth, which removes the currency effect."
        ),
        cost_drivers=(
            "People. Salaries for engineers are the biggest cost by far. Margins fall in the quarter "
            "the company gives its yearly pay rises. They also fall when many staff sit between projects "
            "without billing clients."
        ),
        checklist=(
            "Did the company give revenue guidance for the year, and did it change it last quarter?",
            "Has it announced any big deal wins recently?",
            "Is the rupee weaker or stronger against the dollar than a year ago? A weaker rupee lifts revenue growth in rupees.",
            "Is this the quarter it usually gives pay rises? That pulls the margin down.",
        ),
    ),
}

# Approved 2026-10-19 (ESCORTS, JYOTHYLAB, MPHASIS, SAGCEM added 2026-10-21)
# for the November mini-pilot; the admin form can
# override any of these. M&M is left out on purpose: its car and tractor
# sales come in separate releases, so the autos units KPI is ambiguous for it.
_IN_COMPANY_DESCRIPTIONS = {
    # Cement
    "ULTRACEMCO": "India's biggest cement maker, supplying homebuilders and big infrastructure projects across the country.",
    "AMBUJACEM": "A large cement maker owned by the Adani group.",
    "SHREECEM": "One of India's biggest cement makers, strongest in the north and known for running low-cost plants.",
    "SAGCEM": "A Hyderabad-based cement maker with plants in Telangana, Andhra Pradesh, Madhya Pradesh and Odisha.",
    # Autos
    "MARUTI": "India's biggest car maker, behind popular models like the Swift, Baleno and Brezza.",
    "ESCORTS": "Makes Farmtrac, Powertrac and Kubota tractors for Indian farmers, plus cranes and other construction machines.",
    "TVSMOTOR": "Makes motorcycles, scooters (including the electric iQube) and three-wheelers, and exports many of them.",
    "HEROMOTOCO": "India's biggest motorcycle maker, best known for the Splendor.",
    # Everyday goods (FMCG)
    "HINDUNILVR": "India's biggest maker of everyday products: Surf Excel, Dove, Lux, Brooke Bond tea and Kissan.",
    "DABUR": "Ayurvedic and natural products: Dabur Chyawanprash, Real juices, Red toothpaste and Vatika hair oil.",
    "MARICO": "Hair oils and healthy foods: Parachute coconut oil, Saffola cooking oil and Saffola oats.",
    "GODREJCP": "Household and personal care: Good Knight mosquito repellents, HIT and Cinthol soap.",
    "JYOTHYLAB": "Household brands like Ujala fabric whitener, Henko detergent, Exo and Pril dishwash, and Margo soap.",
    "ITC": "Best known for cigarettes, and also sells Aashirvaad atta, Sunfeast biscuits, Bingo chips and paper.",
    "NESTLEIND": "Maggi noodles, Nescafe coffee, KitKat chocolates and baby foods like Cerelac.",
    # IT services
    "TECHM": "IT services company that also builds and runs telecom networks for clients around the world.",
    "COFORGE": "Mid-sized IT services company with many clients in banking, insurance and travel.",
    "PERSISTENT": "Builds software for tech companies, banks and healthcare firms, mostly in the US.",
    "MPHASIS": "IT services company that builds and runs software for banks, insurers and tech firms, mostly in the Americas.",
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
        sector_explainers=_IN_SECTOR_EXPLAINERS,
        company_descriptions=_IN_COMPANY_DESCRIPTIONS,
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

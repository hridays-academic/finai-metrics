"""News, world events and macro context: sources, themes and the approved
"why it may matter" sentences (all approved by Hriday 2026-11-08; change the
wording only with approval, as for league_config.py).

Headlines are classified by keyword rules, never AI. A headline that matches
no theme (or, for company news, no event type) is not shown at all. A
headline that reads like investment advice is dropped before anything else.
"""
import re
from dataclasses import dataclass, field

# Sector keys used on the news screens. "economy" is the general list.
NEWS_SECTORS = ("cement", "autos", "fmcg", "it")
SECTOR_LABELS = {"economy": "Economy & policy", "cement": "Cement", "autos": "Autos", "fmcg": "FMCG", "it": "IT"}

# Publishers whose headlines may appear (GDELT is filtered to these).
PUBLISHERS = {
    "economictimes.indiatimes.com": "Economic Times",
    "livemint.com": "Mint",
    "business-standard.com": "Business Standard",
    "thehindubusinessline.com": "BusinessLine",
    "financialexpress.com": "Financial Express",
    "moneycontrol.com": "Moneycontrol",
    "thehindu.com": "The Hindu",
    "indianexpress.com": "Indian Express",
    "reuters.com": "Reuters",
    "ndtvprofit.com": "NDTV Profit",
    "cnbctv18.com": "CNBC-TV18",
    "hindustantimes.com": "Hindustan Times",
}


# Sections of each publisher's site whose headlines may appear: business,
# economy, markets and world news. GDELT's raw files carry every section, and
# city, lifestyle and sports stories otherwise match themes by accident
# ("crude bomb", "tyre inflation"). Matched on the URL path's first segment
# (first two for "news/..." and "article/..." paths). None = all sections
# (business-only publications).
PUBLISHER_SECTIONS: dict[str, frozenset[str] | None] = {
    "economictimes.indiatimes.com": frozenset({"markets", "industry", "news/economy", "news/international", "tech"}),
    "livemint.com": frozenset({"economy", "market", "companies", "industry", "news/world", "technology"}),
    "business-standard.com": frozenset({"economy", "markets", "companies", "industry", "world-news", "technology"}),
    "thehindubusinessline.com": None,
    "financialexpress.com": frozenset({"business", "market", "economy", "world-news"}),
    "moneycontrol.com": frozenset({"news/business", "world"}),
    "thehindu.com": frozenset({"business", "news/international"}),
    "indianexpress.com": frozenset({"article/business", "article/world"}),
    "reuters.com": frozenset({"business", "markets", "world"}),
    "ndtvprofit.com": None,
    "cnbctv18.com": frozenset({"business", "economy", "market", "world"}),
    "hindustantimes.com": frozenset({"business", "world-news"}),
}


def allowed_section(domain: str, path: str) -> bool:
    domain = domain.lower().removeprefix("www.")
    key = next((d for d in PUBLISHER_SECTIONS if domain == d or domain.endswith("." + d)), None)
    if key is None:
        return False
    sections = PUBLISHER_SECTIONS[key]
    if sections is None:
        return True
    parts = [p for p in path.split("/") if p]
    if not parts:
        return False
    first = "/".join(parts[:2]) if parts[0] in ("news", "article") else parts[0]
    return first in sections


def publisher_for(domain: str) -> str | None:
    domain = domain.lower().removeprefix("www.")
    for d, name in PUBLISHERS.items():
        if domain == d or domain.endswith("." + d):
            return name
    return None


# Headlines that read like tips or ratings never appear on Stackly.
ADVICE = re.compile(
    r"\b(buy|sell|target( price)?|price target|stocks? to (buy|watch)|multibaggers?|brokerages?|"
    r"upgrades?|upgraded|downgrades?|downgraded|neutral|accumulate|outperform|underperform|"
    r"overweight|underweight|should you|top picks?|ratings?)\b",
    re.I,
)


@dataclass(frozen=True)
class Theme:
    key: str
    label: str
    pattern: re.Pattern
    # Sentence per sector key ("economy" for the general list).
    sentences: dict[str, str] = field(default_factory=dict)


def _rx(words: str) -> re.Pattern:
    return re.compile(rf"\b({words})\b", re.I)


# Order matters: a headline gets the first theme it matches.
THEMES: tuple[Theme, ...] = (
    Theme("rates", "Rates and inflation", _rx(r"repo|repo rate|rbi policy|monetary policy|mpc|interest rates?|inflation|cpi"), {
        "economy": "RBI rate decisions may change borrowing costs for companies and households.",
        "autos": "Interest rates may change EMIs on vehicle loans, which affects how many people buy.",
        "cement": "Interest rates may change the cost of home loans and building projects, which drive cement demand.",
        "fmcg": "Inflation may change how much households have left for everyday purchases.",
    }),
    Theme("crude", "Crude oil", _rx(r"crude oil|brent|oil prices?|opec"), {
        "economy": "Oil prices may affect India's import bill, inflation and the rupee, since India imports most of its crude.",
        "cement": "Higher oil prices may raise cement makers' diesel and freight costs, which can squeeze margins.",
        "autos": "Fuel prices may affect demand for petrol and diesel vehicles, and oil also feeds into plastics and freight costs.",
        "fmcg": "Oil prices may change packaging and transport costs, since many plastics are made from crude.",
    }),
    Theme("monsoon", "Monsoon", _rx(r"monsoon|rainfall|imd|kharif"), {
        "economy": "The monsoon may affect food prices, inflation and rural spending across the economy.",
        "fmcg": "A good or poor monsoon may change rural incomes, which drive a large share of FMCG sales.",
        "autos": "Rainfall may affect farm incomes and so demand for tractors, two-wheelers and entry-level cars.",
        "cement": "Heavy rain usually slows construction, which may lower cement demand for those weeks.",
    }),
    Theme("rupee", "Rupee", _rx(r"rupee|forex|dollar"), {
        "economy": "A weaker rupee may make imports dearer and exports more competitive.",
        "it": "A weaker rupee may lift IT companies' rupee revenue, since most of their sales are in dollars.",
        "autos": "Rupee moves may change the cost of imported parts and the value of export sales.",
        "fmcg": "A weaker rupee may raise the cost of imported inputs such as palm oil.",
        "cement": "A weaker rupee may raise the cost of imported coal and petcoke used to fire kilns.",
    }),
    Theme("tariffs", "Tariffs and trade", _rx(r"tariffs?|trade deal|import duty|export duty|anti-dumping|visas?|h-1b"), {
        "economy": "Tariff changes may affect India's exports, imports and the companies that depend on them.",
        "it": "Trade and visa rules in the US and Europe may affect demand for Indian IT services and the cost of staff abroad.",
        "autos": "Tariffs may change export demand and the cost of imported components.",
        "fmcg": "Import duties on edible oils and other inputs may change raw material costs.",
    }),
    # "war" but not a figurative one ("turf war", "price war").
    Theme("supply", "War and supply",
          _rx(r"(?<!turf )(?<!price )(?<!talent )(?<!bidding )war|conflict|sanctions?|red sea|shipping|chip shortage|supply chain"), {
        "economy": "Conflicts and shipping disruptions may raise freight costs and commodity prices worldwide.",
        "autos": "Supply disruptions may delay parts such as chips, which can slow vehicle production.",
        "cement": "Disruptions may raise freight and raw material costs.",
        "fmcg": "Disruptions may raise freight and raw material costs.",
    }),
    Theme("gst", "GST and tax", _rx(r"gst|excise|cess|budget|tax cut|tax hike"), {
        "economy": "Tax changes may shift prices, spending and government revenue.",
        "autos": "A GST change may move vehicle prices and so how many people buy.",
        "fmcg": "A GST change may move shelf prices of everyday products and how much households buy.",
        "cement": "A change in the GST on cement may move prices and building costs.",
    }),
    Theme("inputs", "Input prices", _rx(r"steel|aluminium|aluminum|coal|petcoke|palm oil|copra"), {
        "autos": "Steel and aluminium prices may change the cost of making vehicles.",
        "cement": "Coal and petcoke prices may change the cost of firing kilns, one of cement makers' biggest costs.",
        "fmcg": "Prices of palm oil, copra and other raw materials may change production costs.",
    }),
    Theme("tech", "Tech spending", _rx(r"it spending|tech spending|tech budgets?|ai spending"), {
        "it": "How much US and European companies spend on technology may change demand for Indian IT services.",
    }),
)
THEMES_BY_KEY = {t.key: t for t in THEMES}


@dataclass(frozen=True)
class EventType:
    key: str
    label: str
    pattern: re.Pattern
    sentence: str


# For company news and exchange filings; checked before themes.
EVENT_TYPES: tuple[EventType, ...] = (
    EventType("results", "Results", _rx(r"results?|q[1-4]|quarterly|net profit|profit (rises|falls|jumps|drops|up|down)|earnings|pat"),
              "These results may show whether revenue and margins moved the way forecasts expected."),
    EventType("commentary", "Management commentary",
              _rx(r"investor presentation|earnings call|transcript|analysts?/institutional investor meet|con\. call|concall"),
              "Management's own explanation may help you see what drove the quarter."),
    EventType("monthly_sales", "Monthly sales", _rx(r"monthly sales|units sold|dispatches|wholesales|sales (rise|fall|grow|jump|decline)"),
              "Monthly sales may hint at how the quarter's volumes are tracking."),
    EventType("order", "Order", _rx(r"orders?|contracts?|deal wins?|wins .{0,30}deal"),
              "A large order may add to future revenue, depending on its size and timing."),
    EventType("price_change", "Price change", _rx(r"price (hike|increase|cut)|(raises|hikes|cuts) prices"),
              "A price change may affect revenue per unit and margins in the coming quarters."),
    EventType("capacity", "Capacity", _rx(r"capacity|plant|factory|expansion|commission(s|ed|ing)?"),
              "New capacity may add to sales volumes once it starts running."),
    EventType("management", "Management change", _rx(r"ceo|md|chairman|chairperson|appoints?|appointed|resigns?|steps down"),
              "A change at the top may lead to changes in strategy."),
    EventType("legal", "Legal or regulatory", _rx(r"penalty|fined?|court|sebi order|tax demand|probe|lawsuit|nclt"),
              "A legal or regulatory issue may lead to costs or delays."),
)
EVENT_TYPES_BY_KEY = {e.key: e for e in EVENT_TYPES}


def clean_title(title: str) -> str:
    """Drops a trailing " - Publisher" / " | Publisher" and fixes GDELT's
    spaced punctuation ("Rs 428 . 55 Crore")."""
    t = re.sub(r"\s+[-|]\s+[^-|]{2,40}$", "", title.strip())
    t = re.sub(r"(\d) \. (\d)", r"\1.\2", t)
    t = re.sub(r"\s+([,.:;?])", r"\1", t)
    return re.sub(r"\s+", " ", t)


def is_advice(title: str) -> bool:
    return bool(ADVICE.search(title))


def classify(title: str, *, company: bool) -> str | None:
    """Theme or event-type key for a headline, or None (then it's hidden)."""
    if company:
        for e in EVENT_TYPES:
            if e.pattern.search(title):
                return e.key
    for t in THEMES:
        if t.pattern.search(title):
            return t.key
    return None


def label_for(key: str) -> str:
    if key in THEMES_BY_KEY:
        return THEMES_BY_KEY[key].label
    return EVENT_TYPES_BY_KEY[key].label


def sentence_for(key: str, view: str) -> str | None:
    """The approved line for a theme in a sector view ("economy" for the
    general list), or an event type's line (same in every view)."""
    if key in EVENT_TYPES_BY_KEY:
        return EVENT_TYPES_BY_KEY[key].sentence
    return THEMES_BY_KEY[key].sentences.get(view)


def views_for(key: str) -> tuple[str, ...]:
    """Sector views a theme appears in (where it has a sentence)."""
    if key in EVENT_TYPES_BY_KEY:
        return ()
    return tuple(THEMES_BY_KEY[key].sentences)


# Exchange filings: NSE's own RSS (official, meant for syndication).
NSE_ANNOUNCEMENTS_RSS = "https://nsearchives.nseindia.com/content/RSS/Online_announcements.xml"
RBI_PRESS_RSS = "https://rbi.org.in/pressreleases_rss.xml"
# Routine RBI notices (daily liquidity auctions and their results, T-bill
# and money-market data) match "repo" but tell a student nothing.
RBI_ROUTINE = re.compile(
    r"\b(auctions?|money market operations|treasury bills?|t-bills?|result of|reserve money|weekly statistical)\b", re.I
)


@dataclass(frozen=True)
class MacroSeries:
    key: str
    label: str
    unit: str
    source: str
    source_url: str
    sectors: tuple[str, ...]
    frequency: str  # "monthly" | "daily"


# World Bank Commodity Price Data ("Pink Sheet"), CC BY 4.0, monthly
# averages; and USD/INR from FRED (Federal Reserve H.10, public domain,
# citation requested). FRED's Brent series is third-party copyrighted, so
# crude comes from the World Bank instead.
WORLD_BANK_SOURCE = "World Bank Commodity Price Data (The Pink Sheet), CC BY 4.0"
WORLD_BANK_URL = "https://www.worldbank.org/en/research/commodity-markets"
WORLD_BANK_COLUMNS = {
    "brent": "Crude oil, Brent",
    "coal": "Coal, Australian",
    "aluminium": "Aluminum",
    "iron_ore": "Iron ore, cfr spot",
    "palm_oil": "Palm oil",
}
MACRO_SERIES: tuple[MacroSeries, ...] = (
    MacroSeries("brent", "Brent crude", "$ per barrel", WORLD_BANK_SOURCE, WORLD_BANK_URL, ("cement", "fmcg"), "monthly"),
    MacroSeries("usd_inr", "Rupees per US dollar", "₹ per $", "Federal Reserve H.10 via FRED",
                "https://fred.stlouisfed.org/series/DEXINUS", ("it",), "daily"),
    MacroSeries("coal", "Coal (Australian)", "$ per tonne", WORLD_BANK_SOURCE, WORLD_BANK_URL, ("cement",), "monthly"),
    MacroSeries("aluminium", "Aluminium", "$ per tonne", WORLD_BANK_SOURCE, WORLD_BANK_URL, ("autos",), "monthly"),
    MacroSeries("iron_ore", "Iron ore", "$ per tonne", WORLD_BANK_SOURCE, WORLD_BANK_URL, ("autos",), "monthly"),
    MacroSeries("palm_oil", "Palm oil", "$ per tonne", WORLD_BANK_SOURCE, WORLD_BANK_URL, ("fmcg",), "monthly"),
)

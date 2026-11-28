"""
The guide's answers mode (GUIDE_ENGINE=answers, the January version): no AI
call of any kind and no data leaving Stackly. A question is matched by simple
search (keywords plus a small synonym list, with common Hinglish words) to:

1. How to play: approved text copied word for word (the 10-page guide,
   approved 19 Nov; the quick-round hints, Stop 2; the Terms and Privacy
   lines), plus a few DRAFT entries, each marked `draft=True`;
2. the glossary (app/glossary.py: the league's definitions and the terms
   approved 13 Nov);
3. the figures already on the page (guide_context: public figures only, the
   play pool and unscored events left out), in DRAFT one-line templates;
4. approved debrief notes on a scored results page.

If nothing matches well enough, the DRAFT fallback FALLBACK. Every guide rule
still applies around it: the server's fixed replies run first and the output
check runs on every sentence.
"""
import re
from dataclasses import dataclass, field
from typing import Iterator, Optional

from app.glossary import glossary
from app.services.guide_context import Context
from app.services.guide_model import Usage

FALLBACK = "I can only answer questions about how Stackly works and the terms on this page."  # DRAFT


@dataclass
class Entry:
    key: str
    answer: str
    must: list[set[str]]  # every group needs at least one word
    extra: set[str] = field(default_factory=set)  # words that make it a better match
    pages: Optional[set[str]] = None  # only on these page kinds
    min_hits: Optional[int] = None  # groups that must match (default: all)
    draft: bool = False
    source: str = ""


# Approved text (copied word for word).
G1 = ("A company's financial year is divided into four quarters of three months. After each quarter, the company "
      "publishes its results: how much it sold and how much profit it made. Companies listed in India must report "
      "within 45 days, or within 60 days after the last quarter of the year. You forecast three numbers before results day.")
G2 = ("Revenue is the money a company receives from its sales, before any costs. Revenue growth compares a quarter with "
      "the same quarter a year earlier: (this year − last year) ÷ last year. Maruti Suzuki's revenue rose from ₹42,344 "
      "crore to ₹53,356 crore, so it grew 26%. One crore is 1,00,00,000 rupees.")
G3 = ("Operating margin is the share of sales left after paying for materials, staff and other running costs. From July "
      "to September 2026, Marico had about ₹18 left from every ₹100 of sales, so its operating margin was 18.2%. A "
      "higher margin means more of each sale is left over.")
G4 = ("Each sector has one number that says the most about its quarter, and you forecast it as well. Not every company "
      "publishes this number, so some companies have only two numbers to forecast.")
G5 = ("No one knows the exact number before results day, so you give a range: a low and a high. Aim for a range that "
      "would contain the actual result 8 times out of 10. A narrow range misses often. A wide range rarely misses, but "
      "width reduces your score.")
G6 = ("Each number you forecast starts at 100 points. Each percentage point of your range's width costs 2 points. If "
      "the result falls outside your range, each point you missed by costs 20 more. Scores cannot go below 0.")
G7 = ("The lazy guess assumes the number will be the same as last year. If the middle of your range is closer to the "
      "result than the lazy guess, you earn 10 bonus points. If it is equally close, there is no bonus.")
G8 = ("Good forecasts start from facts. Begin with the same quarter last year, because seasonal patterns repeat: "
      "festivals, monsoons and harvests come round every year. Then look at what has changed since.")
G10 = ("Start with a practice company. Its results are already published, so you see your score immediately. Mystery "
       "mode hides the company's name, so you forecast from the numbers alone. When a company opens for forecasts, you "
       "can forecast it in the league.")
H1 = "Last year's figure is marked on the bar. Start there, then ask what has changed since."
H2 = "Aim to be right 8 times out of 10. If a result just outside your range would surprise you, it's wide enough."
H3 = "Narrow ranges score more, but only when the result lands inside."

FAQ: list[Entry] = [
    Entry("play", f"{G5} {G6}", [{"play", "start_game", "work_game"}], {"how", "game", "stackly"}, source="guide p5-6"),
    Entry("range", G5, [{"range"}], {"what", "meaning", "low", "high"}, source="guide p5"),
    Entry("range_width", f"{H3} {H2}", [{"wide", "narrow", "width", "safe", "precise"}],
          {"range", "bad", "score", "how", "should", "better"}, source="hints, Stop 2"),
    Entry("eighty", H2, [{"eight", "80", "confident", "confidence", "times"}], {"ten", "10", "why", "range"}, source="hints, Stop 2"),
    Entry("score", G6, [{"score"}], {"how", "work", "calculate", "width", "miss"}, source="guide p6"),
    Entry("miss", G6, [{"miss", "outside"}], {"range", "what", "happen"}, source="guide p6"),
    Entry("lazy", G7, [{"lazy"}], {"guess", "what", "meaning", "bonus"}, source="guide p7"),
    Entry("results", G1, [{"quarterly", "result", "report", "quarter"}, {"what", "when", "days", "why", "every", "how"}],
          {"company", "publish"}, pages={"home", "learn", "practice", "research"}, source="guide p1"),
    Entry("start", f"{H1} {G8}", [{"start", "begin"}], {"where", "how", "forecast"}, source="hints and guide p8"),
    Entry("compare_year", G8, [{"compare", "same"}, {"year", "earlier", "last"}], {"why"}, source="guide p8"),
    Entry("last_year_help", G8, [{"last"}, {"year"}, {"help", "why", "how", "use", "start", "marked"}], source="guide p8"),
    Entry("sector_number", G4, [{"sector"}, {"number", "kpi", "extra"}], source="guide p4"),
    Entry("practice", G10, [{"practice"}], {"what", "how", "different", "league", "start", "replay", "count"}, source="guide p10"),
    Entry("mystery", G10, [{"hidden", "mystery"}], {"why", "what", "company", "name"}, source="guide p10"),
    Entry("league", G10, [{"league"}], {"what", "how", "forecast", "different"}, source="guide p10"),
    Entry("prices", "Share prices are at least 30 days old.", [{"price"}, {"old", "30", "days", "late", "why", "delay"}],
          source="Terms 4"),
    Entry("money", "You can't deposit, win or withdraw money. Scores have no cash value.",
          [{"money", "prize", "cash", "paisa", "rupees", "withdraw"}], {"win"}, source="Terms 3"),
    Entry("levels", "Levels and badges have no money value, can't be bought, sold or swapped, and may be corrected if a "
          "result is corrected.", [{"level", "badge"}], {"what", "for", "how"}, source="Terms 3"),
    Entry("signin", "If you're signed in, we save your quick rounds, daily challenges, level and badges so you can see "
          "your progress.", [{"sign", "account", "save", "login"}], {"without", "need", "play"}, source="Privacy, Your progress"),
    Entry("gold", "Gold card: +20 points if the result lands inside your range.", [{"gold"}], source="quick round, Stop 2"),
    Entry("daily", "The same 10 cards for everyone today. It counts once.", [{"daily"}], {"challenge", "what", "how"},
          source="daily challenge, phase 6"),
    # DRAFT entries (decisions note, "Answers mode").
    Entry("combo", "Three or five cards in a row inside your range give a combo: those cards' points are multiplied "
          "by 2 or by 3.", [{"combo"}], draft=True),
    Entry("colours", "The colours show how hard a company is: emerald is Easy, cobalt is Medium and violet is Hard. "
          "Hard companies unlock at Level 2.", [{"colour", "difficulty", "easy", "hard", "medium"}],
          {"what", "meaning", "start", "which", "unlock"}, draft=True),
    Entry("who", "I'm not a person, and I'm not an AI. I'm Stackly's guide: I answer from Stackly's own pages.",
          [{"person", "human", "ai", "bot", "robot", "real"}, {"you"}], {"are", "who"}, draft=True),
    Entry("fy", "Q3 FY27 is the third quarter of the 2026-27 financial year, October to December 2026. India's "
          "financial year runs from April to March.", [{"fy", "fiscal", "financial"}], {"year", "quarter", "q3", "meaning"},
          draft=True),
    Entry("pe", "A P/E ratio is a share's price divided by the company's profit per share. It says how many rupees "
          "people pay for each rupee of yearly profit. Stackly's forecasts don't use it.", [{"pe"}], draft=True),
    Entry("ebitda", "EBITDA is profit before interest, tax, depreciation and amortisation. Stackly's operating margin "
          "is a close cousin: it also leaves out interest and tax.", [{"ebitda"}], draft=True),
    Entry("marketcap", "Market capitalisation is a company's share price multiplied by the number of its shares: what "
          "the whole company is worth on the stock market.", [{"marketcap"}], draft=True),
    Entry("bps", "A basis point (bps) is one hundredth of a percentage point. A margin up 50 bps is up 0.5 percentage "
          "points.", [{"bps"}], draft=True),
    Entry("profit", "Revenue is what a company receives from its sales, before any costs. Profit is what is left after "
          "the costs. A company can sell a lot and still make little profit.", [{"profit"}], {"revenue", "difference"},
          draft=True),
    Entry("why_30", "Stackly shows share prices that are at least 30 days old, so the game is about understanding "
          "results, not trading.", [{"price"}, {"why"}], draft=True),
    Entry("crowd", "The students' median is the middle of everyone's forecasts. It shows only when enough students "
          "forecast the company.", [{"median", "crowd", "students"}], pages={"results"}, draft=True),
    Entry("source", "The league's results are read by hand from each company's filing; the page links to it.",
          [{"source", "come", "filing"}], {"result", "where"}, pages={"results", "research"}, draft=True),
    Entry("yahoo", "The league's figures follow the league's own definitions, read from filings. Yahoo Finance uses "
          "its own definitions, so its margin can differ.", [{"yahoo"}, {"different", "difference", "league", "margin"}],
          {"why"}, draft=True),
    Entry("table", "Each row is one quarter, newest first. Compare a quarter with the same quarter a year earlier, four "
          "rows down.", [{"table", "row"}, {"read", "how", "quarter"}], {"read", "how", "quarter"}, pages={"research"},
          draft=True),
    Entry("margin_moves", "A margin moves when costs grow faster or slower than sales. For a cement maker, fuel and power "
          "are big costs; for an everyday goods maker, raw materials; for an IT company, salaries.",
          [{"margin", "cost", "fuel"}, {"why", "fall", "grow", "rise", "drop", "change", "matter", "move"}], {"why", "cement"},
          draft=True),
    Entry("volume_moves", "Sales volume changes with demand: festivals, monsoons and harvests come round every year, and "
          "prices matter too. Only an approved note on a results page says why one company's volume moved.",
          [{"volume"}, {"why", "fall", "rise", "drop", "change"}], {"why"}, draft=True),
    Entry("what_changed", "Think about what changes a company's quarter: the prices it charges, how much it sells, and "
          "its costs, such as raw materials, fuel or salaries. Compare with the same quarter last year.",
          [{"change", "move", "kinds", "things"}], {"what", "company", "number"}, draft=True),
    Entry("last_quarter", "Last quarter's figure is the same number for the three months just before this quarter.",
          [{"last"}, {"quarter"}], {"card", "meaning", "what"}, draft=True),
    Entry("inside", "Inside means the result landed between your low and your high.", [{"inside", "hit"}],
          {"meaning", "what", "result"}, draft=True),
    Entry("when_scored", "League ranges are scored after the company publishes its results.", [{"score"}, {"when"}],
          {"league", "range"}, draft=True),
    Entry("level_up", "Your level goes up as you play: league forecasts, Practice and quick rounds all count, with a "
          "daily limit on Practice and quick rounds.", [{"level"}, {"how", "grow", "get", "up"}], draft=True),
    Entry("practice_count", "Practice doesn't change your league scores. If you're signed in, it adds to your level, "
          "up to a daily limit.", [{"practice"}, {"count", "save", "level", "matter"}], draft=True),
    Entry("compare_companies", "Companies in the same sector face similar costs and demand, so comparing their margins "
          "shows which one keeps more of each sale.", [{"compare"}, {"company", "companies", "sector"}],
          {"why", "margin", "sector"}, draft=True),
]

# Words with the same meaning (English and common Hinglish), after lower-casing.
SYNONYMS = {
    "kya": "what", "matlab": "meaning", "mean": "meaning", "means": "meaning", "meaning": "meaning", "hota": "",
    "kaise": "how", "kese": "how", "khelte": "play", "khelna": "play", "khelun": "play", "khele": "play", "game": "game",
    "kyun": "why", "kyu": "why", "kyon": "why", "fark": "difference", "antar": "difference", "differ": "difference",
    "different": "different", "shuru": "start", "begin": "start", "rang": "colour", "colours": "colour",
    "colors": "colour", "color": "colour", "chhupi": "hidden", "chupi": "hidden", "hide": "hidden", "hidden": "hidden",
    "pichle": "last", "pichla": "last", "saal": "year", "years": "year", "points": "score", "point": "score",
    "scores": "score", "scoring": "score", "scored": "score", "ank": "score", "milte": "get", "milta": "get",
    "badhta": "grow", "badhti": "grow", "growth": "grow", "girta": "fall", "gira": "fall", "falls": "fall",
    "fell": "fall", "munafa": "profit", "profits": "profit", "kamai": "revenue", "bikri": "sales",
    "ranges": "range", "misses": "miss", "missed": "miss", "changed": "change", "changes": "change", "badal": "change",
    "badalta": "change", "moves": "move", "companies": "company", "compared": "compare", "costs": "cost", "chhoti": "narrow", "choti": "narrow", "badi": "wide", "tight": "narrow",
    "levels": "level", "xp": "level", "badges": "badge", "results": "result", "reports": "report", "quarters": "quarter",
    "difficulty": "difficulty", "challenge": "daily", "roz": "daily", "margins": "margin", "padhein": "read",
    "padhe": "read", "rows": "row", "prices": "price", "bhav": "price", "prizes": "prize",
    "paise": "paisa", "accounting": "", "unlock": "unlock", "replay": "replay", "dobara": "replay", "khel": "play",
    "work": "work", "works": "work", "accha": "good", "acha": "good", "measures": "measure", "karta": "",
    "kitni": "kitna", "howmuch": "howmuch",
}
PHRASES = [
    (r"p\s*/\s*e|price[- ]to[- ]earnings|pe ratio", " pe "), (r"market cap(?:itali[sz]ation)?", " marketcap "),
    (r"basis points?", " bps "), (r"year[- ]on[- ]year", " yoy "), (r"constant currency", " constantcurrency "),
    (r"sign(?:ed|ing)? ?in|log ?in", " sign "), (r"how (?:do|does|to) (?:i |you |we )?play", " play "),
    (r"how (?:does|do) (?:it|this|the game|stackly) work", " play "), (r"kaise khel", " play "),
    (r"8 (?:in|out of|of) 10|80 ?%|8 times", " eight "), (r"q[1-4] ?fy ?\d\d", " fy "),
    (r"underlying volume growth|\buvg\b", " uvg "), (r"percentage points?|\bpp\b", " percentagepoint "),
    (r"results? league", " league "), (r"operating margin", " margin operating "),
]
STOP = {"the", "a", "an", "is", "are", "do", "does", "i", "my", "me", "this", "that", "it", "of", "to", "in", "on",
        "for", "and", "or", "hai", "hain", "ka", "ki", "ke", "ye", "yeh", "mein", "me", "se", "kar", "ko", "aur", "can",
        "be", "should", "would", "will", "were", "about", "please", "with", "at", "if", "so"}


def words(text: str) -> set[str]:
    t = " " + text.lower() + " "
    for pattern, repl in PHRASES:
        t = re.sub(pattern, repl, t)
    out = set()
    for w in re.findall(r"[a-z0-9]+", t):
        w = SYNONYMS.get(w, w)
        if w and w not in STOP:
            out.add(w)
            if len(w) > 4 and w.endswith("s"):
                out.add(w[:-1])
    return out


# Glossary terms become entries: their own words must all appear (or an alias).
ALIASES = {"Year on year (YoY)": {"yoy"}, "Constant currency": {"constantcurrency"},
           "Underlying volume growth (UVG)": {"uvg"}, "Percentage point": {"percentagepoint"}}


def _glossary_entries() -> list[Entry]:
    """Each term's own words must all appear; a short alias (UVG, YoY) also works."""
    out = []
    for g in glossary("IN"):
        term = g["term"]
        own = [w for w in words(re.sub(r"\(.*?\)", "", term)) if len(w) > 2]
        text = f"{term}: {g['definition']}"
        if own and " and " in term:
            out.append(Entry(f"glossary:{term}", text, [set(own)], {"what", "meaning"}, source="glossary"))
        elif own:
            out.append(Entry(f"glossary:{term}", text, [{w} for w in own], {"what", "meaning"}, source="glossary"))
            if {"volume", "grow"} <= set(own) and len(own) > 2:  # "volume growth" alone finds the KPI terms
                out.append(Entry(f"glossary:{term}", text, [{"volume"}, {"grow"}], {"what", "meaning"}, source="glossary"))
        if term in ALIASES:
            out.append(Entry(f"glossary:{term}", text, [ALIASES[term]], {"what", "meaning"}, source="glossary"))
    return out


METRIC_WORDS = {"revenue_growth_yoy": {"revenue", "grow", "sales"}, "operating_margin": {"margin"},
                "sector_kpi": {"volume", "kpi", "sector", "dispatches", "realisation"}}
# Words that really ask for a figure ("what is X" alone asks for a definition).
FIGURE_INTENT = {"howmuch", "kitna", "kitni", "figure", "value", "was", "tha", "thi"}


def _num(v: float, unit: str) -> str:
    return f"{round(v, 1)}{unit}"


def _figure_answer(ctx: Context, q: set[str]) -> Optional[tuple[float, str]]:
    """The page's own figures, in DRAFT one-line templates."""
    if not ctx.figures:
        return None
    wanted = [k for k, ws in METRIC_WORDS.items() if q & ws]
    in_round = ctx.kind in ("round", "practice_case")
    if not wanted and ctx.kind == "results" and (("why" in q and "result" in q) or q & FIGURE_INTENT):
        wanted = list(METRIC_WORDS)  # a results page: every number on it
    if not wanted and in_round and q & (FIGURE_INTENT | {"last"}):
        wanted = [m["metric_key"] for m in ctx.metrics]  # a round has only the card's own number(s)
    asks = q & FIGURE_INTENT or (in_round and "last" in q and "year" in q)
    if not wanted or not (asks or "why" in q):
        return None
    figs = [f for f in ctx.figures if f["metric_key"] in wanted]
    if not figs:
        return None
    if "why" in q:
        notes = [n for n in ctx.notes if n["metric_key"] in wanted]
        if notes:
            return 3.0, " ".join(f"{n['label']}: {n['note']}" for n in notes)
        if ctx.kind == "results":
            return 2.5, f"This page has no approved explanation for {figs[0]['label'].lower()}."
        return None
    lines = []
    if ctx.kind in ("round", "practice_case"):
        for f in figs:
            if f["kind"] == "last_year":
                lines.append(f"Last year's figure for the same quarter is {_num(f['value'], f['unit'])}.")
            elif f["kind"] == "last_quarter":
                lines.append(f"Last quarter's figure is {_num(f['value'], f['unit'])}.")
    elif ctx.kind == "results":
        by = {}
        for f in figs:
            by.setdefault(f["label"], {})[f["kind"]] = f
        for label, d in by.items():
            if "result" in d and "last_year" in d:
                lines.append(f"{label}: the result was {_num(d['result']['value'], d['result']['unit'])}, against "
                             f"{_num(d['last_year']['value'], d['last_year']['unit'])} last year.")
            elif "result" in d:
                lines.append(f"{label}: the result was {_num(d['result']['value'], d['result']['unit'])}.")
    else:
        for f in figs[:2]:
            lines.append(f"On this page, the league's {f['label'].lower()} for {f['quarter']} is {_num(f['value'], f['unit'])}.")
    return (3.0 if q & FIGURE_INTENT else 2.2, " ".join(lines)) if lines else None


def _measure_answer(ctx: Context, q: set[str]) -> Optional[tuple[float, str]]:
    """In a round: "what does this number measure?" gives the card's own definition."""
    if ctx.kind not in ("round", "practice_case") or not ctx.metrics:
        return None
    if not ("measure" in q or ("number" in q and q & {"meaning", "what"} and not q & {"change", "move", "kinds"})):
        return None
    defs = {g["term"]: g["definition"] for g in glossary("IN")}
    found = []
    for m in ctx.metrics:
        term = next((t for t in defs if t == m["label"] or t.startswith(m["label"] + " (")), None)
        if term:
            found.append(f"{m['label']}: {defs[term]}")
    return (2.6, " ".join(found)) if found else None


def _score(e: Entry, q: set[str], kind: str) -> float:
    if e.pages is not None and kind not in e.pages:
        return 0.0
    hits = sum(1 for g in e.must if q & g)
    if hits < (e.min_hits if e.min_hits is not None else len(e.must)):
        return 0.0
    return hits + 0.4 * len(q & e.extra)


def answer(question: str, ctx: Context) -> tuple[str, str]:
    """(answer text, the key of what matched, or "fallback")."""
    q = words(question)
    best, key, score = FALLBACK, "fallback", 0.0
    for e in FAQ + _glossary_entries():
        s = _score(e, q, ctx.kind)
        if s > score:
            best, key, score = e.answer, e.key, s
    for found, name in ((_figure_answer(ctx, q), "figures"), (_measure_answer(ctx, q), "definition")):
        if found and found[0] > score:  # approved text wins a tie
            best, key, score = found[1], name, found[0]
    return best, key


class AnswersEngine:
    """Same interface as the models (guide_model): pieces, then a final with no usage."""

    def __init__(self, ctx: Context):
        self.ctx = ctx
        self.matched = ""

    def stream(self, rules: str, context: str, messages: list[dict]) -> Iterator[tuple]:
        text, self.matched = answer(messages[-1]["content"], self.ctx)
        sentences = [x for x in re.split(r"(?<=[.?!])\s+", text) if x]
        for i, sentence in enumerate(sentences):
            yield ("text", sentence + (" " if i < len(sentences) - 1 else ""))
        yield ("final", "end_turn", Usage())

"""
The AI guide (phase 12; vault: Areas/AI guide plan, decisions of 27 Nov).

Order of checks for every question, all before the model is called:
1. ENABLE_GUIDE and the admin toggle ("off" | "staff" | "on"; with no toggle
   saved, GUIDE_MODE_DEFAULT). Off: 404, as if the guide didn't exist.
2. Signed in (the route), then who may use it: in "staff" mode teachers and
   admins only; otherwise adults, teachers, admins, and under-18s whose
   parent approved both Stackly and the guide.
3. Fake mode is refused on the production database; real calls are refused
   without a key.
4. Caps: 6 a minute and 20 a day per person; $3 a day overall.
5. The page's context (guide_context.build: public figures only).
6. Fixed replies for questions the server can recognise (safety, personal
   details, advice, prices, the hidden company, the answer or a range); no
   model call for those.

Replies stream sentence by sentence: each sentence is checked before it is
sent, so a reply that turns into advice or a range is stopped before those
words reach the browser and is replaced with the fixed reply. Stackly stores
no chat text: only per-person daily counts and the day's overall spend.
"""
import json
import logging
import re
from dataclasses import dataclass
from typing import Iterator, Literal, Optional

import psycopg
from pydantic import BaseModel, Field

from app.config import get_settings
from app.services import audit, db, rate_limit
from app.services.guide_context import ROUND_KINDS, Context, GuidePage, build
from app.services.guide_model import AnthropicModel, FakeModel, Usage, cost_usd
from app.services.league_service import LeagueError
from app.services.progress import today

logger = logging.getLogger("finai")

Mode = Literal["off", "staff", "on"]
MODES = ("off", "staff", "on")

# ---------- Wording (DRAFT, vault: Decisions for Hriday, "AI guide") ----------
REPLIES = {
    "safety": "I'm only an AI guide for Stackly, so I can't help with this, but you don't have to deal with it alone. "
              "Please talk to an adult you trust, or call Tele-MANAS on 14416 (free, any time).",
    "personal": "Please don't share personal details here. I only need your question about Stackly.",
    "advice": "I can't help with buying or selling shares. I can explain what the figures on this page mean, "
              "so you can form your own view.",
    "price": "I can't give a share's current price. Stackly only shows prices that are at least 30 days old.",
    "mystery": "The company is hidden in Mystery mode, so I can't name it or hint at it. I can explain the "
               "number you're forecasting.",
    "answer": "I can't give the result or suggest a range; that part is yours. I can explain what this number "
              "measures, or how last year's figure can help.",
    "offtopic": "I can only help with Stackly: how it works, and the terms and figures on this page.",
    "error": "The guide couldn't answer just now. Please try again.",
}
MESSAGES = {
    "staff_only": "The guide is being tried by teachers first.",
    "profile_required": "Choose your age group in your profile to use the guide.",
    "consent_pending": "The guide opens once a parent or guardian agrees.",
    "guide_consent_needed": "A parent or guardian needs to agree to the guide first.",
    "per_minute": "That's a lot of questions at once. Please wait a minute.",
    "daily_cap": "You've asked {n} questions today. The guide is back tomorrow.",
    "resting": "The guide is resting until tomorrow.",
    "fake_refused": "The guide isn't available here.",
    "no_key": "The guide isn't set up yet.",
}

RULES = """You are the Guide on Stackly, a free educational game where Indian school students forecast listed \
companies' quarterly results as ranges. You are an AI, not a person; never claim or pretend otherwise.

Your job: explain how Stackly works, and the terms and figures on the page the student is on. You may also \
explain general ideas about company results and finance in plain words (what operating margin, a P/E ratio or \
constant currency means; what usually moves a cement maker's margin). Any figure about a company must come only \
from the page context below; if a figure isn't there, say you can't see it on this page. You may say what \
usually moves a number, as general possibilities, but never state why a company's number actually changed \
unless an approved note in the context says so. Never invent numbers, reasons or news.

Hard rules:
- Never recommend buying, selling or holding any share, never give price targets or say where a price will go, \
and never give a share price; Stackly only shows prices at least 30 days old.
- In a round or a Practice forecast, never give the result, a range, a midpoint, an estimate ("around 10%"), \
or say whether the result will be above or below any number. Give hints only: what the number measures, last \
year's figure and last quarter's (as given), and what kinds of change to think about. Choosing the range is \
the student's job.
- In Mystery mode the company is hidden: never name it, guess it, or give clues to which company it is.
- Questions about company results, finance terms and how markets work are on topic. If the question is about \
something else entirely, reply exactly: \
"I can only help with Stackly: how it works, and the terms and figures on this page."
- Never ask for personal details. If the student shares some, don't repeat them.

Style: plain English for a 12 to 18 year old, formal but friendly, at most 90 words, no lists unless asked. \
No exclamation marks, no emojis, no em dashes. Use "%" and "points" the way the page does."""

# ---------- Recognising questions the server answers itself ----------
_I = re.IGNORECASE
SAFETY = re.compile(r"\b(kill myself|suicid\w*|self[- ]?harm|hurt(?:ing)? myself|end my life|want to die|"
                    r"cut(?:ting)? myself|marna chaht[ai]|mar jaun|mar jana|khud ko (?:nuksan|hurt)|"
                    r"(?:being|been|getting) abused|abuses me|touch(?:es|ed) me|threaten(?:s|ed|ing) me|"
                    r"bull(?:y|ies|ied|ying) me)\b", _I)
PHONE = re.compile(r"(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)")
EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[a-z]{2,}", _I)
PERSONAL = re.compile(r"\b(my (?:home )?address is|i live at|my phone(?: number)? is|my number is|"
                      r"mera (?:address|ghar ka pata|number|phone number)|my aadhaar|my password)\b", _I)
ADVICE = re.compile(r"\b(should (?:i|we) (?:buy|sell|hold|invest)|buy or sell|sell or hold|worth (?:buying|investing)|"
                    r"good (?:stock|share|investment|buy) (?:to|for)|is (?:it|this) a good (?:stock|share|buy|investment)|"
                    r"invest (?:in|my)|target price|price target|multibagger|stock tips?|share tips?|"
                    r"which (?:stock|share)s? (?:to|should)|best (?:stock|share)s? to|"
                    r"kharid(?:u|un|na|ein|e|oon)?|bech(?:u|un|na|ein|e|oon)?|lena chahiye|le lu|le loon|"
                    r"paisa lagau|paise lagau|paisa laga(?:na|un|oon)|nivesh|"
                    r"will (?:the |this )?(?:share |stock )?price (?:go|rise|fall|crash)|"
                    r"will (?:the |this )?(?:share|stock) (?:go|rise|fall|crash)|go up or down|upar jayega|niche jayega)\b", _I)
PRICE = re.compile(r"\b(current (?:share |stock )?price|price (?:today|right now|now)|today'?s (?:share )?price|"
                   r"live price|share price (?:today|now|right now)|aaj ka (?:bhav|bhaav|price|rate)|abhi ka (?:price|bhav))\b", _I)
MYSTERY = re.compile(r"\b(which company|what company|company'?s? name|name of (?:the|this) company|"
                     r"kaun ?si company|kon ?si company|konsi company|company ka naam|what is the ticker|which ticker|"
                     r"is (?:it|this) (?:tcs|infosys|wipro|maruti|dabur|marico|ultratech|sagar|mphasis))\b", _I)
ANSWER = re.compile(r"\b(the answer|actual (?:number|figure|result|value)|exact (?:number|figure|value)|"
                    r"real (?:number|result|figure)|what (?:was|is|will be) the (?:result|number|figure)|"
                    r"give me (?:a|the) range|what range|which range|suggest a range|best range|good range|"
                    r"what should (?:my|the) (?:low|high|range) be|(?:low|high) should i|"
                    r"kitna (?:hoga|tha|aayega|aaya|rakhu|rakhun)|sahi (?:jawab|answer|range)|"
                    r"range (?:bata|batao|do|de do|dedo)|between what|guess the (?:number|result))\b", _I)

# On the way out (each sentence before it is sent).
OUT_ADVICE = re.compile(r"\b(you should (?:buy|sell|hold|invest)|(?:i|we) (?:would )?(?:recommend|suggest) "
                        r"(?:buying|selling|holding|investing)|good time to (?:buy|sell)|target price|price target|"
                        r"strong buy|worth buying)\b", _I)
OUT_RANGE = re.compile(r"(between\s+-?\d[\d.,]*\s*%?\s*(?:and|to)\s+-?\d)|"
                       r"(-?\d[\d.,]*\s*%?\s*(?:to|–)\s*-?\d[\d.,]*\s*%)|"
                       r"(\brange (?:of|from)\s+-?\d)|"
                       r"(\b(?:around|about|roughly|close to|near|approximately)\s+-?\d)", _I)


def classify(question: str, ctx: Context) -> Optional[str]:
    if SAFETY.search(question):
        return "safety"
    if PHONE.search(question) or EMAIL.search(question) or PERSONAL.search(question):
        return "personal"
    if ADVICE.search(question):
        return "advice"
    if PRICE.search(question):
        return "price"
    if ctx.mystery and ctx.in_round and MYSTERY.search(question):
        return "mystery"
    if ctx.kind in ROUND_KINDS and ANSWER.search(question):
        return "answer"
    return None


def check_output(text: str, ctx: Context) -> Optional[str]:
    if OUT_ADVICE.search(text):
        return "advice"
    if ctx.kind in ROUND_KINDS and OUT_RANGE.search(text):
        return "answer"
    low = text.lower()
    for name in ctx.forbidden_names:
        full = (name or "").strip().lower()
        # "Demo Cement (fictional)" is also caught as "Demo Cement".
        for n in {full, re.sub(r"\s*\(.*?\)\s*", " ", full).strip()}:
            if len(n) >= 3 and re.search(rf"(?<!\w){re.escape(n)}(?!\w)", low):
                return "mystery"
    return None


_SENTENCE_END = re.compile(r"[.?!:;]\s|\n")


class SentenceGate:
    """Holds streamed text back until a sentence ends, checks everything said
    so far, and only then lets the sentence out. After a failed check it
    sends nothing more."""

    def __init__(self, ctx: Context):
        self.ctx = ctx
        self.sent = ""
        self.pending = ""
        self.tripped: Optional[str] = None

    def _release(self, upto: int) -> str:
        piece, self.pending = self.pending[:upto], self.pending[upto:]
        if self.tripped:
            return ""
        outcome = check_output(self.sent + piece, self.ctx)
        if outcome:
            self.tripped = outcome
            return ""
        self.sent += piece
        return piece

    def feed(self, text: str) -> str:
        self.pending += text
        last = None
        for m in _SENTENCE_END.finditer(self.pending):
            last = m.end()
        return self._release(last) if last else ""

    def finish(self) -> str:
        return self._release(len(self.pending)) if self.pending else ""


# ---------- Switches ----------

def effective_mode(conn: psycopg.Connection) -> Mode:
    row = conn.execute("SELECT value FROM site_switches WHERE key = 'guide'").fetchone()
    value = row["value"] if row else get_settings().guide_mode_default
    return value if value in MODES else "off"


def set_mode(conn: psycopg.Connection, actor: dict, mode: Mode) -> None:
    before = effective_mode(conn)
    conn.execute("""INSERT INTO site_switches (key, value) VALUES ('guide', %s)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()""", (mode,))
    audit.write(conn, actor["id"], "update", "site_switch", "guide", {"before": before, "after": mode})


def live_mode(conn: psycopg.Connection) -> Mode:
    return effective_mode(conn) if get_settings().enable_guide else "off"


def offered_to_parents(conn: psycopg.Connection) -> bool:
    """The parent tick, the printable form's guide paragraph and the teacher's
    guide column show only while the guide is on for students."""
    return live_mode(conn) == "on"


# ---------- Who may use it ----------

def _is_staff(user: dict) -> bool:
    return bool(user.get("is_admin") or user.get("role") in ("teacher", "admin"))


def refusal(conn: psycopg.Connection, user: dict, mode: Mode) -> Optional[tuple[int, str]]:
    if mode == "off":
        return (404, "off")
    if _is_staff(user):
        return None
    if mode == "staff":
        return (403, "staff_only")
    row = conn.execute("SELECT age_band, guardian_consent_status, guide_consent FROM users WHERE id = %s",
                       (user["id"],)).fetchone()
    if row is None or row["age_band"] is None:
        return (403, "profile_required")
    if row["age_band"] == "under_18":
        if row["guardian_consent_status"] != "granted":
            return (403, "consent_pending")
        if not row["guide_consent"]:
            return (403, "guide_consent_needed")
    return None


class StatusOut(BaseModel):
    available: bool
    reason: Optional[str] = None
    message: Optional[str] = None
    left: Optional[int] = None  # only when 3 or fewer questions are left today


def _questions_today(conn: psycopg.Connection, user_id: int) -> int:
    row = conn.execute("SELECT questions FROM guide_usage WHERE user_id = %s AND day = %s",
                       (user_id, today(conn))).fetchone()
    return row["questions"] if row else 0


def _left(conn: psycopg.Connection, user_id: int) -> Optional[int]:
    left = max(0, get_settings().guide_daily_questions - _questions_today(conn, user_id))
    return left if left <= 3 else None


def status(conn: psycopg.Connection, user: Optional[dict]) -> StatusOut:
    if user is None:
        return StatusOut(available=False, reason="signed_out")
    mode = live_mode(conn)
    refused = refusal(conn, user, mode)
    if refused:
        code = refused[1]
        return StatusOut(available=False, reason=code, message=MESSAGES.get(code))
    return StatusOut(available=True, left=_left(conn, user["id"]))


# ---------- Asking ----------

class Turn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=1500)


class AskIn(BaseModel):
    page: GuidePage
    question: str = Field(min_length=1, max_length=500)
    history: list[Turn] = Field(default_factory=list, max_length=6)

    model_config = {"extra": "forbid"}


@dataclass
class Prepared:
    user_id: int
    ctx: Context
    fixed: Optional[str]  # a fixed reply's key, or None to ask the model
    model: object
    model_name: str
    geo: str


def _model_for(kind: str):
    s = get_settings()
    if s.guide_fake_model:
        if db.DATABASE_LABEL == "production":
            raise LeagueError(503, "fake_refused", MESSAGES["fake_refused"])
        return FakeModel(kind)
    if not s.anthropic_api_key:
        raise LeagueError(503, "no_key", MESSAGES["no_key"])
    return AnthropicModel(s.anthropic_api_key, s.guide_model, s.guide_inference_geo)


def prepare(conn: psycopg.Connection, user: dict, body: AskIn) -> Prepared:
    s = get_settings()
    refused = refusal(conn, user, live_mode(conn))
    if refused:
        status_code, code = refused
        raise LeagueError(status_code, code, MESSAGES.get(code, "Not found"))
    model = _model_for(body.page.kind)
    if not rate_limit.check_key("guide", str(user["id"]), [(60, s.guide_per_minute)]).allowed:
        raise LeagueError(429, "per_minute", MESSAGES["per_minute"])
    day = today(conn)
    if _questions_today(conn, user["id"]) >= s.guide_daily_questions:
        raise LeagueError(429, "daily_cap", MESSAGES["daily_cap"].format(n=s.guide_daily_questions))
    spent = conn.execute("SELECT usd FROM guide_spend WHERE day = %s", (day,)).fetchone()
    if spent and spent["usd"] >= s.guide_daily_spend_usd:
        raise LeagueError(429, "resting", MESSAGES["resting"])
    ctx = build(conn, body.page)
    fixed = classify(body.question, ctx)
    conn.execute(
        """INSERT INTO guide_usage (user_id, day, questions, redirects) VALUES (%s, %s, 1, %s)
           ON CONFLICT (user_id, day) DO UPDATE SET questions = guide_usage.questions + 1,
                                                    redirects = guide_usage.redirects + EXCLUDED.redirects""",
        (user["id"], day, 1 if fixed else 0))
    return Prepared(user_id=user["id"], ctx=ctx, fixed=fixed, model=model,
                    model_name=s.guide_model, geo=s.guide_inference_geo)


def _line(obj: dict) -> str:
    return json.dumps(obj, ensure_ascii=False) + "\n"


def _record(user_id: int, usage: Usage, usd: float, redirected: bool) -> Optional[int]:
    with db.get_conn() as conn:
        day = today(conn)
        conn.execute(
            """INSERT INTO guide_spend (day, calls, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, usd)
               VALUES (%s, 1, %s, %s, %s, %s, %s)
               ON CONFLICT (day) DO UPDATE SET calls = guide_spend.calls + 1,
                   input_tokens = guide_spend.input_tokens + EXCLUDED.input_tokens,
                   cache_read_tokens = guide_spend.cache_read_tokens + EXCLUDED.cache_read_tokens,
                   cache_write_tokens = guide_spend.cache_write_tokens + EXCLUDED.cache_write_tokens,
                   output_tokens = guide_spend.output_tokens + EXCLUDED.output_tokens,
                   usd = guide_spend.usd + EXCLUDED.usd""",
            (day, usage.input_tokens, usage.cache_read_tokens, usage.cache_write_tokens, usage.output_tokens, usd))
        if redirected:
            conn.execute("UPDATE guide_usage SET redirects = redirects + 1 WHERE user_id = %s AND day = %s",
                         (user_id, day))
        return _left(conn, user_id)


def stream(p: Prepared, body: AskIn) -> Iterator[str]:
    """NDJSON lines: {"type": "text"} pieces, at most one {"type": "replace"}
    (a fixed reply that replaces everything sent so far), then {"type": "done"}."""
    if p.fixed:
        yield _line({"type": "replace", "text": REPLIES[p.fixed], "outcome": p.fixed})
        with db.get_conn() as conn:
            left = _left(conn, p.user_id)
        yield _line({"type": "done", "outcome": p.fixed, "left": left})
        return
    gate = SentenceGate(p.ctx)
    messages = [{"role": t.role, "content": t.content} for t in body.history]
    messages.append({"role": "user", "content": body.question})
    usage, stop = Usage(), ""
    try:
        for piece in p.model.stream(RULES, p.ctx.text, messages):
            if piece[0] == "text":
                out = gate.feed(piece[1])
                if out:
                    yield _line({"type": "text", "text": out})
            else:
                stop, usage = piece[1], piece[2]
        tail = gate.finish()
        if tail:
            yield _line({"type": "text", "text": tail})
    except Exception:  # noqa: BLE001 -- never the message text in the log, only that a call failed
        logger.warning("Guide model call failed (%s)", type(p.model).__name__)
        yield _line({"type": "replace", "text": REPLIES["error"], "outcome": "error"})
        yield _line({"type": "done", "outcome": "error", "left": None})
        return
    outcome = gate.tripped or ("offtopic" if gate.sent.strip() == REPLIES["offtopic"] else None)
    if stop == "refusal" and not gate.tripped:
        outcome = "offtopic"
    if gate.tripped or stop == "refusal":
        yield _line({"type": "replace", "text": REPLIES[outcome], "outcome": outcome})
    left = _record(p.user_id, usage, cost_usd(p.model_name, p.geo, usage), outcome is not None)
    yield _line({"type": "done", "outcome": outcome or "answered", "left": left})


# ---------- Admin ----------

class AdminGuideOut(BaseModel):
    mode: Mode
    env_enabled: bool
    fake: bool
    model: str
    key_set: bool
    today_usd: float
    today_calls: int
    spend_cap_usd: float


def admin_state(conn: psycopg.Connection) -> AdminGuideOut:
    s = get_settings()
    row = conn.execute("SELECT usd, calls FROM guide_spend WHERE day = %s", (today(conn),)).fetchone()
    return AdminGuideOut(mode=effective_mode(conn), env_enabled=s.enable_guide, fake=s.guide_fake_model,
                         model=s.guide_model, key_set=bool(s.anthropic_api_key),
                         today_usd=round(row["usd"], 4) if row else 0.0, today_calls=row["calls"] if row else 0,
                         spend_cap_usd=s.guide_daily_spend_usd)

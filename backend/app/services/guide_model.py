"""
The model behind the AI guide (phase 12): Anthropic's API through the
official SDK, or a fake with canned replies for previews and tests.

Both yield ("text", chunk) pieces as they arrive and end with one
("final", stop_reason, Usage). Nothing here stores or logs the messages.

The fake is refused on the production database and the real client is
refused without a key (guide.model_for); the fake never opens a network
connection.
"""
from dataclasses import dataclass
from typing import Iterator, Union

from app.config import get_settings

Piece = Union[tuple[str, str], tuple[str, str, "Usage"]]


@dataclass
class Usage:
    input_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    output_tokens: int = 0


# US dollars per million tokens: input, cache read, cache write (5 min), output.
# Anthropic's pricing page, read 27 Nov 2026. An unknown model is priced as
# the most expensive one listed, so the spend cap errs on the safe side.
PRICES: dict[str, tuple[float, float, float, float]] = {
    "claude-haiku-5-5": (0.10, 0.01, 0.125, 0.50),
    "claude-sonnet-5-5": (2.00, 0.10, 2.50, 10.00),
    "claude-opus-5-5": (4.00, 0.20, 5.00, 20.00),
}
US_ONLY = 1.1  # inference_geo "us"


def cost_usd(model: str, geo: str, usage: Usage) -> float:
    i, c, w, o = PRICES.get(model, PRICES["claude-opus-5-5"])
    usd = (usage.input_tokens * i + usage.cache_read_tokens * c + usage.cache_write_tokens * w
           + usage.output_tokens * o) / 1_000_000
    return usd * (US_ONLY if geo == "us" else 1.0)


class AnthropicModel:
    """Claude through the official SDK, streamed. The fixed instructions are
    cached; the page context follows them in the system prompt."""

    def __init__(self, api_key: str, model: str, geo: str):
        import anthropic  # only when a real call is configured

        self.client = anthropic.Anthropic(api_key=api_key, max_retries=1, timeout=30.0)
        self.model = model
        self.geo = geo

    def stream(self, rules: str, context: str, messages: list[dict]) -> Iterator[Piece]:
        with self.client.messages.stream(
            model=self.model,
            max_tokens=1024,
            system=[
                {"type": "text", "text": rules, "cache_control": {"type": "ephemeral"}},
                {"type": "text", "text": context},
            ],
            messages=messages,
            output_config={"effort": "low"},
            inference_geo=self.geo,
        ) as stream:
            for text in stream.text_stream:
                yield ("text", text)
            final = stream.get_final_message()
        u = final.usage
        yield ("final", final.stop_reason or "", Usage(
            input_tokens=u.input_tokens or 0,
            cache_read_tokens=getattr(u, "cache_read_input_tokens", 0) or 0,
            cache_write_tokens=getattr(u, "cache_creation_input_tokens", 0) or 0,
            output_tokens=u.output_tokens or 0,
        ))


# Canned replies for fake mode (previews, tests, the red-team wiring run).
FAKE_REPLIES = {
    "home": "A round asks for a range, a low and a high, for one number from a company's results. "
            "A narrower range scores more, but only if the result lands inside it.",
    "learn": "Each page of the guide covers one idea. Scoring is on page 4: a range that catches the result "
             "scores, and a narrow one scores more.",
    "practice": "Practice uses past quarters. Emerald cards are Easy, cobalt are Medium and violet are Hard.",
    "round": "Start at last year's figure, the mark on the bar. Then ask what has changed since then for this "
             "kind of company: costs, demand, prices. Choosing the range is up to you.",
    "practice_case": "Start from last year's figures. Ask what changed since: costs, demand, prices. "
                     "Choosing the ranges is up to you.",
    "results": "This page shows each result next to last year's figure. Where the page has an approved note, "
               "it explains what moved the number.",
    "research": "Operating margin is the share of revenue left after the costs of running the business, "
                "before interest and tax.",
}


class FakeModel:
    """No network: a canned reply for the page, in a few pieces."""

    def __init__(self, kind: str):
        self.kind = kind

    def stream(self, rules: str, context: str, messages: list[dict]) -> Iterator[Piece]:
        reply = FAKE_REPLIES.get(self.kind, FAKE_REPLIES["home"])
        words = reply.split(" ")
        for i in range(0, len(words), 6):
            yield ("text", " ".join(words[i:i + 6]) + (" " if i + 6 < len(words) else ""))
        yield ("final", "end_turn", Usage())


def settings_model() -> tuple[str, str]:
    s = get_settings()
    return s.guide_model, s.guide_inference_geo

"""
Wraps the Moonshot AI (Kimi) API for the in-app chat assistant. Active by
default (see app/main.py) -- app/services/deepseek_service.py and
app/services/claude_service.py are kept as alternate implementations (same
swap pattern as the data providers, TapetideProvider/YFinanceProvider).

Moonshot's Chat Completions API is OpenAI-compatible plain JSON over HTTPS
(https://platform.kimi.ai/docs/api/chat) -- no SDK required, just `requests`.
This is the only module that reads `MOONSHOT_API_KEY`; the key is read
server-side via app/config.py and never sent to the frontend.

Two things verified against the live API docs, not guessed:
- The request body field is `max_completion_tokens`, NOT `max_tokens` --
  Moonshot's docs explicitly call `max_tokens` deprecated.
- Base URL is `https://api.moonshot.ai`, endpoint `/v1/chat/completions`
  (note the `/v1` prefix, unlike DeepSeek's bare `/chat/completions`).

Model IDs: `kimi-k2.6` (general-purpose, used by default here); other
options include `kimi-k2.7-code` (coding-specialized) and the legacy
`moonshot-v1-*` family -- see config.py to change it.

The assistant's scope (financial education only, no investment advice) lives
in app/services/ai_prompt.py, shared across all three AI backends -- change
it there, not here, if you need to touch the system prompt.
"""
import requests

from app.config import get_settings
from app.models import ChatMessage, CompanyFinancialsResponse
from app.services.ai_prompt import build_system_prompt

_ENDPOINT = "https://api.moonshot.ai/v1/chat/completions"


def get_chat_reply(
    message: str,
    history: list[ChatMessage],
    context: CompanyFinancialsResponse | None,
) -> str:
    settings = get_settings()
    if not settings.moonshot_api_key:
        raise RuntimeError(
            "MOONSHOT_API_KEY is not configured on the server. Add it to backend/.env "
            "(see backend/.env.example)."
        )

    system = build_system_prompt(context)
    messages = [{"role": "system", "content": system}]
    messages.extend({"role": m.role, "content": m.content} for m in history)
    messages.append({"role": "user", "content": message})

    try:
        resp = requests.post(
            _ENDPOINT,
            headers={
                "Authorization": f"Bearer {settings.moonshot_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.moonshot_model,
                "messages": messages,
                "max_completion_tokens": 1024,
                "stream": False,
            },
            timeout=30,
        )
    except requests.RequestException as exc:
        raise RuntimeError(f"Couldn't reach Moonshot: {exc}") from exc

    if resp.status_code == 401:
        raise RuntimeError("Moonshot rejected the configured MOONSHOT_API_KEY -- check backend/.env.")
    if resp.status_code in (402, 429):
        # Moonshot maps billing suspension ("insufficient balance") to HTTP 429
        # with type "exceeded_current_quota_error", not 402 -- distinguish that
        # from an actual rate limit so the message isn't misleading.
        error_type = ""
        try:
            error_type = resp.json().get("error", {}).get("type", "")
        except ValueError:
            pass
        if resp.status_code == 402 or error_type == "exceeded_current_quota_error":
            raise RuntimeError(
                "Your Moonshot account has insufficient balance. Add credits at "
                "https://platform.kimi.ai and try again."
            )
        raise RuntimeError("Moonshot's rate limit was hit. Please wait a moment and try again.")
    if resp.status_code != 200:
        raise RuntimeError(f"Moonshot returned HTTP {resp.status_code}: {resp.text[:300]}")

    body = resp.json()
    choices = body.get("choices") or []
    if not choices:
        return "I wasn't able to generate a response. Please try again."
    content = choices[0].get("message", {}).get("content", "")
    return content.strip() or "I wasn't able to generate a response. Please try again."

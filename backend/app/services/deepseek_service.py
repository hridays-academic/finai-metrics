"""
Wraps the DeepSeek API for the in-app chat assistant. Alternate
implementation -- app/services/moonshot_service.py is the active default
(wired in app/main.py); app/services/claude_service.py is a second alternate
using Claude/Anthropic (same pattern as the data provider swap between
TapetideProvider/YFinanceProvider).

DeepSeek's Chat Completions API is OpenAI-compatible plain JSON over HTTPS
(https://api-docs.deepseek.com/api/create-chat-completion/) -- no SDK
required, just `requests`. This is the only module that reads
`DEEPSEEK_API_KEY`; the key is read server-side via app/config.py and never
sent to the frontend.

Model IDs: `deepseek-chat`/`deepseek-reasoner` are legacy aliases being
retired 2026-07-24 in favor of `deepseek-v4-flash` (fast, used by default
here) and `deepseek-v4-pro` (higher-capability); see config.py to change it.

The assistant's scope (financial education only, no investment advice) lives
in app/services/ai_prompt.py, shared with claude_service.py -- change it
there, not here, if you need to touch the system prompt.
"""
import requests

from app.config import get_settings
from app.models import ChatMessage, CompanyFinancialsResponse
from app.services.ai_prompt import build_system_prompt

_ENDPOINT = "https://api.deepseek.com/chat/completions"


def get_chat_reply(
    message: str,
    history: list[ChatMessage],
    context: CompanyFinancialsResponse | None,
) -> str:
    settings = get_settings()
    if not settings.deepseek_api_key:
        raise RuntimeError(
            "DEEPSEEK_API_KEY is not configured on the server. Add it to backend/.env "
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
                "Authorization": f"Bearer {settings.deepseek_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.deepseek_model,
                "messages": messages,
                "max_tokens": 1024,
                "stream": False,
            },
            timeout=30,
        )
    except requests.RequestException as exc:
        raise RuntimeError(f"Couldn't reach DeepSeek: {exc}") from exc

    if resp.status_code == 401:
        raise RuntimeError("DeepSeek rejected the configured DEEPSEEK_API_KEY -- check backend/.env.")
    if resp.status_code == 402:
        raise RuntimeError(
            "Your DeepSeek account has insufficient balance. Add credits at "
            "https://platform.deepseek.com/top_up and try again."
        )
    if resp.status_code == 429:
        raise RuntimeError("DeepSeek's rate limit was hit. Please wait a moment and try again.")
    if resp.status_code != 200:
        raise RuntimeError(f"DeepSeek returned HTTP {resp.status_code}: {resp.text[:300]}")

    body = resp.json()
    choices = body.get("choices") or []
    if not choices:
        return "I wasn't able to generate a response. Please try again."
    content = choices[0].get("message", {}).get("content", "")
    return content.strip() or "I wasn't able to generate a response. Please try again."

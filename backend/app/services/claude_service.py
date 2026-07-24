"""
Wraps the Anthropic Claude API for the in-app chat assistant.

Alternate implementation -- app/services/deepseek_service.py is the active
default (wired in app/main.py). Kept as a reference for how to swap the AI
backend back to Claude: this is the only module that imports the `anthropic`
SDK or reads `ANTHROPIC_API_KEY`, and the key is read server-side via
app/config.py and never sent to the frontend. To reactivate: add `anthropic`
back to requirements.txt, `pip install` it, and swap the import in main.py.

The assistant's scope (financial education only, no investment advice) lives
in app/services/ai_prompt.py, shared with deepseek_service.py -- change it
there, not here, if you need to touch the system prompt.
"""
from anthropic import Anthropic

from app.config import get_settings
from app.models import ChatMessage, CompanyFinancialsResponse
from app.services.ai_prompt import build_system_prompt


def get_chat_reply(
    message: str,
    history: list[ChatMessage],
    context: CompanyFinancialsResponse | None,
) -> str:
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not configured on the server. Add it to backend/.env "
            "(see backend/.env.example)."
        )

    client = Anthropic(api_key=settings.anthropic_api_key)
    system = build_system_prompt(context)

    messages = [{"role": m.role, "content": m.content} for m in history]
    messages.append({"role": "user", "content": message})

    response = client.messages.create(
        model=settings.claude_model,
        max_tokens=1024,
        system=system,
        messages=messages,
    )

    text_blocks = [block.text for block in response.content if block.type == "text"]
    return "".join(text_blocks).strip() or "I wasn't able to generate a response. Please try again."

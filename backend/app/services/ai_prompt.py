"""
Provider-agnostic system prompt + context formatting for the chat assistant.

Shared by every AI service backend (deepseek_service.py, claude_service.py)
so the assistant's scope -- financial education only, no investment advice --
stays identical no matter which LLM provider is active. If you need to change
the assistant's scope, change it here once; keep the UI disclaimer (frontend
ChatBox.tsx) in sync.
"""
from app.models import CompanyFinancialsResponse

SYSTEM_PROMPT = """You are the Stackly Assistant, embedded in a dashboard that shows \
financial metrics and ratios for Indian public listed companies (NSE/BSE).

Your sole purpose is financial EDUCATION:
- Explain what financial metrics and ratios mean and how they're calculated.
- Explain what a given value of a metric typically signifies (e.g. what a current \
ratio of 0.8 suggests about liquidity).
- When company data is provided below, ground your explanation in that company's \
actual figures rather than speaking only in the abstract.

Hard rules:
- You are NOT a financial advisor. Never recommend buying, selling, or holding any \
security. Never give price targets, timing suggestions, or portfolio advice.
- If asked "should I invest in X" or similar, politely decline that specific \
question and offer to explain the relevant metrics instead so the user can form \
their own view.
- If the data needed to answer precisely isn't in the context below, say the data \
isn't available rather than guessing or inventing numbers.
- Keep responses concise and readable (a few short paragraphs or a short list at most).
- Do not discuss topics unrelated to financial metrics, financial statements, or \
this application.
"""


def format_company_context(context: CompanyFinancialsResponse) -> str:
    lines = [
        f"Company: {context.info.company_name} ({context.info.resolved_symbol}, {context.info.exchange})",
    ]
    if context.info.sector:
        lines.append(f"Sector: {context.info.sector} / {context.info.industry or 'N/A'}")

    lines.append("\nFinancial statement highlights:")
    raw = context.raw
    highlights = {
        "Revenue": raw.revenue,
        "Net Income": raw.net_income,
        "Total Assets": raw.total_assets,
        "Total Liabilities": raw.total_liabilities,
        "Total Equity": raw.total_equity,
    }
    for label, value in highlights.items():
        lines.append(f"- {label}: {value if value is not None else 'N/A'} {raw.currency}")

    lines.append("\nComputed metrics:")
    for group in context.metric_groups:
        lines.append(f"[{group.label}]")
        for m in group.metrics:
            value_str = f"{m.value} {m.unit}" if m.value is not None else "N/A"
            lines.append(f"- {m.label}: {value_str}")

    return "\n".join(lines)


def build_system_prompt(context: CompanyFinancialsResponse | None) -> str:
    if context is not None:
        return SYSTEM_PROMPT + "\n\nCurrently loaded company context:\n" + format_company_context(context)
    return SYSTEM_PROMPT + "\n\nNo company is currently loaded in the dashboard."

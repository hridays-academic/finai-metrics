"""
Sends transactional email via Resend's HTTP API (https://resend.com) --
free tier covers 3,000 emails/month with no credit card required. Used
only for password-reset links (see auth_service.py's
request_password_reset, called from main.py's /api/auth/forgot-password)
as of this writing. Plain `requests` POST against Resend's REST API --
no SDK dependency needed, it's a single simple endpoint.
"""
import logging

import requests

from app.config import get_settings

logger = logging.getLogger("finai")

_RESEND_API_URL = "https://api.resend.com/emails"
# Resend's own shared sending address -- works out of the box with zero
# domain setup. Switch to a verified custom domain address (set
# RESEND_FROM_EMAIL) once one's configured in the Resend dashboard; mail
# "via resend.dev" is fine to start with but reads less polished long-term.
_DEFAULT_FROM = "Stackly <onboarding@resend.dev>"


class EmailSendError(Exception):
    """Raised when Resend isn't configured, rejects the request, or the
    HTTP call itself fails. Callers should catch this and still return
    their normal success response to the client -- see the module
    docstring on why a send failure must never be distinguishable from
    success at the API boundary (it would leak which emails have accounts,
    the same reason request_password_reset itself never reveals that)."""


def send_password_reset_email(to_email: str, name: str, reset_link: str) -> None:
    settings = get_settings()
    if not settings.resend_api_key:
        logger.error(
            "RESEND_API_KEY is not configured -- can't send password reset email to %s", to_email
        )
        raise EmailSendError("Email sending is not configured.")

    html = f"""
        <p>Hi {name},</p>
        <p>Someone requested a password reset for your Stackly account. If this was you,
        click below to set a new password:</p>
        <p><a href="{reset_link}">{reset_link}</a></p>
        <p>This link expires in 30 minutes and can only be used once. If you didn't request
        this, you can safely ignore this email -- your password hasn't been changed.</p>
    """
    try:
        response = requests.post(
            _RESEND_API_URL,
            headers={
                "Authorization": f"Bearer {settings.resend_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "from": settings.resend_from_email or _DEFAULT_FROM,
                "to": [to_email],
                "subject": "Reset your Stackly password",
                "html": html,
            },
            timeout=10,
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        logger.error("Resend API call failed sending password reset to %s: %s", to_email, exc)
        raise EmailSendError("Couldn't send the reset email right now.") from exc

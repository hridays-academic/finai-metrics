"""
Sends transactional email via Gmail's own SMTP server, using an existing
Gmail account rather than a new third-party provider (see CLAUDE.md's
"Forgot password" section for why this replaced Resend). No new package --
`smtplib`/`email` are Python stdlib.

Requires a Gmail *App Password*, not the account's real password -- Google
blocks plain-password SMTP auth by default. Generate one at
https://myaccount.google.com/apppasswords (needs 2-Step Verification turned
on for the account first, which is Google's own requirement for issuing App
Passwords, not something this app imposes). The address that password
belongs to becomes the visible "From" on every email this sends, which is
the real tradeoff versus a dedicated transactional-email provider: mail
comes from a personal-looking Gmail address, is capped around Gmail's own
~500-recipients/day sending limit, and a compromised App Password can send
mail as that account (scope: only as this app's password-reset sender, but
still real access) -- accepted deliberately in exchange for not creating a
new external account at all.
"""
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.config import get_settings

logger = logging.getLogger("finai")

_SMTP_HOST = "smtp.gmail.com"
_SMTP_PORT = 465  # implicit TLS (SMTPS), not STARTTLS -- simpler, no upgrade handshake needed


class EmailSendError(Exception):
    """Raised when Gmail isn't configured or the SMTP call fails. Callers
    must still return their normal success response to the client -- see
    the module docstring on why a send failure must never be
    distinguishable from success at the API boundary (it would leak which
    emails have accounts, the same reason request_password_reset itself
    never reveals that)."""


def send_password_reset_email(to_email: str, name: str, reset_link: str) -> None:
    settings = get_settings()
    if not settings.gmail_address or not settings.gmail_app_password:
        logger.error(
            "GMAIL_ADDRESS/GMAIL_APP_PASSWORD are not configured -- can't send "
            "password reset email to %s",
            to_email,
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
    message = MIMEMultipart("alternative")
    message["Subject"] = "Reset your Stackly password"
    message["From"] = settings.gmail_address
    message["To"] = to_email
    message.attach(MIMEText(html, "html"))

    try:
        with smtplib.SMTP_SSL(_SMTP_HOST, _SMTP_PORT, timeout=10) as server:
            server.login(settings.gmail_address, settings.gmail_app_password)
            server.sendmail(settings.gmail_address, [to_email], message.as_string())
    except smtplib.SMTPException as exc:
        logger.error("Gmail SMTP send failed for %s: %s", to_email, exc)
        raise EmailSendError("Couldn't send the reset email right now.") from exc

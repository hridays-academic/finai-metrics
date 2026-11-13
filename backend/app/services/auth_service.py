"""
Account creation, login, session tokens, and activity logging -- backed by
db.py's Postgres tables (Neon). Password hashing uses the stdlib
`hashlib.pbkdf2_hmac` (SHA-256, 200,000 iterations, random 16-byte salt per
user) rather than adding a bcrypt/argon2 dependency -- PBKDF2 via hashlib
needs no new package and is still a legitimate, widely-used choice (it's
literally what Django's default password hasher used for years). Never
store or log a plaintext password anywhere, including in exceptions.

Sessions are opaque random tokens (`secrets.token_urlsafe`), stored server-
side in the `sessions` table with an expiry -- not a JWT. That means every
request needing auth does a DB lookup rather than verifying a signature,
which is the right tradeoff at this scale (a few users) since it makes
"sign out everywhere" / revocation trivial (just delete the row), which a
stateless JWT can't do without extra machinery.

(2026-07) **Google Sign-In** (`login_with_google`) is a second way into an
account, alongside email+password -- `main.py`'s `/api/auth/google`
verifies the Google ID token first (this file trusts its inputs, doesn't
re-verify anything), then this just finds-or-creates a user by `google_id`
(falling back to a match on `email`, which links Google Sign-In onto an
existing password account rather than creating a duplicate -- safe since
Google already vouched for that email). A Google-created account has no
password at all (`password_hash`/`password_salt` are nullable now, see
db.py) -- it never sets one, so there's nothing to guess or leak.

(2026-09) **"Forgot password"** (`request_password_reset`/`reset_password`)
issues a single-use, 30-minute reset token (hashed before storage in
`password_reset_tokens`, unlike `sessions.token` -- see db.py's schema
comment for why a reset token gets that extra treatment) and emails a
reset link via Gmail's own SMTP (`gmail_service.py`). `request_password_reset`
returns `None` for both "no such email" and "Google-only account, nothing
to reset" -- `main.py`'s `/api/auth/forgot-password` must always return
the identical generic response regardless, or the endpoint becomes an
email-enumeration oracle.
"""
import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.config import get_settings
from app.services import audit
from app.services.db import get_conn, purge_expired_personal_data

PBKDF2_ITERATIONS = 200_000
SESSION_TTL_DAYS = 30
RESET_TOKEN_TTL_MINUTES = 30
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# The Terms of Use / Privacy Policy version a user agrees to (the date the
# pages were last changed). Bump it when either page changes materially:
# every account whose terms_version differs is asked to agree again.
TERMS_VERSION = "2026-11-13"
_TERMS_REQUIRED = "Please agree to the Terms of Use and Privacy Policy to create an account."


class AuthError(Exception):
    """User-facing auth failure (bad credentials, duplicate email, etc.)."""


class TermsRequiredError(AuthError):
    """A new account (here, via Google) needs the terms checkbox first."""


def _hash_password(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS).hex()


def _hash_reset_token(token: str) -> str:
    """Plain SHA-256, no per-token salt -- unlike a password, a reset token
    is already a full 32-byte random value from secrets.token_urlsafe, so
    it has nowhere near the guessability a salt would need to defend
    against. This only needs to stop "someone read this value out of a DB
    dump" from being equivalent to having the real token."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def sign_up(email: str, name: str, password: str, accept_terms: bool) -> tuple[int, str]:
    """Creates a user and an initial session. Returns (user_id, session_token)."""
    if not accept_terms:
        raise AuthError(_TERMS_REQUIRED)
    email = email.strip().lower()
    name = name.strip()
    if not _EMAIL_RE.match(email):
        raise AuthError("Please enter a valid email address.")
    if not name:
        raise AuthError("Please enter your name.")
    if len(password) < 8:
        raise AuthError("Password must be at least 8 characters.")

    salt = secrets.token_bytes(16)
    password_hash = _hash_password(password, salt)

    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id, google_id FROM users WHERE email = %s", (email,)
        ).fetchone()
        if existing and existing["google_id"]:
            raise AuthError("An account with that email already exists -- sign in with Google instead.")
        if existing:
            raise AuthError("An account with that email already exists. Try signing in instead.")
        # Postgres has no cursor.lastrowid (that's a sqlite3-ism) -- RETURNING
        # is the standard way to get a just-inserted row's generated id back.
        cursor = conn.execute(
            """INSERT INTO users (email, name, password_hash, password_salt, terms_accepted_at, terms_version)
               VALUES (%s, %s, %s, %s, NOW(), %s) RETURNING id""",
            (email, name, password_hash, salt.hex(), TERMS_VERSION),
        )
        user_id = cursor.fetchone()["id"]

    token = _create_session(user_id)
    _log_activity(user_id, "signed_up", None)
    return user_id, token


def log_in(email: str, password: str) -> tuple[int, str]:
    """Verifies credentials and creates a new session. Returns (user_id, session_token)."""
    email = email.strip().lower()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, password_hash, password_salt FROM users WHERE email = %s", (email,)
        ).fetchone()
    # Same error for "no such user", "wrong password", and "this account
    # was created via Google and has no password at all" -- don't reveal
    # which one it was, standard practice to avoid leaking valid emails
    # (and doesn't hint that a given address should try Google Sign-In
    # instead). A Google-only account's password_hash/password_salt are
    # both NULL (see db.py) -- checking that up front avoids a crash on
    # bytes.fromhex(None) below.
    if not row or not row["password_hash"] or not row["password_salt"]:
        raise AuthError("Incorrect email or password.")
    salt = bytes.fromhex(row["password_salt"])
    if _hash_password(password, salt) != row["password_hash"]:
        raise AuthError("Incorrect email or password.")

    token = _create_session(row["id"])
    _log_activity(row["id"], "logged_in", None)
    return row["id"], token


def login_with_google(email: str, name: str, google_id: str, accept_terms: bool = False) -> tuple[int, str]:
    """Finds-or-creates a user from an already-verified Google ID token
    (main.py's /api/auth/google does the actual verification before
    calling this). Matches on google_id first -- the stable identifier --
    falling back to email so a Google sign-in for an address that already
    has a password account links onto it instead of creating a duplicate.
    Returns (user_id, session_token), same shape as sign_up/log_in."""
    email = email.strip().lower()
    name = name.strip() or email
    with get_conn() as conn:
        row = conn.execute("SELECT id FROM users WHERE google_id = %s", (google_id,)).fetchone()
        is_new = False
        if not row:
            row = conn.execute("SELECT id FROM users WHERE email = %s", (email,)).fetchone()
            if row:
                conn.execute("UPDATE users SET google_id = %s WHERE id = %s", (google_id, row["id"]))
        if not row:
            # Nothing is created without the sign-up checkbox; the frontend
            # turns this into "tick the box, then continue with Google".
            if not accept_terms:
                raise TermsRequiredError(_TERMS_REQUIRED)
            cursor = conn.execute(
                """INSERT INTO users (email, name, google_id, terms_accepted_at, terms_version)
                   VALUES (%s, %s, %s, NOW(), %s) RETURNING id""",
                (email, name, google_id, TERMS_VERSION),
            )
            row = cursor.fetchone()
            is_new = True

    user_id = row["id"]
    token = _create_session(user_id)
    _log_activity(user_id, "signed_up" if is_new else "logged_in", "via Google")
    return user_id, token


def request_password_reset(email: str) -> Optional[tuple[str, str]]:
    """Returns (name, raw_token) if `email` belongs to a resettable
    (password-based) account, else None -- callers (main.py's
    /api/auth/forgot-password) must return the exact same generic response
    either way, never branching client-visibly on this, or the endpoint
    becomes an email-enumeration oracle (a classic, well-known auth bug
    class, not a hypothetical one here). A Google-only account (no
    password_hash at all) also returns None -- there's nothing to reset;
    that account's recovery path is signing in with Google again, not
    email. Deletes any previous unused token for this user first, so an
    old email's link can't be replayed after a newer request superseded
    it -- at most one live reset link per user at any time."""
    email = email.strip().lower()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, name, password_hash FROM users WHERE email = %s", (email,)
        ).fetchone()
        if not row or row["password_hash"] is None:
            return None
        token = secrets.token_urlsafe(32)
        token_hash = _hash_reset_token(token)
        expires_at = (datetime.now(timezone.utc) + timedelta(minutes=RESET_TOKEN_TTL_MINUTES)).isoformat()
        conn.execute("DELETE FROM password_reset_tokens WHERE user_id = %s", (row["id"],))
        conn.execute(
            "INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES (%s, %s, %s)",
            (token_hash, row["id"], expires_at),
        )
    return row["name"], token


def reset_password(token: str, new_password: str) -> None:
    """Verifies a reset token (see request_password_reset) and sets a new
    password. Single-use: the token row is deleted the moment it's
    consumed, whether or not anything goes wrong after -- a raised
    AuthError here always means nothing was changed, so there's no
    partial-failure state where the token's gone but the password wasn't
    actually updated (both happen in the same committed transaction)."""
    if len(new_password) < 8:
        raise AuthError("Password must be at least 8 characters.")
    token_hash = _hash_reset_token(token)
    with get_conn() as conn:
        row = conn.execute(
            "SELECT user_id, expires_at FROM password_reset_tokens WHERE token_hash = %s", (token_hash,)
        ).fetchone()
        if not row or datetime.fromisoformat(row["expires_at"]) < datetime.now(timezone.utc):
            raise AuthError("This reset link is invalid or has expired -- please request a new one.")
        salt = secrets.token_bytes(16)
        password_hash = _hash_password(new_password, salt)
        conn.execute(
            "UPDATE users SET password_hash = %s, password_salt = %s WHERE id = %s",
            (password_hash, salt.hex(), row["user_id"]),
        )
        # Every reset link for this user dies with it, and every existing
        # session ends: whoever knew the old password is signed out too.
        conn.execute("DELETE FROM password_reset_tokens WHERE user_id = %s", (row["user_id"],))
        conn.execute("DELETE FROM sessions WHERE user_id = %s", (row["user_id"],))
    _log_activity(row["user_id"], "password_reset", None)


def _create_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    expires_at = (datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS)).isoformat()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO sessions (token, user_id, expires_at) VALUES (%s, %s, %s)",
            (token, user_id, expires_at),
        )
        # Keeps the Privacy Policy's retention limits without a cron job.
        purge_expired_personal_data(conn)
    return token


def log_out(token: str) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM sessions WHERE token = %s", (token,))


_USER_COLUMNS = """u.id, u.email, u.name, u.created_at, u.password_hash, u.handle, u.age_band,
    u.guardian_consent_status, u.school_name, u.terms_accepted_at, u.terms_version"""


def _user_dict(row: dict) -> dict:
    return {
        "id": row["id"],
        "email": row["email"],
        "name": row["name"],
        "created_at": row["created_at"],
        "has_password": row["password_hash"] is not None,
        "handle": row["handle"],
        "age_band": row["age_band"],
        "guardian_consent_status": row["guardian_consent_status"],
        "school_name": row["school_name"],
        "is_admin": row["email"].strip().lower() in get_settings().admin_email_set,
        "terms_accepted_at": row["terms_accepted_at"].isoformat() if row["terms_accepted_at"] else None,
        "needs_terms": row["terms_version"] != TERMS_VERSION,
    }


def get_user_from_token(token: str) -> Optional[dict]:
    """Returns the user dict (see _user_dict) for a valid, unexpired
    session, else None. Never raises -- callers treat auth as
    optional (see main.py's activity logging), so an invalid/expired/missing
    token just means "anonymous", not an error. `has_password` is False for
    a Google-only account (see login_with_google)."""
    if not token:
        return None
    with get_conn() as conn:
        row = conn.execute(
            f"""
            SELECT {_USER_COLUMNS}, s.expires_at
            FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token = %s AND u.deleted_at IS NULL
            """,
            (token,),
        ).fetchone()
    if not row:
        return None
    if datetime.fromisoformat(row["expires_at"]) < datetime.now(timezone.utc):
        return None
    return _user_dict(row)


def get_user_by_id(user_id: int) -> dict:
    """Same shape as get_user_from_token, for a known user id."""
    with get_conn() as conn:
        row = conn.execute(f"SELECT {_USER_COLUMNS} FROM users u WHERE u.id = %s", (user_id,)).fetchone()
    return _user_dict(row)


def accept_terms(user_id: int) -> None:
    """Records agreement to the current TERMS_VERSION (existing accounts are
    asked on their next visit; new ones agree at sign-up)."""
    with get_conn() as conn:
        conn.execute(
            "UPDATE users SET terms_accepted_at = NOW(), terms_version = %s WHERE id = %s",
            (TERMS_VERSION, user_id),
        )


def delete_account(user_id: int) -> None:
    """Deletes a user's personal data, keeping their forecasts anonymised.

    The users row stays as an empty shell (every personal field blanked,
    deleted_at set) because forecasts reference it: scores, crowd medians
    and results stay exactly as they were, but nothing links them to a
    person any more. Free-text forecast notes are cleared (they could name
    someone); the league lock trigger allows that one change after a lock.
    Sessions, activity, reset links, league memberships, practice
    attempts and research workspaces (notes, ticks, worksheet) are deleted
    outright. All in one transaction.

    The audit entry holds only the internal id and a forecast count."""
    with get_conn() as conn:
        kept = conn.execute(
            "SELECT count(*) AS n FROM forecasts WHERE user_id = %s", (user_id,)
        ).fetchone()["n"]
        conn.execute("UPDATE forecasts SET note = NULL WHERE user_id = %s AND note IS NOT NULL", (user_id,))
        for table in (
            "sessions", "activity_log", "password_reset_tokens", "league_members", "practice_attempts",
            "research_workspaces",
        ):
            conn.execute(f"DELETE FROM {table} WHERE user_id = %s", (user_id,))
        conn.execute(
            """
            UPDATE users SET
                email = 'deleted-' || id || '@deleted.invalid', name = '',
                password_hash = NULL, password_salt = NULL, google_id = NULL,
                handle = NULL, school_name = NULL, age_band = NULL,
                guardian_consent_status = NULL, guardian_consent_by = NULL,
                guardian_consent_method = NULL, guardian_consent_date = NULL,
                terms_accepted_at = NULL, terms_version = NULL, deleted_at = NOW()
            WHERE id = %s
            """,
            (user_id,),
        )
        audit.write(conn, None, "delete", "account", user_id, {"forecasts_kept_anonymised": kept})


def _log_activity(user_id: int, action: str, detail: Optional[str]) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO activity_log (user_id, action, detail) VALUES (%s, %s, %s)",
            (user_id, action, detail),
        )


def log_activity(user: Optional[dict], action: str, detail: Optional[str] = None) -> None:
    """No-op if `user` is None -- lets call sites log unconditionally
    (`log_activity(current_user, "searched", ticker)`) without an `if
    current_user:` guard at every call site, since most actions in this app
    are anonymous-by-default and only tracked when someone's signed in."""
    if user is not None:
        _log_activity(user["id"], action, detail)


def get_activity(user_id: int, limit: int = 50) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT action, detail, created_at FROM activity_log WHERE user_id = %s ORDER BY created_at DESC LIMIT %s",
            (user_id, limit),
        ).fetchall()
    return [{"action": r["action"], "detail": r["detail"], "created_at": r["created_at"]} for r in rows]

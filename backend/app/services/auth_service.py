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

(2026-07) **A signed-in user's Tapetide key can now optionally be saved to
their account** (`save_tapetide_key`/`get_tapetide_key`), encrypted at rest
with Fernet (symmetric encryption, keyed by the `ENCRYPTION_KEY` env var --
see config.py) rather than plaintext -- a deliberate reversal of the
original "never persisted server-side" design (see CLAUDE.md's "Bring-your-
own Tapetide key" section for the history), made because logging in from a
new browser/device otherwise means re-entering the key every time. Still
opt-in: `TapetideKeyGate.tsx` always offers "Continue without an account,"
which never touches this at all.
"""
import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings
from app.services.db import get_conn

PBKDF2_ITERATIONS = 200_000
SESSION_TTL_DAYS = 30
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class AuthError(Exception):
    """User-facing auth failure (bad credentials, duplicate email, etc.)."""


def _hash_password(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS).hex()


def _fernet() -> Fernet:
    """Raises RuntimeError if ENCRYPTION_KEY isn't configured -- callers that
    can tolerate the feature simply not working (get_tapetide_key) catch
    this and return None; save_tapetide_key lets it propagate, since saving
    a key with no way to encrypt it would otherwise silently do nothing."""
    key = get_settings().encryption_key
    if not key:
        raise RuntimeError("ENCRYPTION_KEY is not configured -- can't save a Tapetide key to an account.")
    return Fernet(key.encode("utf-8"))


def save_tapetide_key(user_id: int, tapetide_key: str) -> None:
    encrypted = _fernet().encrypt(tapetide_key.encode("utf-8")).decode("utf-8")
    with get_conn() as conn:
        conn.execute("UPDATE users SET tapetide_key_encrypted = %s WHERE id = %s", (encrypted, user_id))


def get_tapetide_key(user_id: int) -> Optional[str]:
    """Best-effort, unlike save_tapetide_key: a missing ENCRYPTION_KEY or an
    undecryptable value (e.g. the key rotated) should just mean "no saved
    key available", not break sign-in for that user."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT tapetide_key_encrypted FROM users WHERE id = %s", (user_id,)
        ).fetchone()
    if not row or not row["tapetide_key_encrypted"]:
        return None
    try:
        return _fernet().decrypt(row["tapetide_key_encrypted"].encode("utf-8")).decode("utf-8")
    except (RuntimeError, InvalidToken):
        return None


def sign_up(email: str, name: str, password: str) -> tuple[int, str]:
    """Creates a user and an initial session. Returns (user_id, session_token)."""
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
        existing = conn.execute("SELECT id FROM users WHERE email = %s", (email,)).fetchone()
        if existing:
            raise AuthError("An account with that email already exists. Try signing in instead.")
        # Postgres has no cursor.lastrowid (that's a sqlite3-ism) -- RETURNING
        # is the standard way to get a just-inserted row's generated id back.
        cursor = conn.execute(
            "INSERT INTO users (email, name, password_hash, password_salt) VALUES (%s, %s, %s, %s) RETURNING id",
            (email, name, password_hash, salt.hex()),
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
    # Same error for "no such user" and "wrong password" -- don't reveal
    # which one it was, standard practice to avoid leaking valid emails.
    if not row:
        raise AuthError("Incorrect email or password.")
    salt = bytes.fromhex(row["password_salt"])
    if _hash_password(password, salt) != row["password_hash"]:
        raise AuthError("Incorrect email or password.")

    token = _create_session(row["id"])
    _log_activity(row["id"], "logged_in", None)
    return row["id"], token


def _create_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    expires_at = (datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS)).isoformat()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO sessions (token, user_id, expires_at) VALUES (%s, %s, %s)",
            (token, user_id, expires_at),
        )
    return token


def log_out(token: str) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM sessions WHERE token = %s", (token,))


def get_user_from_token(token: str) -> Optional[dict]:
    """Returns {id, email, name, created_at, tapetide_key} for a valid,
    unexpired session, else None. Never raises -- callers treat auth as
    optional (see main.py's activity logging), so an invalid/expired/
    missing token just means "anonymous", not an error. `tapetide_key` is
    the decrypted, ready-to-use key (or None if this account never saved
    one) -- see save_tapetide_key/get_tapetide_key above; this is what lets
    TapetideKeyGate.tsx skip key entry entirely for a returning signed-in
    user."""
    if not token:
        return None
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT u.id, u.email, u.name, u.created_at, s.expires_at
            FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token = %s
            """,
            (token,),
        ).fetchone()
    if not row:
        return None
    if datetime.fromisoformat(row["expires_at"]) < datetime.now(timezone.utc):
        return None
    return {
        "id": row["id"],
        "email": row["email"],
        "name": row["name"],
        "created_at": row["created_at"],
        "tapetide_key": get_tapetide_key(row["id"]),
    }


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

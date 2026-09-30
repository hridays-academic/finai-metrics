"""Shared FastAPI dependencies for auth, used by main.py and every route
module (kept here so route modules never import main.py)."""
from typing import Optional

from fastapi import Depends, Header, HTTPException

from app.config import get_settings
from app.services import auth_service


def optional_user(authorization: Optional[str] = Header(None)) -> Optional[dict]:
    """Optional auth -- returns the signed-in user dict (see
    auth_service.get_user_from_token) if `Authorization: Bearer <token>` is
    present and valid, else None. Never raises 401: most endpoints work fully
    signed-out (see CLAUDE.md's "Accounts & activity tracking")."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    return auth_service.get_user_from_token(authorization.removeprefix("Bearer ").strip())


def require_user(user: Optional[dict] = Depends(optional_user)) -> dict:
    if user is None:
        raise HTTPException(status_code=401, detail="Please sign in to continue.")
    return user


def require_admin(user: dict = Depends(require_user)) -> dict:
    """Admins are the emails listed in the ADMIN_EMAILS env var (set in
    Vercel, never in code), so nobody can grant themselves the role."""
    if user["email"].strip().lower() not in get_settings().admin_email_set:
        raise HTTPException(status_code=403, detail="This page is for administrators only.")
    return user

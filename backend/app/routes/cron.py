"""Scheduled jobs, called by Vercel Cron (vercel.json "crons") with
"Authorization: Bearer <CRON_SECRET>". Every request is refused when
CRON_SECRET isn't set, so these can never be triggered by the public.
The GDELT job lives in app/gdelt_app.py (a separate function in Singapore)."""
import hmac
import os
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException

from app.config import get_settings
from app.services import news
from app.services.db import get_conn

router = APIRouter(prefix="/api/cron")


def require_cron(authorization: Optional[str] = Header(None)) -> None:
    secret = get_settings().cron_secret
    if not secret:
        raise HTTPException(status_code=503, detail="Scheduled jobs aren't configured.")
    if not authorization or not hmac.compare_digest(authorization, f"Bearer {secret}"):
        raise HTTPException(status_code=401, detail="Not allowed.")


def show_demo() -> bool:
    return not os.environ.get("VERCEL")


@router.get("/nse", dependencies=[Depends(require_cron)])
def cron_nse() -> dict:
    return news.run_nse(get_conn, show_demo=show_demo())


@router.get("/rbi", dependencies=[Depends(require_cron)])
def cron_rbi() -> dict:
    return news.run_rbi(get_conn)


@router.get("/macro", dependencies=[Depends(require_cron)])
def cron_macro() -> dict:
    return news.run_macro(get_conn)

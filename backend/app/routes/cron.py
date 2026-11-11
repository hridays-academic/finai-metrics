"""Scheduled jobs, called by Vercel Cron (vercel.json "crons") with
"Authorization: Bearer <CRON_SECRET>". Every request is refused when
CRON_SECRET isn't set, so these can never be triggered by the public.

Served by their own small function (app/cron_app.py, api/cron.py) so a cron
call never pays for the main app's start-up (every route and the schema
check): on 2026-11-10 an NSE run was killed while the main app started.
A failed job answers 502 and logs an error, so Vercel's logs show it."""
import hmac
import logging
import os
from typing import Callable, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.services import news, videos
from app.services.db import get_conn

logger = logging.getLogger("finai")
router = APIRouter(prefix="/api/cron")


def require_cron(authorization: Optional[str] = Header(None)) -> None:
    secret = get_settings().cron_secret
    if not secret:
        raise HTTPException(status_code=503, detail="Scheduled jobs aren't configured.")
    if not authorization or not hmac.compare_digest(authorization, f"Bearer {secret}"):
        raise HTTPException(status_code=401, detail="Not allowed.")


def show_demo() -> bool:
    return not os.environ.get("VERCEL")


def _run(job: str, fn: Callable[[], dict]) -> JSONResponse:
    try:
        result = fn()
    except Exception as exc:  # noqa: BLE001 -- report it as a failed run, not a crash
        logger.exception("Job %s crashed", job)
        return JSONResponse({"job": job, "error": str(exc)[:300]}, status_code=502)
    if result.get("error"):
        logger.error("Job %s failed: %s", job, result["error"])
        return JSONResponse({"job": job, **result}, status_code=502)
    logger.info("Job %s ok: %s", job, result)
    return JSONResponse({"job": job, **result})


@router.get("/gdelt", dependencies=[Depends(require_cron)])
def cron_gdelt() -> JSONResponse:
    return _run("gdelt", lambda: news.run_gdelt_files(get_conn, show_demo=show_demo()))


@router.get("/videos", dependencies=[Depends(require_cron)])
def cron_videos() -> JSONResponse:
    return _run("videos", lambda: videos.run_videos(get_conn, show_demo=show_demo()))


@router.get("/nse", dependencies=[Depends(require_cron)])
def cron_nse() -> JSONResponse:
    return _run("nse", lambda: news.run_nse(get_conn, show_demo=show_demo()))


@router.get("/rbi", dependencies=[Depends(require_cron)])
def cron_rbi() -> JSONResponse:
    return _run("rbi", lambda: news.run_rbi(get_conn))


@router.get("/macro", dependencies=[Depends(require_cron)])
def cron_macro() -> JSONResponse:
    return _run("macro", lambda: news.run_macro(get_conn))

"""
Vercel Python entrypoint. Vercel's Python builder looks for an ASGI/WSGI
callable named `app` in this file -- FastAPI's `app` object (defined in
backend/app/main.py, run locally via `uvicorn app.main:app`) qualifies
directly, no adapter needed. This file only exists to make that import path
reachable from Vercel's filesystem-routing convention (functions live under
api/); vercel.json's rewrite sends every /api/* request here while leaving
the original path intact, which FastAPI's own routes (already written as
e.g. "/api/company/{query}") expect.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.main import app  # noqa: E402

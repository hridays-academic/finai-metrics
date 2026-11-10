"""The scheduled jobs as their own small app (api/cron.py): it imports only
what the jobs need and never runs the schema check, so a cron call starts in
well under a second. The tables already exist: the main app creates them."""
import logging

from fastapi import FastAPI

from app.routes import cron

logging.basicConfig(level=logging.INFO)
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(cron.router)

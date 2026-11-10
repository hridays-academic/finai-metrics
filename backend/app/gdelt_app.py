"""The GDELT job as its own small app, deployed as a separate Vercel
function pinned to Singapore (api/gdelt.py, vercel.json). GDELT rate-limits
Vercel's default US addresses: tested 2026-11-08, iad1 got 429 on 4 of 4
requests while sin1 and fra1 got 200 on 2 of 2. Kept apart from main.py so
the rest of the API stays next to the database in the US."""
from fastapi import Depends, FastAPI

from app.routes.cron import require_cron, show_demo
from app.services import news
from app.services.db import get_conn

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/api/cron/gdelt", dependencies=[Depends(require_cron)])
def cron_gdelt() -> dict:
    return news.run_gdelt_sweep(get_conn, show_demo=show_demo())

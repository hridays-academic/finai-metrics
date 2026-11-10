from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.news_models import NEWS_VIEWS, CompanyNews, MacroSeriesOut, NewsList, WorldEvent, WorldEventIn
from app.routes.deps import require_admin
from app.services import audit, news, price_lag
from app.services.db import get_conn

router = APIRouter()


@router.get("/api/news", response_model=NewsList)
def list_news(
    view: str = Query("all"), limit: int = Query(20, ge=1, le=50), offset: int = Query(0, ge=0, le=500)
) -> NewsList:
    if view not in NEWS_VIEWS:
        raise HTTPException(status_code=404, detail="No such news view.")
    with get_conn() as conn:
        return NewsList(**news.news_list(conn, view, limit, offset))


@router.get("/api/world-events", response_model=list[WorldEvent])
def list_world_events(sector: Optional[str] = Query(None)) -> list[WorldEvent]:
    with get_conn() as conn:
        return [WorldEvent(**e) for e in news.world_events(conn, sector, price_lag.today_in_india())]


@router.get("/api/macro", response_model=list[MacroSeriesOut])
def list_macro() -> list[MacroSeriesOut]:
    with get_conn() as conn:
        return [MacroSeriesOut(**s) for s in news.macro(conn, price_lag.today_in_india())]


@router.get("/api/news/company/{symbol}", response_model=CompanyNews)
def company_news(symbol: str) -> CompanyNews:
    with get_conn() as conn:
        return CompanyNews(**news.company_news(conn, symbol.strip().upper(), price_lag.today_in_india()))


# ---------- Admin: world event cards ----------

@router.get("/api/admin/world-events", response_model=list[WorldEvent])
def admin_world_events(_admin: dict = Depends(require_admin)) -> list[WorldEvent]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM world_events ORDER BY pinned DESC, event_date DESC, id DESC").fetchall()
        return [WorldEvent(**news._event_out(dict(r))) for r in rows]


def _check_dates(body: WorldEventIn) -> None:
    if body.show_until and body.show_until < body.event_date:
        raise HTTPException(status_code=422, detail="'Show until' can't be before the event date.")


@router.post("/api/admin/world-events", response_model=WorldEvent)
def create_world_event(body: WorldEventIn, admin: dict = Depends(require_admin)) -> WorldEvent:
    _check_dates(body)
    with get_conn() as conn:
        row = conn.execute(
            """
            INSERT INTO world_events (title, event_date, sectors, why, source_url, pinned, show_until, created_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *
            """,
            (body.title.strip(), body.event_date, list(body.sectors), body.why.strip(), body.source_url,
             body.pinned, body.show_until, admin["id"]),
        ).fetchone()
        audit.write(conn, admin["id"], "create", "world_event", row["id"], {"title": row["title"]})
        return WorldEvent(**news._event_out(dict(row)))


@router.put("/api/admin/world-events/{event_id}", response_model=WorldEvent)
def update_world_event(event_id: int, body: WorldEventIn, admin: dict = Depends(require_admin)) -> WorldEvent:
    _check_dates(body)
    with get_conn() as conn:
        row = conn.execute(
            """
            UPDATE world_events SET title = %s, event_date = %s, sectors = %s, why = %s, source_url = %s,
                pinned = %s, show_until = %s, updated_at = now()
            WHERE id = %s RETURNING *
            """,
            (body.title.strip(), body.event_date, list(body.sectors), body.why.strip(), body.source_url,
             body.pinned, body.show_until, event_id),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="No such world event.")
        audit.write(conn, admin["id"], "update", "world_event", event_id, {"title": row["title"]})
        return WorldEvent(**news._event_out(dict(row)))


@router.delete("/api/admin/world-events/{event_id}", status_code=204)
def delete_world_event(event_id: int, admin: dict = Depends(require_admin)) -> None:
    with get_conn() as conn:
        row = conn.execute("DELETE FROM world_events WHERE id = %s RETURNING title", (event_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="No such world event.")
        audit.write(conn, admin["id"], "delete", "world_event", event_id, {"title": row["title"]})


@router.get("/api/admin/jobs")
def admin_jobs(_admin: dict = Depends(require_admin)) -> list[dict]:
    """Each scheduled job's last run, last success, last error, items stored
    on its last run and items held now, including jobs that never ran."""
    totals_sql = {
        "gdelt": "SELECT count(*) AS n FROM news_items WHERE source = 'gdelt'",
        "nse": "SELECT count(*) AS n FROM exchange_filings",
        "rbi": "SELECT count(*) AS n FROM news_items WHERE source = 'rbi'",
        "macro": "SELECT count(*) AS n FROM macro_series_cache",
    }
    with get_conn() as conn:
        runs = {r["job"]: dict(r) for r in conn.execute("SELECT * FROM job_runs").fetchall()}
        out = []
        for job, sql in totals_sql.items():
            r = runs.get(job, {})
            out.append({
                "job": job, "last_run_at": r.get("last_run_at"), "last_ok_at": r.get("last_ok_at"),
                "last_error": r.get("last_error"), "last_items": r.get("last_items"),
                "stored": conn.execute(sql).fetchone()["n"],
            })
    return out

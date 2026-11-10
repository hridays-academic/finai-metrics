"""News, exchange filings, world events and macro series.

Everything here is fetched by scheduled jobs (routes/cron.py, plus the GDELT
job in app/gdelt_app.py, which runs as its own Vercel function in Singapore
because GDELT rate-limits Vercel's default US addresses) and stored in
Postgres. Pages only ever read the stored rows.

We keep headline, source, date and link only: never article text or images.
A headline matching no theme is not stored (hidden), and advice-style
headlines are dropped. Classification is keyword rules (news_config.py).
"""
import io
import json
import logging
import re
import time
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Optional
from urllib.parse import quote

import psycopg
import requests

from app import news_config as nc
from app.config import get_settings
from app.services import price_lag
from app.services.metrics import sector_group

logger = logging.getLogger("finai")

IST = timezone(timedelta(hours=5, minutes=30))
UA = {"User-Agent": "Mozilla/5.0 (compatible; StacklyNews/1.0; +https://stackslymetrics.com)"}
GDELT_API = "https://api.gdeltproject.org/api/v2/doc/doc"
GDELT_SPACING_SECONDS = 6  # GDELT asks for at most one request every 5 seconds
GDELT_QUERIES_PER_RUN = 7  # 7 x 6s fits the 60s function limit with room to spare
NEWS_RETENTION = timedelta(days=90)
FILINGS_RETENTION = timedelta(days=400)
WORLD_BANK_FALLBACK_XLSX = (
    "https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/"
    "CMO-Historical-Data-Monthly.xlsx"
)


# ---------- Job bookkeeping ----------

def _job_cursor(conn: psycopg.Connection, job: str) -> int:
    row = conn.execute("SELECT cursor FROM job_runs WHERE job = %s", (job,)).fetchone()
    return row["cursor"] if row else 0


def _job_done(conn: psycopg.Connection, job: str, *, ok: bool, cursor: Optional[int] = None,
              error: Optional[str] = None) -> None:
    conn.execute(
        """
        INSERT INTO job_runs (job, first_ok_at, last_run_at, last_ok_at, cursor, last_error)
        VALUES (%(job)s, CASE WHEN %(ok)s THEN now() END, now(), CASE WHEN %(ok)s THEN now() END,
                COALESCE(%(cursor)s, 0), %(error)s)
        ON CONFLICT (job) DO UPDATE SET
            first_ok_at = COALESCE(job_runs.first_ok_at, CASE WHEN %(ok)s THEN now() END),
            last_run_at = now(),
            last_ok_at = CASE WHEN %(ok)s THEN now() ELSE job_runs.last_ok_at END,
            cursor = COALESCE(%(cursor)s, job_runs.cursor),
            last_error = %(error)s
        """,
        {"job": job, "ok": ok, "cursor": cursor, "error": (error or "")[:500] or None},
    )


def _tracked_companies(conn: psycopg.Connection, show_demo: bool) -> list[dict]:
    return [dict(r) for r in conn.execute(
        "SELECT id, ticker, name, sector, provider_symbol FROM companies WHERE (NOT is_demo OR %s) ORDER BY id",
        (show_demo,),
    ).fetchall()]


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", s.lower().replace("&", "and")).strip()


# ---------- GDELT (company, sector and theme headlines) ----------

def gdelt_queries(companies: list[dict]) -> list[dict]:
    """The sweep's rotation: themes, sectors, then each tracked company."""
    qs = [{"kind": "theme", "key": k, "q": q} for k, q in nc.THEME_QUERIES.items()]
    qs += [{"kind": "sector", "key": k, "q": q} for k, q in nc.SECTOR_QUERIES.items()]
    qs += [{"kind": "company", "key": str(c["id"]), "q": f'"{c["name"]}"'} for c in companies]
    return qs


def _gdelt_url(q: str) -> str:
    # Publishers are filtered after the fetch (parse_gdelt), not in the query:
    # one OR group per query is the form GDELT reliably accepts.
    query = f"{q} sourcecountry:IN sourcelang:english"
    return f"{GDELT_API}?query={quote(query)}&mode=artlist&maxrecords=250&format=json&timespan=3d&sort=datedesc"


def parse_gdelt(payload: dict, *, company: bool) -> list[dict]:
    """Articles -> stored rows, keeping only allowlisted publishers, dropping
    advice and anything that matches no theme/event type."""
    out = []
    for a in payload.get("articles", []):
        publisher = nc.publisher_for(a.get("domain", ""))
        title = nc.clean_title(a.get("title") or "")
        if not publisher or not title or nc.is_advice(title):
            continue
        key = nc.classify(title, company=company)
        if key is None:
            continue
        try:
            seen = datetime.strptime(a["seendate"], "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
        except (KeyError, ValueError):
            continue
        out.append({"url": a["url"], "title": title, "publisher": publisher, "published_at": seen, "theme": key})
    return out


def _store_news(conn: psycopg.Connection, rows: list[dict], *, source: str, company_id: Optional[int]) -> int:
    n = 0
    for r in rows:
        cur = conn.execute(
            """
            INSERT INTO news_items (url, title, publisher, published_at, source, theme, company_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (url) DO NOTHING
            """,
            (r["url"], r["title"], r["publisher"], r["published_at"], source, r["theme"], company_id),
        )
        n += cur.rowcount
    return n


def run_gdelt_sweep(conn_factory, *, show_demo: bool, budget_seconds: float = 50.0) -> dict:
    """One scheduled run: the next few queries in the rotation, 6s apart.
    Stops early on a 429 (the cursor stays, so the next run retries)."""
    started = time.monotonic()
    with conn_factory() as conn:
        companies = _tracked_companies(conn, show_demo)
        cursor = _job_cursor(conn, "gdelt")
    queries = gdelt_queries(companies)
    done, added, error = 0, 0, None
    for i in range(min(GDELT_QUERIES_PER_RUN, len(queries))):
        if time.monotonic() - started > budget_seconds - GDELT_SPACING_SECONDS:
            break
        if i:
            time.sleep(GDELT_SPACING_SECONDS)
        item = queries[(cursor + i) % len(queries)]
        try:
            r = requests.get(_gdelt_url(item["q"]), headers=UA, timeout=20)
            if r.status_code == 429:
                error = "GDELT rate limit (429)"
                break
            r.raise_for_status()
            try:
                payload = r.json()
            except ValueError:
                # GDELT answers a query it can't run with plain text.
                raise ValueError(f"not JSON: {r.text[:200]!r}") from None
            rows = parse_gdelt(payload, company=item["kind"] == "company")
        except (requests.RequestException, ValueError) as exc:
            error = f"{item['kind']} {item['key']}: {exc}"
            logger.warning("GDELT query failed: %s", error)
            done += 1
            continue
        with conn_factory() as conn:
            added += _store_news(conn, rows, source="gdelt",
                                 company_id=int(item["key"]) if item["kind"] == "company" else None)
        done += 1
    with conn_factory() as conn:
        conn.execute("DELETE FROM news_items WHERE published_at < now() - %s::interval", (NEWS_RETENTION,))
        _job_done(conn, "gdelt", ok=error is None, cursor=(cursor + done) % max(1, len(queries)), error=error)
    return {"queries": done, "added": added, "error": error}


# ---------- RBI press releases ----------

def parse_rss(xml_text: str) -> list[dict]:
    root = ET.fromstring(xml_text.lstrip("﻿").encode("utf-8"))
    items = []
    for it in root.iter("item"):
        items.append({
            "title": (it.findtext("title") or "").strip(),
            "link": (it.findtext("link") or "").strip(),
            "description": (it.findtext("description") or "").strip(),
            "pubDate": (it.findtext("pubDate") or "").strip(),
        })
    return items


def _rss_date(text: str) -> Optional[datetime]:
    for parse in (
        lambda s: parsedate_to_datetime(s),
        lambda s: datetime.strptime(s, "%d-%b-%Y %H:%M:%S"),
    ):
        try:
            d = parse(text)
            # Indian feeds (RBI, NSE) give local times without a zone.
            return d if d.tzinfo else d.replace(tzinfo=IST)
        except (TypeError, ValueError, IndexError):
            continue
    return None


def parse_rbi(xml_text: str) -> list[dict]:
    out = []
    for it in parse_rss(xml_text):
        title = nc.clean_title(it["title"])
        key = nc.classify(title, company=False)
        when = _rss_date(it["pubDate"])
        if key is None or nc.RBI_ROUTINE.search(title) or not it["link"] or when is None:
            continue
        out.append({"url": it["link"], "title": title, "publisher": "RBI", "published_at": when, "theme": key})
    return out


def run_rbi(conn_factory) -> dict:
    try:
        r = requests.get(nc.RBI_PRESS_RSS, headers=UA, timeout=25)
        r.raise_for_status()
        rows = parse_rbi(r.content.decode("utf-8-sig", "ignore"))
    except (requests.RequestException, ET.ParseError) as exc:
        with conn_factory() as conn:
            _job_done(conn, "rbi", ok=False, error=str(exc))
        return {"added": 0, "error": str(exc)}
    with conn_factory() as conn:
        added = _store_news(conn, rows, source="rbi", company_id=None)
        _job_done(conn, "rbi", ok=True)
    return {"added": added}


# ---------- NSE announcements ----------

_SUBJECT = re.compile(r"SUBJECT:\s*(.+)$", re.I)


def parse_nse(xml_text: str, companies: list[dict]) -> list[dict]:
    """Filings by tracked companies only. Matched on the company's name at
    the start of the item title, or the ticker at the start of the PDF name."""
    out = []
    for it in parse_rss(xml_text):
        title, link = it["title"], it["link"]
        prefix = link.rsplit("/", 1)[-1].split("_", 1)[0].upper()
        company = next(
            (c for c in companies
             if _norm(title).startswith(_norm(c["name"])) or (prefix and prefix == c["ticker"].upper())),
            None,
        )
        when = _rss_date(it["pubDate"])
        if company is None or not link or when is None:
            continue
        m = _SUBJECT.search(it["description"])
        subject = (m.group(1) if m else it["description"]).strip()
        out.append({
            "url": link, "company_id": company["id"], "subject": subject[:200], "filed_at": when,
            "event_type": next((e.key for e in nc.EVENT_TYPES if e.pattern.search(subject)), None),
        })
    return out


def run_nse(conn_factory, *, show_demo: bool) -> dict:
    with conn_factory() as conn:
        companies = _tracked_companies(conn, show_demo)
    try:
        r = requests.get(nc.NSE_ANNOUNCEMENTS_RSS, headers=UA, timeout=20)
        r.raise_for_status()
        rows = parse_nse(r.content.decode("utf-8", "ignore"), companies)
    except (requests.RequestException, ET.ParseError) as exc:
        with conn_factory() as conn:
            _job_done(conn, "nse", ok=False, error=str(exc))
        return {"added": 0, "error": str(exc)}
    with conn_factory() as conn:
        added = 0
        for f in rows:
            cur = conn.execute(
                """
                INSERT INTO exchange_filings (url, company_id, subject, event_type, filed_at)
                VALUES (%s, %s, %s, %s, %s) ON CONFLICT (url) DO NOTHING
                """,
                (f["url"], f["company_id"], f["subject"], f["event_type"], f["filed_at"]),
            )
            added += cur.rowcount
        conn.execute("DELETE FROM exchange_filings WHERE filed_at < now() - %s::interval", (FILINGS_RETENTION,))
        _job_done(conn, "nse", ok=True)
    return {"added": added}


# ---------- Macro series ----------

def _month_end(d: date) -> date:
    nxt = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
    return nxt - timedelta(days=1)


def lag_points(points: list[dict], frequency: str, today: date) -> list[dict]:
    """The 30-day rule (price_lag.py) for macro series: a daily value shows
    once its date is 30 days past; a monthly average once the month's last
    day is."""
    cut = price_lag.cutoff(today)
    out = []
    for p in points:
        d = date.fromisoformat(p["date"])
        if (_month_end(d) if frequency == "monthly" else d) <= cut:
            out.append(p)
    return out


def parse_world_bank(xlsx_bytes: bytes, since_year: int) -> dict[str, list[dict]]:
    from openpyxl import load_workbook  # only the macro job needs it

    wb = load_workbook(io.BytesIO(xlsx_bytes), read_only=True, data_only=True)
    ws = wb["Monthly Prices"]
    rows = ws.iter_rows(values_only=True)
    header = None
    for row in rows:
        if row and any(isinstance(c, str) and c.strip() == "Crude oil, Brent" for c in row):
            header = [c.strip() if isinstance(c, str) else c for c in row]
            break
    if header is None:
        raise ValueError("World Bank file: header row not found")
    cols = {key: header.index(name) for key, name in nc.WORLD_BANK_COLUMNS.items() if name in header}
    series: dict[str, list[dict]] = {k: [] for k in cols}
    for row in rows:
        label = row[0] if row else None
        m = re.fullmatch(r"(\d{4})M(\d{2})", str(label or ""))
        if not m or int(m.group(1)) < since_year:
            continue
        day = date(int(m.group(1)), int(m.group(2)), 1).isoformat()
        for key, i in cols.items():
            v = row[i]
            if isinstance(v, (int, float)):
                series[key].append({"date": day, "value": float(v)})
    return series


def _world_bank_xlsx_url() -> str:
    try:
        page = requests.get(nc.WORLD_BANK_URL, headers=UA, timeout=20).text
        m = re.search(r'https://thedocs\.worldbank\.org[^"]*CMO-Historical-Data-Monthly\.xlsx', page)
        if m:
            return m.group(0)
    except requests.RequestException:
        pass
    return WORLD_BANK_FALLBACK_XLSX


def _store_series(conn: psycopg.Connection, key: str, points: list[dict], source: str) -> None:
    conn.execute(
        """
        INSERT INTO macro_series_cache (series_key, points_json, source, fetched_at) VALUES (%s, %s, %s, now())
        ON CONFLICT (series_key) DO UPDATE SET points_json = EXCLUDED.points_json, source = EXCLUDED.source,
            fetched_at = now()
        """,
        (key, json.dumps(points), source),
    )


def run_macro(conn_factory, today: Optional[date] = None) -> dict:
    today = today or price_lag.today_in_india()
    result: dict = {}
    try:
        r = requests.get(_world_bank_xlsx_url(), headers=UA, timeout=40)
        r.raise_for_status()
        series = parse_world_bank(r.content, since_year=today.year - 5)
        with conn_factory() as conn:
            for key, points in series.items():
                if points:
                    _store_series(conn, key, points, "worldbank")
        result["worldbank"] = {k: len(v) for k, v in series.items()}
    except Exception as exc:  # noqa: BLE001 -- one source failing mustn't stop the other
        logger.warning("World Bank macro fetch failed", exc_info=True)
        result["worldbank_error"] = str(exc)[:200]

    key = get_settings().fred_api_key
    if key:
        try:
            r = requests.get(
                "https://api.stlouisfed.org/fred/series/observations",
                params={"series_id": "DEXINUS", "api_key": key, "file_type": "json",
                        "observation_start": date(today.year - 5, 1, 1).isoformat()},
                headers=UA, timeout=30,
            )
            r.raise_for_status()
            points = [{"date": o["date"], "value": float(o["value"])}
                      for o in r.json().get("observations", []) if o.get("value") not in (None, ".", "")]
            with conn_factory() as conn:
                _store_series(conn, "usd_inr", points, "fred")
            result["fred"] = len(points)
        except Exception as exc:  # noqa: BLE001
            logger.warning("FRED macro fetch failed", exc_info=True)
            result["fred_error"] = str(exc)[:200]
    with conn_factory() as conn:
        _job_done(conn, "macro", ok=not any(k.endswith("_error") for k in result), error=json.dumps(result)[:500])
    return result


# ---------- Reads for the pages ----------

def _item_out(row: dict, view: str) -> Optional[dict]:
    why = nc.sentence_for(row["theme"], view)
    if why is None:
        return None
    return {
        "title": row["title"], "url": row["url"], "publisher": row["publisher"],
        "published_at": row["published_at"].isoformat(), "theme": row["theme"],
        "theme_label": nc.label_for(row["theme"]), "why": why,
    }


def news_list(conn: psycopg.Connection, view: str, limit: int, offset: int) -> dict:
    """General (company_id IS NULL) headlines for a view: "all", "economy"
    or a sector key. In "all", each row uses its economy line when it has
    one, else its first sector line."""
    themes = [t.key for t in nc.THEMES if view == "all" or view in t.sentences]
    rows = conn.execute(
        """
        SELECT title, url, publisher, published_at, theme FROM news_items
        WHERE company_id IS NULL AND theme = ANY(%s)
        ORDER BY published_at DESC LIMIT %s OFFSET %s
        """,
        (themes, limit + 1, offset),
    ).fetchall()
    items = []
    for r in rows[:limit]:
        v = view
        if view == "all":
            sentences = nc.THEMES_BY_KEY[r["theme"]].sentences
            v = "economy" if "economy" in sentences else next(iter(sentences))
        out = _item_out(dict(r), v)
        if out:
            if view == "all" and v != "economy":
                out["sector_label"] = nc.SECTOR_LABELS[v]
            items.append(out)
    return {"items": items, "has_more": len(rows) > limit, "updated_at": _updated(conn, ("gdelt", "rbi"))}


def _updated(conn: psycopg.Connection, jobs: tuple[str, ...]) -> Optional[str]:
    row = conn.execute("SELECT max(last_ok_at) AS t FROM job_runs WHERE job = ANY(%s)", (list(jobs),)).fetchone()
    return row["t"].isoformat() if row and row["t"] else None


def world_events(conn: psycopg.Connection, sector: Optional[str], today: date) -> list[dict]:
    rows = conn.execute(
        """
        SELECT id, title, event_date, sectors, why, source_url, pinned, show_until FROM world_events
        WHERE (show_until IS NULL OR show_until >= %s)
          AND (%s::text IS NULL OR %s = ANY(sectors) OR 'economy' = ANY(sectors))
        ORDER BY pinned DESC, event_date DESC LIMIT 12
        """,
        (today, sector, sector),
    ).fetchall()
    return [_event_out(dict(r)) for r in rows]


def _event_out(r: dict) -> dict:
    return {
        "id": r["id"], "title": r["title"], "event_date": r["event_date"].isoformat(), "sectors": list(r["sectors"]),
        "sector_labels": [nc.SECTOR_LABELS.get(s, s) for s in r["sectors"]], "why": r["why"],
        "source_url": r["source_url"], "pinned": r["pinned"],
        "show_until": r["show_until"].isoformat() if r["show_until"] else None,
    }


def macro(conn: psycopg.Connection, today: date, sector: Optional[str] = None) -> list[dict]:
    rows = {r["series_key"]: dict(r) for r in conn.execute(
        "SELECT series_key, points_json, fetched_at FROM macro_series_cache").fetchall()}
    fred_ready = bool(get_settings().fred_api_key)
    out = []
    for s in nc.MACRO_SERIES:
        if sector and sector not in s.sectors:
            continue
        row = rows.get(s.key)
        points = lag_points(json.loads(row["points_json"]), s.frequency, today) if row else []
        if s.key == "usd_inr" and not fred_ready:
            status = "coming_soon"
        else:
            status = "ok" if points else "unavailable"
        out.append({
            "key": s.key, "label": s.label, "unit": s.unit, "source": s.source, "source_url": s.source_url,
            "frequency": s.frequency, "sectors": [nc.SECTOR_LABELS[x] for x in s.sectors], "status": status,
            "points": points if status == "ok" else [],
            "data_to": points[-1]["date"] if points and status == "ok" else None,
            "fetched_at": row["fetched_at"].isoformat() if row else None,
        })
    return out


def news_sector_for(conn: psycopg.Connection, symbol: str) -> tuple[Optional[dict], Optional[str]]:
    """The tracked company for a Yahoo symbol (if any) and its news sector
    key (cement/autos/fmcg/it), else None for the general list only."""
    company = conn.execute(
        "SELECT id, ticker, name, sector FROM companies WHERE provider_symbol = %s ORDER BY is_demo LIMIT 1",
        (symbol,),
    ).fetchone()
    if company and company["sector"] in nc.NEWS_SECTORS:
        return dict(company), company["sector"]
    row = conn.execute("SELECT info_json FROM company_fundamentals_cache WHERE symbol = %s", (symbol,)).fetchone()
    sector = None
    if row:
        info = json.loads(row["info_json"])
        sg = sector_group(info.get("sector"), info.get("industry"))
        sector = sg if sg in nc.NEWS_SECTORS else None
    return (dict(company) if company else None), sector


def company_news(conn: psycopg.Connection, symbol: str, today: date) -> dict:
    company, sector = news_sector_for(conn, symbol)
    view = sector or "economy"
    filings, headlines, since = [], [], None
    if company:
        for r in conn.execute(
            "SELECT url, subject, event_type, filed_at FROM exchange_filings WHERE company_id = %s "
            "ORDER BY filed_at DESC LIMIT 15", (company["id"],),
        ).fetchall():
            e = nc.EVENT_TYPES_BY_KEY.get(r["event_type"]) if r["event_type"] else None
            filings.append({"url": r["url"], "subject": r["subject"], "filed_at": r["filed_at"].isoformat(),
                            "type_label": e.label if e else None, "why": e.sentence if e else None})
        for r in conn.execute(
            "SELECT title, url, publisher, published_at, theme FROM news_items WHERE company_id = %s "
            "ORDER BY published_at DESC LIMIT 10", (company["id"],),
        ).fetchall():
            out = _item_out(dict(r), view)
            if out:
                headlines.append(out)
        row = conn.execute("SELECT first_ok_at FROM job_runs WHERE job = 'nse'").fetchone()
        since = row["first_ok_at"] if row else None
    sector_items = news_list(conn, view, 8, 0)["items"]
    ticker = company["ticker"] if company else symbol.split(".")[0]
    return {
        "tracked": company is not None,
        "company_name": company["name"] if company else None,
        "sector": sector, "sector_label": nc.SECTOR_LABELS[view],
        "filings": filings, "filings_since": since.isoformat() if since else None,
        "nse_url": f"https://www.nseindia.com/get-quotes/equity?symbol={quote(ticker)}",
        "company_news": headlines, "sector_news": sector_items,
        "world_events": world_events(conn, sector or "economy", today),
        "macro": macro(conn, today, sector) if sector else [],
        "updated_at": _updated(conn, ("gdelt", "rbi", "nse")),
    }

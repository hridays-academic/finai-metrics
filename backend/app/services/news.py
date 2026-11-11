"""News, exchange filings, world events and macro series.

Everything here is fetched by scheduled jobs (routes/cron.py, plus the GDELT
job in app/gdelt_app.py, which runs as its own Vercel function in Singapore
because GDELT rate-limits Vercel's default US addresses) and stored in
Postgres. Pages only ever read the stored rows.

We keep headline, source, date and link only: never article text or images.
A headline matching no theme is not stored (hidden), and advice-style
headlines are dropped. Classification is keyword rules (news_config.py).
"""
import html
import io
import json
import logging
import re
import xml.etree.ElementTree as ET
import zipfile
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Optional
from urllib.parse import quote, urlparse

import psycopg
import requests

from app import news_config as nc
from app.config import get_settings
from app.services import price_lag
from app.services.metrics import sector_group

logger = logging.getLogger("finai")

IST = timezone(timedelta(hours=5, minutes=30))
UA = {"User-Agent": "Mozilla/5.0 (compatible; StacklyNews/1.0; +https://stackslymetrics.com)"}
NEWS_RETENTION = timedelta(days=90)
FILINGS_RETENTION = timedelta(days=400)
WORLD_BANK_FALLBACK_XLSX = (
    "https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/"
    "CMO-Historical-Data-Monthly.xlsx"
)


# ---------- Job bookkeeping ----------

def _job_done(conn: psycopg.Connection, job: str, *, ok: bool, state: Optional[str] = None,
              error: Optional[str] = None, items: Optional[int] = None) -> None:
    """Records a run. last_error keeps the most recent failure (cleared by
    a later success) so the admin panel shows what went wrong."""
    conn.execute(
        """
        INSERT INTO job_runs (job, first_ok_at, last_run_at, last_ok_at, state, last_error, last_items)
        VALUES (%(job)s, CASE WHEN %(ok)s THEN now() END, now(), CASE WHEN %(ok)s THEN now() END,
                %(state)s, %(error)s, %(items)s)
        ON CONFLICT (job) DO UPDATE SET
            first_ok_at = COALESCE(job_runs.first_ok_at, CASE WHEN %(ok)s THEN now() END),
            last_run_at = now(),
            last_ok_at = CASE WHEN %(ok)s THEN now() ELSE job_runs.last_ok_at END,
            state = COALESCE(%(state)s, job_runs.state),
            last_error = %(error)s,
            last_items = COALESCE(%(items)s, job_runs.last_items)
        """,
        {"job": job, "ok": ok, "state": state, "error": (error or "")[:500] or None, "items": items},
    )


def _tracked_companies(conn: psycopg.Connection, show_demo: bool) -> list[dict]:
    return [dict(r) for r in conn.execute(
        "SELECT id, ticker, name, sector, provider_symbol FROM companies WHERE (NOT is_demo OR %s) ORDER BY id",
        (show_demo,),
    ).fetchall()]


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", s.lower().replace("&", "and")).strip()


# ---------- GDELT raw files (company, sector and theme headlines) ----------
#
# GDELT publishes a "GKG" file every 15 minutes listing the articles it has
# crawled (URL, publisher domain, page title). These static files have no
# rate limit, unlike GDELT's search API, which refused Vercel's shared
# addresses (2026-11-08/10). Each run reads the files since the last one it
# finished, so nothing is skipped and nothing is read twice.

GKG_BASE = "http://data.gdeltproject.org/gdeltv2/"
GKG_STEP = timedelta(minutes=15)
GKG_MIN_AGE = timedelta(minutes=20)  # a new file can take a few minutes to appear
GKG_LOOKBACK = timedelta(hours=6)  # catch up at most this far after an outage
GKG_GIVE_UP = timedelta(hours=3)  # a file still missing after this is skipped
GKG_FILES_PER_RUN = 8
_PAGE_TITLE = re.compile(r"<PAGE_TITLE>(.*?)</PAGE_TITLE>", re.S)
# Single words too common to identify a company on their own.
_NOT_A_NAME = frozenset({"india", "indian", "hindustan", "shree", "sagar", "escorts", "tech", "state", "bharat"})


def _floor_slot(t: datetime) -> datetime:
    return t.replace(minute=t.minute - t.minute % 15, second=0, microsecond=0)


def _stamp(t: datetime) -> str:
    return t.strftime("%Y%m%d%H%M%S")


def gkg_slots(state: Optional[str], now: datetime) -> list[datetime]:
    """The 15-minute files to read this run, oldest first: the ones after the
    last file finished (or the last few hours on a first run), up to the
    newest that should exist by now."""
    latest = _floor_slot(now - GKG_MIN_AGE)
    earliest = _floor_slot(now - GKG_LOOKBACK)
    start = earliest
    if state:
        done = datetime.strptime(state, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
        start = max(done + GKG_STEP, earliest)
    out, t = [], start
    while t <= latest and len(out) < GKG_FILES_PER_RUN:
        out.append(t)
        t += GKG_STEP
    return out


def company_patterns(companies: list[dict]) -> list[tuple[int, re.Pattern]]:
    """Word-boundary patterns per company: its name, its name without a
    trailing "India"/"Limited", a distinctive first word, and the ticker in
    capitals ("ITC", never the word "itc")."""
    out = []
    for c in companies:
        name = c["name"].strip()
        short = re.sub(r"\s+(India|Limited|Ltd\.?)$", "", name, flags=re.I)
        first = name.split()[0]
        names = {name, short}
        if len(first) >= 5 and first.lower() not in _NOT_A_NAME:
            names.add(first)
        # Acronyms (ITC, HUL) and the ticker only count in capitals.
        exact = {n for n in names if n.isupper()}
        if len(c["ticker"]) >= 3:
            exact.add(c["ticker"].upper())
        loose = sorted(names - exact, key=len, reverse=True)
        parts = [rf"(?i:\b({'|'.join(re.escape(n) for n in loose)})\b)"] if loose else []
        parts += [rf"\b{re.escape(n)}\b" for n in sorted(exact)]
        out.append((c["id"], re.compile("|".join(parts))))
    return out


def parse_gkg(text: str, companies: list[tuple[int, re.Pattern]]) -> list[dict]:
    """One GKG file -> headline rows. Allowlisted publishers and sections
    only; advice dropped; a company headline needs an event type, anything
    else a theme, or it isn't kept."""
    out, seen = [], set()
    for line in text.split("\n"):
        f = line.split("\t")
        if len(f) < 27:
            continue
        domain, url = f[3], f[4]
        publisher = nc.publisher_for(domain)
        if not publisher or url in seen or not nc.allowed_section(domain, urlparse(url).path):
            continue
        m = _PAGE_TITLE.search(f[26])
        if not m:
            continue
        title = nc.clean_title(html.unescape(m.group(1)))
        if not title or nc.is_advice(title):
            continue
        try:
            when = datetime.strptime(f[1], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        company_id = next((cid for cid, rx in companies if rx.search(title)), None)
        key = None
        if company_id is not None:
            key = next((e.key for e in nc.EVENT_TYPES if e.pattern.search(title)), None)
            if key is None:
                company_id = None  # not company news; may still be a themed headline
        if key is None:
            key = nc.classify(title, company=False)
        if key is None:
            continue
        seen.add(url)
        out.append({"url": url, "title": title, "publisher": publisher, "published_at": when,
                    "theme": key, "company_id": company_id})
    return out


def _store_news(conn: psycopg.Connection, rows: list[dict], *, source: str) -> int:
    n = 0
    for r in rows:
        # The same agency story often runs on several sites: keep the first.
        cur = conn.execute(
            """
            INSERT INTO news_items (url, title, publisher, published_at, source, theme, company_id)
            SELECT %s, %s, %s, %s, %s, %s, %s
            WHERE NOT EXISTS (
                SELECT 1 FROM news_items
                WHERE lower(title) = lower(%s) AND published_at > now() - interval '2 days'
            )
            ON CONFLICT (url) DO NOTHING
            """,
            (r["url"], r["title"], r["publisher"], r["published_at"], source, r["theme"], r.get("company_id"),
             r["title"]),
        )
        n += cur.rowcount
    return n


def run_gdelt_files(conn_factory, *, show_demo: bool, now: Optional[datetime] = None) -> dict:
    now = now or datetime.now(timezone.utc)
    with conn_factory() as conn:
        companies = company_patterns(_tracked_companies(conn, show_demo))
        row = conn.execute("SELECT state FROM job_runs WHERE job = 'gdelt'").fetchone()
    state = row["state"] if row else None
    added, files, error = 0, 0, None
    for slot in gkg_slots(state, now):
        name = f"{_stamp(slot)}.gkg.csv.zip"
        try:
            r = requests.get(GKG_BASE + name, headers=UA, timeout=40)
        except requests.RequestException as exc:
            error = f"{name}: {exc}"
            break
        if r.status_code == 404:
            if now - slot > GKG_GIVE_UP:
                state = _stamp(slot)  # never published; move past it
                continue
            break  # not out yet: the next run picks it up
        if r.status_code != 200:
            error = f"{name}: HTTP {r.status_code}"
            break
        try:
            z = zipfile.ZipFile(io.BytesIO(r.content))
            text = z.read(z.namelist()[0]).decode("utf-8", "ignore")
        except (zipfile.BadZipFile, IndexError) as exc:
            error = f"{name}: {exc}"
            break
        rows = parse_gkg(text, companies)
        with conn_factory() as conn:
            added += _store_news(conn, rows, source="gdelt")
        state = _stamp(slot)
        files += 1
    with conn_factory() as conn:
        conn.execute("DELETE FROM news_items WHERE published_at < now() - %s::interval", (NEWS_RETENTION,))
        _job_done(conn, "gdelt", ok=error is None, state=state, error=error, items=added)
    return {"files": files, "added": added, "up_to": state, "error": error}


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
        added = _store_news(conn, rows, source="rbi")
        _job_done(conn, "rbi", ok=True, items=added)
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
        _job_done(conn, "nse", ok=True, items=added)
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
    errors = {k: v for k, v in result.items() if k.endswith("_error")}
    stored = sum(result.get("worldbank", {}).values()) + result.get("fred", 0)
    with conn_factory() as conn:
        _job_done(conn, "macro", ok=not errors, error=json.dumps(errors) if errors else None, items=stored)
    if errors:
        result["error"] = json.dumps(errors)[:300]
    return result


# ---------- Reads for the pages ----------

def _item_out(row: dict, view: str) -> Optional[dict]:
    why = nc.sentence_for(row["theme"], view)
    if why is None:
        return None
    chain, explanation = nc.explanation_for(row["theme"], view)
    return {
        "chain": chain, "explanation": explanation,
        "title": row["title"], "url": row["url"], "publisher": row["publisher"],
        "publisher_domain": nc.domain_for(row["publisher"]),
        "published_at": row["published_at"].isoformat(), "theme": row["theme"],
        "theme_label": nc.label_for(row["theme"]), "why": why,
        "sectors": [nc.SECTOR_LABELS[v] for v in nc.views_for(row["theme"]) if v != "economy"],
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
        SELECT id, title, event_date, sectors, why, why_long, chain, source_url, pinned, show_until FROM world_events
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
        "why_long": r.get("why_long"), "chain": r.get("chain"),
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
            chain, explanation = nc.explanation_for(r["event_type"], view) if e else (None, None)
            filings.append({"url": r["url"], "subject": r["subject"], "filed_at": r["filed_at"].isoformat(),
                            "type_label": e.label if e else None, "why": e.sentence if e else None,
                            "chain": chain, "explanation": explanation})
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
        "videos": _company_videos(conn, company, view),
        "updated_at": _updated(conn, ("gdelt", "rbi", "nse")),
    }


def _company_videos(conn: psycopg.Connection, company: Optional[dict], view: str) -> list[dict]:
    from app.services.videos import videos_for  # videos imports this module

    out = videos_for(conn, view, 4, company["id"]) if company else []
    return out + videos_for(conn, view, 6 - len(out))

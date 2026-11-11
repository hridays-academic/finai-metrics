"""News videos from allowlisted YouTube channels (2026-11).

Read through the official YouTube Data API with the cheapest calls: each
channel's uploads list (1 quota unit) and one batch lookup for durations
(1 unit), so an hourly run costs ~9 of the free 10,000 daily units. Titles
are matched to our themes and league companies with the same rules as
headlines (advice dropped, unmatched hidden). Stored rows are deleted after
30 days, as YouTube's developer policies require for stored API data.

Pages never contact YouTube: a video card shows our own theme illustration,
and the player (youtube-nocookie.com) loads only when the visitor clicks.
"""
import re
from datetime import datetime, timedelta
from typing import Optional

import psycopg
import requests

from app import news_config as nc
from app.config import get_settings
from app.services.news import _job_done, _tracked_companies, company_patterns

API = "https://www.googleapis.com/youtube/v3"
RETENTION = timedelta(days=30)
PER_CHANNEL = 25
_ECONOMIC = re.compile(
    r"\b(oil|crude|shipping|trade|tariffs?|prices?|markets?|econom\w*|sanctions?|supply|exports?|imports?)\b", re.I)
_DURATION = re.compile(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?")


def parse_duration(iso: str) -> Optional[int]:
    m = _DURATION.fullmatch(iso or "")
    if not m or not any(m.groups()):
        return None
    d, h, mi, s = (int(x or 0) for x in m.groups())
    return ((d * 24 + h) * 60 + mi) * 60 + s


def classify_video(title: str, companies) -> Optional[tuple[str, Optional[int]]]:
    """(theme or event type, company id or None), or None to skip."""
    title = nc.clean_title(title)
    if not title or nc.is_advice(title):
        return None
    company_id = next((cid for cid, rx in companies if rx.search(title)), None)
    if company_id is not None:
        key = next((e.key for e in nc.EVENT_TYPES if e.pattern.search(title)), None)
        if key:
            return key, company_id
    key = nc.classify(title, company=False)
    # News channels post a lot of general war coverage; a "war and supply"
    # video needs an economic angle too.
    if key == "supply" and not _ECONOMIC.search(title):
        return None
    return (key, None) if key else None


def run_videos(conn_factory, *, show_demo: bool) -> dict:
    key = get_settings().youtube_api_key
    if not key:
        return {"skipped": "YOUTUBE_API_KEY isn't set"}
    with conn_factory() as conn:
        companies = company_patterns(_tracked_companies(conn, show_demo))
        known = {r["video_id"] for r in conn.execute("SELECT video_id FROM news_videos").fetchall()}
    candidates: dict[str, dict] = {}
    error = None
    for channel_id, channel in nc.YOUTUBE_CHANNELS.items():
        try:
            r = requests.get(f"{API}/playlistItems", timeout=20, params={
                "part": "snippet", "playlistId": "UU" + channel_id[2:], "maxResults": PER_CHANNEL, "key": key})
            r.raise_for_status()
        except requests.RequestException as exc:
            error = f"{channel}: {exc}"
            continue
        for it in r.json().get("items", []):
            sn = it.get("snippet", {})
            vid = (sn.get("resourceId") or {}).get("videoId")
            if not vid or vid in known:
                continue
            match = classify_video(sn.get("title", ""), companies)
            if match:
                candidates[vid] = {"title": nc.clean_title(sn["title"]), "channel_id": channel_id, "channel": channel,
                                   "published_at": sn.get("publishedAt"), "theme": match[0], "company_id": match[1]}
    added = 0
    ids = list(candidates)
    for i in range(0, len(ids), 50):
        try:
            r = requests.get(f"{API}/videos", timeout=20, params={
                "part": "contentDetails,snippet", "id": ",".join(ids[i:i + 50]), "key": key})
            r.raise_for_status()
        except requests.RequestException as exc:
            error = f"durations: {exc}"
            break
        with conn_factory() as conn:
            for v in r.json().get("items", []):
                if v.get("snippet", {}).get("liveBroadcastContent") in ("live", "upcoming"):
                    continue  # a live stream has no fixed length and may change
                c = candidates[v["id"]]
                cur = conn.execute(
                    """
                    INSERT INTO news_videos (video_id, channel_id, channel_title, title, published_at,
                                             duration_seconds, theme, company_id)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT (video_id) DO NOTHING
                    """,
                    (v["id"], c["channel_id"], c["channel"], c["title"], c["published_at"],
                     parse_duration(v.get("contentDetails", {}).get("duration", "")), c["theme"], c["company_id"]),
                )
                added += cur.rowcount
    with conn_factory() as conn:
        conn.execute("DELETE FROM news_videos WHERE fetched_at < now() - %s::interval", (RETENTION,))
        _job_done(conn, "videos", ok=error is None, error=error, items=added)
    return {"candidates": len(candidates), "added": added, "error": error}


def video_out(row: dict, view: str) -> Optional[dict]:
    why = nc.sentence_for(row["theme"], view)
    if why is None:
        return None
    return {
        "video_id": row["video_id"], "title": row["title"], "channel": row["channel_title"],
        "published_at": row["published_at"].isoformat(), "duration_seconds": row["duration_seconds"],
        "theme": row["theme"], "theme_label": nc.label_for(row["theme"]), "why": why,
    }


def videos_for(conn: psycopg.Connection, view: str, limit: int = 8, company_id: Optional[int] = None) -> list[dict]:
    if company_id is not None:
        rows = conn.execute(
            "SELECT * FROM news_videos WHERE company_id = %s ORDER BY published_at DESC LIMIT %s", (company_id, limit),
        ).fetchall()
        return [v for v in (video_out(dict(r), view) for r in rows) if v]
    themes = [t.key for t in nc.THEMES if view == "all" or view in t.sentences]
    rows = conn.execute(
        "SELECT * FROM news_videos WHERE company_id IS NULL AND theme = ANY(%s) ORDER BY published_at DESC LIMIT %s",
        (themes, limit),
    ).fetchall()
    out = []
    for r in rows:
        v = view
        if view == "all":
            sentences = nc.THEMES_BY_KEY[r["theme"]].sentences
            v = "economy" if "economy" in sentences else next(iter(sentences))
        item = video_out(dict(r), v)
        if item:
            out.append(item)
    return out

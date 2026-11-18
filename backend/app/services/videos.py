"""News videos from allowlisted YouTube channels (2026-11).

Read through the official YouTube Data API with the cheapest calls: each
channel's uploads list (1 quota unit) and one batch lookup for durations
(1 unit), so an hourly run costs ~9 of the free 10,000 daily units. Titles
are matched to our themes and league companies with the same rules as
headlines (advice dropped, unmatched hidden). Stored rows are deleted after
30 days, as YouTube's developer policies require for stored API data.

Pages never contact YouTube before play: a video card shows the video's
thumbnail from our own copy (downloaded once by this job from YouTube's image
server, served by /api/videos/{id}/thumbnail, deleted with the video at 30
days; Hriday chose this 2026-11-18 over loading thumbnails from YouTube,
reading the thumbnail as API data under the 30-day rule), or our theme
illustration when there is no copy. The player (youtube-nocookie.com) loads
only when the visitor clicks.
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
    r"\b(oil|crude|shipping|trade|tariffs?|prices?|markets?|econom\w*|sanctions?|supply|exports?|imports?|demand|costs?|"
    r"growth|inflation|output|production)\b", re.I)
NEEDS_ECONOMIC = ("supply", "inputs")
THUMB_URL = "https://i.ytimg.com/vi/{}/hqdefault.jpg"  # the API's "high" thumbnail
THUMB_MAX_BYTES = 400_000
THUMBS_PER_RUN = 40
_VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{6,20}")
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
    # News channels post a lot of general war and accident coverage; a "war
    # and supply" or "input prices" video needs an economic angle too (a
    # steel-plant blast isn't about steel prices).
    if key in NEEDS_ECONOMIC and not _ECONOMIC.search(title):
        return None
    return (key, None) if key else None


def fetch_thumbnail(video_id: str) -> Optional[bytes]:
    """The video's thumbnail as JPEG bytes, or None (bad id, not found, not a
    JPEG, or too large)."""
    if not _VIDEO_ID.fullmatch(video_id or ""):
        return None
    try:
        r = requests.get(THUMB_URL.format(video_id), timeout=15)
    except requests.RequestException:
        return None
    body = r.content or b""
    if r.status_code != 200 or not body.startswith(b"\xff\xd8") or len(body) > THUMB_MAX_BYTES:
        return None
    return body


def _missing_thumbnail_ids(conn: psycopg.Connection) -> list[str]:
    return [r["video_id"] for r in conn.execute(
        """
        SELECT v.video_id FROM news_videos v
        LEFT JOIN news_video_thumbnails t ON t.video_id = v.video_id
        WHERE t.video_id IS NULL ORDER BY v.published_at DESC LIMIT %s
        """, (THUMBS_PER_RUN,)).fetchall()]


def store_missing_thumbnails(conn_factory) -> int:
    """Copies the thumbnail of each stored video that has none yet (newest
    first, THUMBS_PER_RUN at most). No connection is held while downloading.
    Returns 0 if the table isn't there yet: after a deploy, job tables are
    created by the main app's first request (CLAUDE.md, "Cron runs in its own
    function")."""
    try:
        with conn_factory() as conn:
            ids = _missing_thumbnail_ids(conn)
    except psycopg.errors.UndefinedTable:
        return 0
    got = {vid: img for vid in ids if (img := fetch_thumbnail(vid)) is not None}
    stored = 0
    if got:
        with conn_factory() as conn:
            for vid, img in got.items():
                cur = conn.execute(
                    """
                    INSERT INTO news_video_thumbnails (video_id, content_type, image)
                    SELECT %s, 'image/jpeg', %s WHERE EXISTS (SELECT 1 FROM news_videos WHERE video_id = %s)
                    ON CONFLICT (video_id) DO NOTHING
                    """, (vid, img, vid))
                stored += cur.rowcount
    return stored


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
    thumbnails = store_missing_thumbnails(conn_factory)
    with conn_factory() as conn:
        conn.execute("DELETE FROM news_videos WHERE fetched_at < now() - %s::interval", (RETENTION,))
        # Videos stored before a rule was tightened are dropped once they fail it.
        stale = [r["video_id"] for r in conn.execute(
            "SELECT video_id, title FROM news_videos WHERE company_id IS NULL AND theme = ANY(%s)",
            (list(NEEDS_ECONOMIC),)).fetchall() if not _ECONOMIC.search(r["title"])]
        if stale:
            conn.execute("DELETE FROM news_videos WHERE video_id = ANY(%s)", (stale,))
        _job_done(conn, "videos", ok=error is None, error=error, items=added)
    return {"candidates": len(candidates), "added": added, "thumbnails": thumbnails, "error": error}


def video_out(row: dict, view: str) -> Optional[dict]:
    why = nc.sentence_for(row["theme"], view)
    if why is None:
        return None
    chain, explanation = nc.explanation_for(row["theme"], view)
    return {
        "chain": chain, "explanation": explanation,
        "video_id": row["video_id"], "title": row["title"], "channel": row["channel_title"],
        "published_at": row["published_at"].isoformat(), "duration_seconds": row["duration_seconds"],
        "theme": row["theme"], "theme_label": nc.label_for(row["theme"]), "why": why,
        "has_thumbnail": bool(row.get("has_thumbnail")),
    }


_SELECT = (
    "SELECT v.*, t.video_id IS NOT NULL AS has_thumbnail FROM news_videos v "
    "LEFT JOIN news_video_thumbnails t ON t.video_id = v.video_id"
)


def videos_for(conn: psycopg.Connection, view: str, limit: int = 8, company_id: Optional[int] = None) -> list[dict]:
    if company_id is not None:
        rows = conn.execute(
            f"{_SELECT} WHERE v.company_id = %s ORDER BY v.published_at DESC LIMIT %s", (company_id, limit),
        ).fetchall()
        return [v for v in (video_out(dict(r), view) for r in rows) if v]
    themes = [t.key for t in nc.THEMES if view == "all" or view in t.sentences]
    rows = conn.execute(
        f"{_SELECT} WHERE v.company_id IS NULL AND v.theme = ANY(%s) ORDER BY v.published_at DESC LIMIT %s",
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

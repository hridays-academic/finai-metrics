"""Edge caching for public GET endpoints (audit S2, master plan phase 2).

Vercel's CDN caches a response when it says `public, s-maxage=...`. Only
anonymous requests (no Authorization header, no cookie) to the routes below
get that header; everything else is `private, no-store`, so a response that
might carry someone's own score or forecast is never stored at the edge. The
frontend also adds `a=1` to signed-in GETs, so a signed-in request never
shares a cache entry with an anonymous one.

Times: (s-maxage, stale-while-revalidate), sized to how often each changes.
"""
import re

RULES: tuple[tuple[re.Pattern, int, int], ...] = (
    (re.compile(r"^/api/league/recent-results$"), 300, 86400),
    (re.compile(r"^/api/league/events$"), 300, 86400),
    (re.compile(r"^/api/league/events/\d+$"), 300, 86400),
    (re.compile(r"^/api/league/events/\d+/outcome$"), 300, 86400),
    (re.compile(r"^/api/league/config$"), 3600, 86400),
    (re.compile(r"^/api/league/companies/\d+/history$"), 3600, 86400),
    (re.compile(r"^/api/practice/cases$"), 3600, 86400),
    (re.compile(r"^/api/practice/cases/[0-9a-z]{6}$"), 3600, 86400),
    (re.compile(r"^/api/practice/cases/[0-9a-z]{6}/prices$"), 3600, 86400),
    (re.compile(r"^/api/news$"), 900, 86400),
    (re.compile(r"^/api/news/company/[^/]+$"), 900, 86400),
    (re.compile(r"^/api/world-events$"), 900, 86400),
    (re.compile(r"^/api/macro$"), 3600, 86400),
    (re.compile(r"^/api/price-history/[^/]+$"), 21600, 86400),
    (re.compile(r"^/api/play/cards$"), 3600, 86400),
    (re.compile(r"^/api/play/daily$"), 300, 3600),
    (re.compile(r"^/api/boards/(week|season|improved)$"), 300, 3600),
)

PRIVATE = "private, no-store"


def cache_control(method: str, path: str, status: int, headers: dict[str, str]) -> str | None:
    """The Cache-Control value for a response, or None to leave it alone."""
    if method != "GET" or status != 200:
        return PRIVATE if path.startswith("/api/") else None
    if not path.startswith("/api/"):
        return None
    if "authorization" in headers or "cookie" in headers:
        return PRIVATE
    for pattern, s_max, swr in RULES:
        if pattern.match(path):
            return f"public, max-age=0, s-maxage={s_max}, stale-while-revalidate={swr}"
    return PRIVATE

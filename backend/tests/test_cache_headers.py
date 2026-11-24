"""S2 (master plan): public data caches at the edge; nothing personal ever does."""
import pytest

from app.cache_headers import PRIVATE, RULES, cache_control

PUBLIC = [
    "/api/league/recent-results", "/api/league/events", "/api/league/events/7", "/api/league/events/7/outcome",
    "/api/league/config", "/api/league/companies/3/history", "/api/practice/cases", "/api/practice/cases/03kln6",
    "/api/practice/cases/03kln6/prices", "/api/news", "/api/news/company/MARUTI.NS", "/api/world-events",
    "/api/macro", "/api/price-history/MARUTI.NS",
]
PERSONAL = [
    "/api/auth/me", "/api/activity", "/api/league/events/7/my-result", "/api/league/events/7/my-forecast",
    "/api/league/me/season", "/api/practice/me", "/api/workspace/7", "/api/admin/events", "/api/company/TCS",
]


@pytest.mark.parametrize("path", PUBLIC)
def test_public_routes_cache_only_for_anonymous_requests(path):
    assert cache_control("GET", path, 200, {}).startswith("public, max-age=0, s-maxage=")
    assert cache_control("GET", path, 200, {"authorization": "Bearer x"}) == PRIVATE
    assert cache_control("GET", path, 200, {"cookie": "a=b"}) == PRIVATE
    assert cache_control("GET", path, 404, {}) == PRIVATE
    assert cache_control("POST", path, 200, {}) == PRIVATE


@pytest.mark.parametrize("path", PERSONAL)
def test_personal_routes_never_cache(path):
    assert cache_control("GET", path, 200, {}) == PRIVATE
    assert all(not pattern.match(path) for pattern, _, _ in RULES)


def test_middleware_sets_the_header(client):
    assert client.get("/api/health").headers["cache-control"] == PRIVATE
    res = client.get("/api/league/config")
    assert res.status_code == 200 and "s-maxage=3600" in res.headers["cache-control"]
    res = client.get("/api/league/config", headers={"Authorization": "Bearer nope"})
    assert res.headers["cache-control"] == PRIVATE

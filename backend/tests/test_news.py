"""News, world events and macro context. Parsers and rules are pure; the API
tests use the test-branch database only (conftest.py)."""
import io
from datetime import date, datetime, timezone

import pytest

from app import news_config as nc
from app.config import get_settings
from app.services import news

ADMIN = "admin@example.com"


# ---------- Classification and the approved lines ----------

@pytest.mark.parametrize("title,company,expected", [
    ("Brent crude climbs above $120 as supply fears grow", False, "crude"),
    ("RBI keeps repo rate unchanged at policy meeting", False, "rates"),
    ("Monsoon rainfall 8% above normal, says IMD", False, "monsoon"),
    ("Rupee slips to record low against the dollar", False, "rupee"),
    ("US raises tariffs on Indian auto parts", False, "tariffs"),
    ("GST council cuts rate on small cars", False, "gst"),
    ("Dabur Q2 results: net profit rises 9%", True, "results"),
    ("Maruti Suzuki hikes prices across models", True, "price_change"),
    ("Company appoints new CEO", True, "management"),
    ("Cement maker to commission new plant in Odisha", True, "capacity"),
    ("Celebrity attends film premiere", False, None),
])
def test_classify(title, company, expected):
    assert nc.classify(title, company=company) == expected


@pytest.mark.parametrize("title", [
    "Buy Maruti, target price Rs 14,000: brokerage",
    "Neutral on Dabur, target of Rs 425: Motilal Oswal",
    "Stocks to watch today",
    "Analysts upgrade Marico",
])
def test_advice_headlines_are_dropped(title):
    assert nc.is_advice(title)


def test_every_line_uses_may_and_follows_copy_rules():
    lines = [s for t in nc.THEMES for s in t.sentences.values()] + [e.sentence for e in nc.EVENT_TYPES]
    for s in lines:
        assert " may " in f" {s} ", s
        assert "--" not in s and "—" not in s and "!" not in s, s


def test_sentence_for_views():
    assert nc.sentence_for("crude", "cement").startswith("Higher oil prices")
    assert nc.sentence_for("tech", "economy") is None
    assert nc.sentence_for("results", "it") == nc.EVENT_TYPES_BY_KEY["results"].sentence


def test_clean_title():
    assert nc.clean_title("Texmaco wins Rs 428 . 55 Crore order - The HinduBusinessLine") == "Texmaco wins Rs 428.55 Crore order"


# ---------- Parsers ----------

def test_parse_gdelt_keeps_allowlisted_themed_non_advice():
    payload = {"articles": [
        {"url": "https://www.livemint.com/a", "title": "Brent crude jumps on Red Sea worries - Mint",
         "domain": "livemint.com", "seendate": "20261107T173000Z"},
        {"url": "https://example.com/b", "title": "Brent crude jumps", "domain": "example.com", "seendate": "20261107T173000Z"},
        {"url": "https://www.moneycontrol.com/c", "title": "Neutral Dabur, target of Rs 425",
         "domain": "moneycontrol.com", "seendate": "20261107T173000Z"},
        {"url": "https://www.thehindu.com/d", "title": "Cricket team wins series", "domain": "thehindu.com",
         "seendate": "20261107T173000Z"},
    ]}
    rows = news.parse_gdelt(payload, company=False)
    assert [r["url"] for r in rows] == ["https://www.livemint.com/a"]
    assert rows[0]["publisher"] == "Mint" and rows[0]["theme"] == "crude"
    assert rows[0]["published_at"] == datetime(2026, 11, 7, 17, 30, tzinfo=timezone.utc)


NSE_RSS = """<rss version="2.0"><channel>
<item><title>Maruti Suzuki India Limited</title>
<link>https://nsearchives.nseindia.com/corporate/MARUTI_08112026113924_Investor_Presentation.pdf</link>
<description>Maruti Suzuki India Limited has informed the Exchange about Investor Presentation |SUBJECT: Investor Presentation</description>
<pubDate>08-Nov-2026 11:39:39</pubDate></item>
<item><title>Some Other Company Limited</title>
<link>https://nsearchives.nseindia.com/corporate/OTHER_08112026.pdf</link>
<description>Some Other Company Limited has informed the Exchange about General Updates |SUBJECT: General Updates</description>
<pubDate>08-Nov-2026 11:55:25</pubDate></item>
</channel></rss>"""


def test_parse_nse_matches_tracked_companies_only():
    rows = news.parse_nse(NSE_RSS, [{"id": 3, "ticker": "MARUTI", "name": "Maruti Suzuki India"}])
    assert len(rows) == 1
    r = rows[0]
    assert r["company_id"] == 3 and r["subject"] == "Investor Presentation" and r["event_type"] == "commentary"
    assert r["filed_at"].isoformat() == "2026-11-08T11:39:39+05:30"


RBI_RSS = """﻿<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel>
<item><title>Monetary Policy Statement, 2026-27: Resolution of the Monetary Policy Committee</title>
<link>https://rbi.org.in/pr1</link><pubDate>Fri, 06 Nov 2026 10:15:00</pubDate></item>
<item><title>Result of the 3-day Variable Rate Reverse Repo (VRRR) auction</title>
<link>https://rbi.org.in/pr3</link><pubDate>Fri, 06 Nov 2026 12:00:00</pubDate></item>
<item><title>RBI imposes monetary penalty on a co-operative bank</title>
<link>https://rbi.org.in/pr2</link><pubDate>Fri, 06 Nov 2026 11:00:00</pubDate></item>
</channel></rss>"""


def test_parse_rbi_keeps_themed_items():
    rows = news.parse_rbi(RBI_RSS)
    assert [r["url"] for r in rows] == ["https://rbi.org.in/pr1"]
    assert rows[0]["theme"] == "rates" and rows[0]["publisher"] == "RBI"


# ---------- Macro: the 30-day rule and the World Bank file ----------

def test_lag_points_monthly_and_daily():
    today = date(2026, 11, 8)  # cutoff 2026-10-09
    monthly = [{"date": "2026-08-01", "value": 1}, {"date": "2026-09-01", "value": 2}, {"date": "2026-10-01", "value": 3}]
    assert [p["value"] for p in news.lag_points(monthly, "monthly", today)] == [1, 2]
    daily = [{"date": "2026-10-09", "value": 1}, {"date": "2026-10-10", "value": 2}]
    assert [p["value"] for p in news.lag_points(daily, "daily", today)] == [1]


def test_parse_world_bank():
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "Monthly Prices"
    ws.append(["World Bank Commodity Price Data (The Pink Sheet)"])
    ws.append([None, "Crude oil, Brent", "Coal, Australian", "Palm oil", "Aluminum", "Iron ore, cfr spot"])
    ws.append([None, "($/bbl)", "($/mt)", "($/mt)", "($/mt)", "($/dmtu)"])
    ws.append(["2019M12", 65.0, 67.0, 700.0, 1770.0, 92.0])
    ws.append(["2026M09", 116.8, 147.1, 1180.0, 3283.0, 97.7])
    buf = io.BytesIO()
    wb.save(buf)
    series = news.parse_world_bank(buf.getvalue(), since_year=2021)
    assert series["brent"] == [{"date": "2026-09-01", "value": 116.8}]
    assert set(series) == {"brent", "coal", "palm_oil", "aluminium", "iron_ore"}


# ---------- API (test database) ----------

@pytest.fixture
def admin_env(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", ADMIN)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _signup(client, email):
    res = client.post("/api/auth/signup", json={"email": email, "name": "T", "password": "longenough1", "accept_terms": True})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['token']}"}


EVENT = {"title": "Test event", "event_date": "2026-11-01", "sectors": ["cement", "economy"],
         "why": "Test line that may matter for testing.", "source_url": "https://example.com/x", "pinned": True}


def test_world_events_admin_flow(conn, client, admin_env):
    admin = _signup(client, ADMIN)
    student = _signup(client, "student@example.com")
    assert client.post("/api/admin/world-events", json=EVENT, headers=student).status_code == 403
    bad = client.post("/api/admin/world-events", json={**EVENT, "source_url": "javascript:alert(1)"}, headers=admin)
    assert bad.status_code == 422
    res = client.post("/api/admin/world-events", json=EVENT, headers=admin)
    assert res.status_code == 200, res.text
    eid = res.json()["id"]
    assert res.json()["sector_labels"] == ["Cement", "Economy & policy"]
    listed = client.get("/api/world-events").json()
    assert [e["id"] for e in listed] == [eid]
    hidden = client.put(f"/api/admin/world-events/{eid}", json={**EVENT, "show_until": "2026-11-02"}, headers=admin)
    assert hidden.status_code == 200
    assert client.get("/api/world-events").json() == []  # expired
    assert client.delete(f"/api/admin/world-events/{eid}", headers=admin).status_code == 204
    actions = [r[0] for r in conn.execute(
        "SELECT action FROM audit_log WHERE entity = 'world_event' ORDER BY id").fetchall()]
    assert actions == ["create", "update", "delete"]


def test_news_list_shows_sector_lines(conn, client):
    conn.execute(
        "INSERT INTO news_items (url, title, publisher, published_at, source, theme) VALUES "
        "('https://www.livemint.com/a', 'Brent crude jumps', 'Mint', now(), 'gdelt', 'crude'),"
        "('https://www.livemint.com/b', 'Tech spending rises', 'Mint', now() - interval '1 hour', 'gdelt', 'tech')"
    )
    allv = client.get("/api/news?view=all").json()["items"]
    assert [i["theme"] for i in allv] == ["crude", "tech"]
    assert allv[0]["why"] == nc.sentence_for("crude", "economy") and allv[1]["sector_label"] == "IT"
    cement = client.get("/api/news?view=cement").json()["items"]
    assert [i["why"] for i in cement] == [nc.sentence_for("crude", "cement")]
    assert client.get("/api/news?view=nope").status_code == 404


def test_macro_waits_for_fred_key(conn, client, monkeypatch):
    monkeypatch.delenv("FRED_API_KEY", raising=False)
    get_settings.cache_clear()
    series = {s["key"]: s for s in client.get("/api/macro").json()}
    assert series["usd_inr"]["status"] == "coming_soon"
    assert series["brent"]["status"] == "unavailable"  # nothing fetched yet


def test_cron_refuses_without_secret(client, monkeypatch):
    monkeypatch.delenv("CRON_SECRET", raising=False)
    get_settings.cache_clear()
    assert client.get("/api/cron/rbi").status_code == 503
    monkeypatch.setenv("CRON_SECRET", "s3cret")
    get_settings.cache_clear()
    assert client.get("/api/cron/rbi").status_code == 401
    assert client.get("/api/cron/rbi", headers={"Authorization": "Bearer wrong"}).status_code == 401
    get_settings.cache_clear()

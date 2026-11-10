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
    ("Mumbai redevelopment turf war: BMC and SRA clash", False, None),
    ("Iran sets conditions as the war may not resume", False, "supply"),
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

def _gkg_line(url, domain, title, date="20261110060000"):
    f = [""] * 27
    f[0], f[1], f[3], f[4] = "id", date, domain, url
    f[26] = f"<PAGE_TITLE>{title}</PAGE_TITLE>"
    return "\t".join(f)


COMPANIES = news.company_patterns([
    {"id": 3, "ticker": "MARUTI", "name": "Maruti Suzuki India"},
    {"id": 6, "ticker": "ITC", "name": "ITC"},
    {"id": 9, "ticker": "ESCORTS", "name": "Escorts Kubota"},
])


def test_parse_gkg_filters_publishers_sections_advice_and_themes():
    text = "\n".join([
        _gkg_line("https://www.livemint.com/economy/a", "livemint.com", "Brent crude jumps on Red Sea worries"),
        _gkg_line("https://www.livemint.com/sports/b", "livemint.com", "Brent crude jumps again"),  # wrong section
        _gkg_line("https://example.com/c", "example.com", "Brent crude jumps"),  # not a publisher
        _gkg_line("https://www.moneycontrol.com/news/business/d", "moneycontrol.com", "Neutral Dabur, target of Rs 425"),
        _gkg_line("https://www.thehindu.com/business/e", "thehindu.com", "Crude bomb blasts rock Dhaka"),  # no theme now
        _gkg_line("https://www.thehindubusinessline.com/f", "thehindubusinessline.com",
                  "Tasmac&#x27;s sales touch &#x20B9;441 crore amid GST change"),
    ])
    rows = news.parse_gkg(text, COMPANIES)
    assert [r["url"] for r in rows] == ["https://www.livemint.com/economy/a", "https://www.thehindubusinessline.com/f"]
    assert rows[0]["theme"] == "crude" and rows[0]["publisher"] == "Mint" and rows[0]["company_id"] is None
    assert rows[1]["title"] == "Tasmac's sales touch \u20b9441 crore amid GST change"
    assert rows[0]["published_at"] == datetime(2026, 11, 10, 6, 0, tzinfo=timezone.utc)


def test_parse_gkg_company_news_needs_an_event_type():
    text = "\n".join([
        _gkg_line("https://www.livemint.com/companies/a", "livemint.com", "Maruti hikes prices across models"),
        _gkg_line("https://www.livemint.com/companies/b", "livemint.com", "Maruti Suzuki unveils a new colour"),
        _gkg_line("https://www.livemint.com/companies/c", "livemint.com", "Escorts held at the airport"),
        _gkg_line("https://www.livemint.com/companies/d", "livemint.com", "ITC Q2 results: net profit rises 6%"),
        _gkg_line("https://www.livemint.com/companies/e", "livemint.com", "Mitch says the itc rumour is false, results soon"),
    ])
    rows = {r["url"][-1]: r for r in news.parse_gkg(text, COMPANIES)}
    assert rows["a"]["company_id"] == 3 and rows["a"]["theme"] == "price_change"
    assert "b" not in rows and "c" not in rows
    assert rows["d"]["company_id"] == 6 and rows["d"]["theme"] == "results"
    assert "e" not in rows  # lower-case "itc" is not ITC, and no theme matches


def test_gkg_slots_catch_up_and_resume():
    now = datetime(2026, 11, 10, 6, 40, tzinfo=timezone.utc)
    first = news.gkg_slots(None, now)
    assert first[0] == datetime(2026, 11, 10, 0, 30, tzinfo=timezone.utc) and len(first) == news.GKG_FILES_PER_RUN
    resume = news.gkg_slots("20261110054500", now)
    assert resume == [datetime(2026, 11, 10, 6, 0, tzinfo=timezone.utc), datetime(2026, 11, 10, 6, 15, tzinfo=timezone.utc)]
    assert news.gkg_slots("20261110061500", now) == []


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


def test_same_story_on_two_sites_is_stored_once(conn):
    from app.services.db import get_conn

    row = {"title": "Gold edges lower as focus shifts to US inflation data", "publisher": "Mint",
           "published_at": datetime.now(timezone.utc), "theme": "rates"}
    with get_conn() as c:
        assert news._store_news(c, [{**row, "url": "https://www.livemint.com/a"}], source="gdelt") == 1
        assert news._store_news(c, [{**row, "url": "https://www.moneycontrol.com/b", "publisher": "Moneycontrol"}],
                                source="gdelt") == 0


def test_macro_waits_for_fred_key(conn, client, monkeypatch):
    monkeypatch.delenv("FRED_API_KEY", raising=False)
    get_settings.cache_clear()
    series = {s["key"]: s for s in client.get("/api/macro").json()}
    assert series["usd_inr"]["status"] == "coming_soon"
    assert series["brent"]["status"] == "unavailable"  # nothing fetched yet


def test_failed_job_answers_502(client, monkeypatch):
    monkeypatch.setenv("CRON_SECRET", "s3cret")
    get_settings.cache_clear()
    monkeypatch.setattr(news, "run_rbi", lambda _f: {"added": 0, "error": "boom"})
    res = client.get("/api/cron/rbi", headers={"Authorization": "Bearer s3cret"})
    assert res.status_code == 502 and res.json()["error"] == "boom"
    get_settings.cache_clear()


def test_cron_app_does_not_load_the_main_app():
    import subprocess
    import sys

    code = "import sys, app.cron_app; print('app.main' in sys.modules, 'yfinance' in sys.modules)"
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True).stdout.split()
    assert out == ["False", "False"]


def test_cron_refuses_without_secret(client, monkeypatch):
    monkeypatch.delenv("CRON_SECRET", raising=False)
    get_settings.cache_clear()
    assert client.get("/api/cron/rbi").status_code == 503
    monkeypatch.setenv("CRON_SECRET", "s3cret")
    get_settings.cache_clear()
    assert client.get("/api/cron/rbi").status_code == 401
    assert client.get("/api/cron/rbi", headers={"Authorization": "Bearer wrong"}).status_code == 401
    get_settings.cache_clear()

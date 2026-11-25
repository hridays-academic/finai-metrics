"""Phase 7 (RW1, RW11): Research lists the league and practice companies."""
from tests.test_practice import admin_env, scored  # noqa: F401 -- fixtures


def test_league_companies_for_research(client, scored):  # noqa: F811
    rows = client.get("/api/league/companies").json()
    assert rows == [{"id": scored["company"], "name": "Demo Cement (fictional)", "ticker": "DEMOCEM",
                     "symbol": "DEMOCEM.NS", "sector": "cement", "sector_name": rows[0]["sector_name"]}]
    assert rows[0]["sector_name"]


def test_plain_names_map_the_pilot_companies():
    from app.services.yfinance_provider import _NAME_TO_SYMBOL
    for name, symbol in (("dabur", "DABUR.NS"), ("marico", "MARICO.NS"), ("escorts kubota", "ESCORTS.NS"),
                         ("jyothy labs", "JYOTHYLAB.NS"), ("mphasis", "MPHASIS.NS"), ("sagar cements", "SAGCEM.NS"),
                         ("maruti", "MARUTI.NS")):
        assert _NAME_TO_SYMBOL[name] == symbol

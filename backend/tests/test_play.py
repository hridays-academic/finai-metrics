"""Quick rounds (phase 5): cards never carry the answer; reveal scores like the league."""
import pytest

from app.league_config import market_config
from app.services import scoring
from tests.test_practice import admin_env, scored  # noqa: F401 -- fixtures


@pytest.fixture
def ready(client, scored):  # noqa: F811
    client.post(f"/api/admin/events/{scored['event']}/score", headers=scored["admin"])
    return scored


def test_cards_hold_no_answer(client, ready):
    cards = client.get("/api/play/cards").json()
    assert [c["metric_key"] for c in cards] == ["revenue_growth_yoy", "operating_margin", "sector_kpi"]
    assert all("actual" not in c for c in cards)
    first = cards[0]
    assert first["name"] is None and first["quarter"] is None  # Mystery mode by default
    assert first["last_year"] == 10.0
    named = client.get("/api/play/cards?mystery=false").json()[0]
    assert named["name"] == "Demo Cement (fictional)" and named["quarter"] == "Q2 FY27"


def test_reveal_scores_like_the_league(client, ready):
    card = client.get("/api/play/cards").json()[1]  # margin: actual 14, last year 15
    res = client.post(f"/api/play/cards/{card['id']}/reveal", json={"low": 13.0, "high": 15.0}).json()
    expected = scoring.score_metric("operating_margin", 13.0, 15.0, 14.0, 15.0, market_config("IN").scoring)
    assert res["actual"] == 14.0 and res["hit"] is True and res["points"] == expected.points
    miss = client.post(f"/api/play/cards/{card['id']}/reveal", json={"low": 15.5, "high": 16.0}).json()
    assert miss["hit"] is False and miss["missed_by"] == pytest.approx(1.5)


def test_unknown_or_out_of_bounds(client, ready):
    assert client.post("/api/play/cards/zzzzzz-0/reveal", json={"low": 1, "high": 2}).status_code == 404
    card = client.get("/api/play/cards").json()[0]
    assert client.post(f"/api/play/cards/{card['id']}/reveal", json={"low": -500, "high": 2}).status_code == 422

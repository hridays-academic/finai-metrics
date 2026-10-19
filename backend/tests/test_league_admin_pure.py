"""Pure helpers in league_admin -- no database."""
import pytest

from app.services.league_admin import year_ago_label
from app.services.league_service import LeagueError


def test_year_ago_label():
    assert year_ago_label("FY27") == "FY26"
    assert year_ago_label("fy10") == "FY09"
    assert year_ago_label("FY2027") == "FY2026"


def test_year_ago_label_rejects_garbage():
    with pytest.raises(LeagueError):
        year_ago_label("next year")

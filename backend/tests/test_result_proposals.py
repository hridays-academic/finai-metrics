"""
Proposed results (services/result_proposals.py): the committed files must
load, use real definitions within bounds, and only match an event whose
metrics they cover exactly. No database.
"""
import json

import pytest

from app.league_config import all_definitions, market_config
from app.services import result_proposals

DEFS = all_definitions(market_config("IN"))
CEMENT = [
    {"key": "revenue_growth_yoy", "definition_key": "in.revenue_growth_yoy.v1"},
    {"key": "operating_margin", "definition_key": "in.operating_margin.v1"},
    {"key": "sector_kpi", "definition_key": "in.cement.volume_growth_yoy.v1"},
]


def _metric(key, definition_key, value=5.0):
    return {"metric_key": key, "definition_key": definition_key, "value": value,
            "source_url": "https://example.com/results.pdf", "page": "PDF p1", "working": "1 / 1 - 1"}


def _file(ticker="DEMOCEM", metrics=None, **overrides):
    body = {"fiscal_year_label": "FY27", "fiscal_quarter": 2, "prepared_on": "2026-11-12", "prepared_by": "test",
            "events": [{"ticker": ticker, "company": "Demo",
                        "metrics": metrics or [_metric(m["key"], m["definition_key"]) for m in CEMENT]}]}
    body.update(overrides)
    return body


def test_committed_files_load_and_every_value_is_valid():
    proposals = result_proposals.load_dir(result_proposals.PROPOSALS_DIR)
    files = sorted(result_proposals.PROPOSALS_DIR.glob("*.json"))
    assert files, "no proposal files committed"
    raw_events = sum(len(json.loads(f.read_text())["events"]) for f in files)
    assert len(proposals) == raw_events  # nothing skipped as malformed or duplicate
    for proposal in proposals.values():
        keys = [m.metric_key for m in proposal.event.metrics]
        assert len(keys) == len(set(keys))
        for m in proposal.event.metrics:
            d = DEFS[m.definition_key]
            assert d.key == m.metric_key
            assert d.min_value <= m.value <= d.max_value
            assert m.flag is None or m.flag.strip()


def test_pilot_quarter_has_the_approved_decisions():
    p = result_proposals.load_dir(result_proposals.PROPOSALS_DIR)
    tickers = {k[0] for k in p if k[1:] == ("FY27", 2)}
    assert tickers == {"MARUTI", "SAGCEM", "MARICO", "ESCORTS", "DABUR", "JYOTHYLAB", "MPHASIS"}

    def value(ticker, key):
        return next(m.value for m in p[(ticker, "FY27", 2)].event.metrics if m.metric_key == key)

    # Decided by Hriday on 12 Nov 2026 (vault: Pilot results (for approval).md).
    assert value("MARICO", "revenue_growth_yoy") == 13.0
    assert value("DABUR", "sector_kpi") == 5.5
    assert value("JYOTHYLAB", "sector_kpi") == 8.1
    assert value("MPHASIS", "sector_kpi") == 9.7


def test_malformed_file_is_skipped_not_fatal(tmp_path):
    (tmp_path / "bad.json").write_text("{not json")
    bad_url = _file(ticker="BADURL", metrics=[_metric("revenue_growth_yoy", "in.revenue_growth_yoy.v1")])
    bad_url["events"][0]["metrics"][0]["source_url"] = "http://insecure.example.com/x.pdf"
    (tmp_path / "bad_url.json").write_text(json.dumps(bad_url))
    (tmp_path / "good.json").write_text(json.dumps(_file()))
    assert list(result_proposals.load_dir(tmp_path)) == [("DEMOCEM", "FY27", 2)]


def test_missing_folder_gives_no_proposals(tmp_path):
    assert result_proposals.load_dir(tmp_path / "nope") == {}


def test_duplicate_event_keeps_the_first_file(tmp_path):
    (tmp_path / "a.json").write_text(json.dumps(_file()))
    (tmp_path / "b.json").write_text(json.dumps(_file()))
    assert result_proposals.load_dir(tmp_path)[("DEMOCEM", "FY27", 2)].file == "a.json"


@pytest.mark.parametrize("ticker,fy,q,metrics,found", [
    ("democem", "fy27", 2, CEMENT, True),  # case-insensitive ticker and label
    ("DEMOCEM", "FY27", 3, CEMENT, False),  # other quarter
    ("OTHER", "FY27", 2, CEMENT, False),
    ("DEMOCEM", "FY27", 2, CEMENT[:2], False),  # event without a KPI
    ("DEMOCEM", "FY27", 2, CEMENT[:2] + [{"key": "sector_kpi", "definition_key": "in.it.cc_revenue_growth_yoy.v1"}],
     False),  # different definition
])
def test_find_needs_an_exact_metric_match(tmp_path, ticker, fy, q, metrics, found):
    (tmp_path / "q.json").write_text(json.dumps(_file()))
    proposals = result_proposals.load_dir(tmp_path)
    assert (result_proposals.find(ticker, fy, q, metrics, proposals) is not None) is found

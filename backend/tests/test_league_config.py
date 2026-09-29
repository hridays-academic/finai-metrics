"""Consistency checks on league_config.py -- no database."""
from app.league_config import MARKETS, OPERATING_MARGIN, REVENUE_GROWTH, SECTOR_KPI, all_definitions


def test_every_market_has_both_core_metrics():
    for cfg in MARKETS.values():
        assert {m.key for m in cfg.core_metrics} == {REVENUE_GROWTH, OPERATING_MARGIN}


def test_definition_keys_unique_and_market_prefixed():
    for code, cfg in MARKETS.items():
        keys = [m.definition_key for m in cfg.core_metrics] + [
            t.metric.definition_key for t in cfg.kpi_templates.values()
        ]
        assert len(keys) == len(set(keys))
        assert all(k.startswith(code.lower() + ".") for k in keys)
        assert len(all_definitions(cfg)) == len(keys)


def test_kpi_templates_are_sector_kpis_with_sane_bounds():
    for cfg in MARKETS.values():
        for sector, tmpl in cfg.kpi_templates.items():
            assert tmpl.sector == sector
            assert tmpl.metric.key == SECTOR_KPI
            assert sector not in cfg.excluded_sectors
            assert tmpl.metric.min_value < 0 < tmpl.metric.max_value


def test_reason_tags_unique():
    for cfg in MARKETS.values():
        keys = [t.key for t in cfg.reason_tags]
        assert len(keys) == len(set(keys))

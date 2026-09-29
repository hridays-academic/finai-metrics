"""Pure scoring tests -- no database. See app/services/scoring.py."""
import pytest

from app.services.scoring import (
    ScoringConfig,
    calibration,
    event_score,
    explain_metric_score,
    interval_score,
    leaderboard_eligible,
    score_metric,
    season_score,
)

CFG = ScoringConfig()


class TestIntervalScore:
    def test_hit_costs_only_the_width(self):
        assert interval_score(5.0, 9.0, 7.0, 0.2) == pytest.approx(4.0)

    def test_hit_on_either_boundary_is_inside(self):
        assert interval_score(5.0, 9.0, 5.0, 0.2) == pytest.approx(4.0)
        assert interval_score(5.0, 9.0, 9.0, 0.2) == pytest.approx(4.0)

    def test_miss_low_adds_ten_times_the_distance(self):
        # 2/alpha = 10 at alpha 0.2: width 4 + 10 * (5 - 3)
        assert interval_score(5.0, 9.0, 3.0, 0.2) == pytest.approx(24.0)

    def test_miss_high_adds_ten_times_the_distance(self):
        assert interval_score(5.0, 9.0, 10.5, 0.2) == pytest.approx(4.0 + 10 * 1.5)

    def test_zero_width_hit_scores_zero(self):
        assert interval_score(6.0, 6.0, 6.0, 0.2) == 0.0

    def test_zero_width_miss_is_pure_distance_penalty(self):
        assert interval_score(6.0, 6.0, 7.0, 0.2) == pytest.approx(10.0)

    def test_negative_values_work(self):
        # margins and growth can be negative
        assert interval_score(-4.0, -1.0, -6.0, 0.2) == pytest.approx(3.0 + 10 * 2.0)

    def test_inverted_range_rejected(self):
        with pytest.raises(ValueError):
            interval_score(9.0, 5.0, 7.0, 0.2)

    @pytest.mark.parametrize("alpha", [0.0, 1.0, -0.1])
    def test_bad_alpha_rejected(self, alpha):
        with pytest.raises(ValueError):
            interval_score(1.0, 2.0, 1.5, alpha)


class TestScoreMetric:
    def test_hit(self):
        s = score_metric("operating_margin", 18.0, 22.0, 20.5, lazy_value=None, config=CFG)
        assert s.hit is True
        assert s.interval_score == pytest.approx(4.0)
        assert s.points == pytest.approx(100 - 2 * 4.0)
        assert s.abs_error_mid == pytest.approx(0.5)

    def test_miss_low(self):
        s = score_metric("revenue_growth_yoy", 8.0, 12.0, 6.0, lazy_value=None, config=CFG)
        assert s.hit is False
        assert s.interval_score == pytest.approx(24.0)
        assert s.points == pytest.approx(100 - 48.0)

    def test_miss_high(self):
        s = score_metric("revenue_growth_yoy", 8.0, 12.0, 13.0, lazy_value=None, config=CFG)
        assert s.hit is False
        assert s.interval_score == pytest.approx(14.0)
        assert s.points == pytest.approx(72.0)

    def test_points_floor_at_zero(self):
        s = score_metric("revenue_growth_yoy", 0.0, 1.0, 40.0, lazy_value=None, config=CFG)
        assert s.points == 0.0

    def test_zero_width_exact_hit_scores_full_points(self):
        s = score_metric("operating_margin", 20.0, 20.0, 20.0, lazy_value=None, config=CFG)
        assert s.hit is True and s.points == pytest.approx(100.0)

    def test_null_lazy_skips_beat_lazy_and_bonus(self):
        s = score_metric("operating_margin", 18.0, 22.0, 20.0, lazy_value=None, config=CFG)
        assert s.beat_lazy is None
        assert s.points == pytest.approx(92.0)

    def test_beating_lazy_adds_bonus(self):
        # midpoint 20 vs actual 20.5 (error 0.5) beats lazy 18 (error 2.5)
        s = score_metric("operating_margin", 18.0, 22.0, 20.5, lazy_value=18.0, config=CFG)
        assert s.beat_lazy is True
        assert s.points == pytest.approx(92.0 + 10.0)

    def test_bonus_applies_on_top_of_a_zero_floor(self):
        # a badly missed range can still have the closer midpoint
        s = score_metric("revenue_growth_yoy", 30.0, 30.0, 40.0, lazy_value=0.0, config=CFG)
        assert s.beat_lazy is True
        assert s.points == pytest.approx(0.0 + 10.0)

    def test_losing_to_lazy_no_bonus(self):
        s = score_metric("operating_margin", 18.0, 22.0, 20.5, lazy_value=20.4, config=CFG)
        assert s.beat_lazy is False
        assert s.points == pytest.approx(92.0)

    def test_tie_with_lazy_is_not_a_beat(self):
        # midpoint 20 and lazy 22 are both exactly 1.0 from the actual 21
        s = score_metric("operating_margin", 18.0, 22.0, 21.0, lazy_value=22.0, config=CFG)
        assert s.beat_lazy is False

    def test_k_is_configurable_per_metric(self):
        cfg = ScoringConfig(k_by_metric={"sector_kpi": 1.0})
        kpi = score_metric("sector_kpi", 0.0, 10.0, 5.0, lazy_value=None, config=cfg)
        margin = score_metric("operating_margin", 0.0, 10.0, 5.0, lazy_value=None, config=cfg)
        assert kpi.points == pytest.approx(90.0)
        assert margin.points == pytest.approx(80.0)


class TestAggregates:
    def test_event_score_is_mean_of_metric_points(self):
        a = score_metric("revenue_growth_yoy", 8.0, 12.0, 10.0, None, CFG)  # 92
        b = score_metric("operating_margin", 18.0, 22.0, 17.0, None, CFG)  # 100 - 2*14 = 72
        assert event_score([a, b]) == pytest.approx(82.0)

    def test_event_score_needs_metrics(self):
        with pytest.raises(ValueError):
            event_score([])

    def test_season_score(self):
        assert season_score([80.0, 60.0, 70.0]) == pytest.approx(70.0)
        assert season_score([]) is None


class TestThresholds:
    @pytest.mark.parametrize("events,eligible", [(0, False), (2, False), (3, True), (10, True)])
    def test_leaderboard_needs_three_scored_events(self, events, eligible):
        assert leaderboard_eligible(events, CFG) is eligible

    def test_calibration_withheld_below_ten_metrics(self):
        assert calibration(hits=8, scored_metrics=9, config=CFG) is None

    def test_calibration_shown_at_ten_metrics(self):
        assert calibration(hits=8, scored_metrics=10, config=CFG) == pytest.approx(0.8)

    def test_calibration_rejects_impossible_counts(self):
        with pytest.raises(ValueError):
            calibration(hits=11, scored_metrics=10, config=CFG)


class TestExplanations:
    def test_hit_sentence(self):
        s = score_metric("operating_margin", 18.0, 22.0, 20.5, 18.0, CFG)
        text = explain_metric_score(s, 18.0, 22.0, 20.5, "%", CFG)
        assert "inside your range" in text and "bonus" in text and "102.0" in text

    def test_miss_sentence_names_direction_and_distance(self):
        s = score_metric("revenue_growth_yoy", 8.0, 12.0, 6.0, None, CFG)
        text = explain_metric_score(s, 8.0, 12.0, 6.0, "%", CFG)
        assert "2.0 points below your range" in text
        assert "no lazy forecast" in text

    def test_explanations_never_mention_stock_or_trading(self):
        s = score_metric("revenue_growth_yoy", 8.0, 12.0, 13.0, 9.0, CFG)
        text = explain_metric_score(s, 8.0, 12.0, 13.0, "%", CFG).lower()
        for banned in ("buy", "sell", "hold", "price target", "stock"):
            assert banned not in text

"""
Results League scoring. Pure functions only: no database, no network, no
clock. Everything the league shows about a score -- points, hit/miss,
beat-lazy, calibration, leaderboard eligibility -- comes from here, so it
can be unit-tested exhaustively (tests/test_scoring.py).

The core is the interval score for a central (1 - alpha) prediction
interval [low, high] and actual value y (Gneiting & Raftery, 2007):

    IS = (high - low)                           if low <= y <= high
    IS = (high - low) + (2 / alpha) * (low - y)  if y < low
    IS = (high - low) + (2 / alpha) * (y - high) if y > high

Lower is better. It's a proper scoring rule: a forecaster minimises their
expected score by reporting their honest 80% range, so neither sandbagging
with wide ranges nor bravado with narrow ones pays off.
"""
from dataclasses import dataclass, field
from statistics import mean
from typing import Mapping, Optional, Sequence


@dataclass(frozen=True)
class ScoringConfig:
    alpha: float = 0.2  # 80% ranges
    default_k: float = 2.0  # points lost per unit of interval score
    k_by_metric: Mapping[str, float] = field(default_factory=dict)
    beat_lazy_bonus: float = 10.0
    min_scored_events_for_leaderboard: int = 3
    min_scored_metrics_for_calibration: int = 10

    def k_for(self, metric_key: str) -> float:
        return self.k_by_metric.get(metric_key, self.default_k)


@dataclass(frozen=True)
class MetricScore:
    metric_key: str
    interval_score: float
    points: float  # 0..100 before the bonus, so up to 100 + beat_lazy_bonus
    hit: bool
    beat_lazy: Optional[bool]  # None when there was no lazy baseline
    abs_error_mid: float


def interval_score(low: float, high: float, actual: float, alpha: float) -> float:
    if low > high:
        raise ValueError(f"low ({low}) must not exceed high ({high})")
    if not 0 < alpha < 1:
        raise ValueError(f"alpha must be between 0 and 1, got {alpha}")
    width = high - low
    if actual < low:
        return width + (2 / alpha) * (low - actual)
    if actual > high:
        return width + (2 / alpha) * (actual - high)
    return width


def score_metric(
    metric_key: str,
    low: float,
    high: float,
    actual: float,
    lazy_value: Optional[float],
    config: ScoringConfig,
) -> MetricScore:
    score = interval_score(low, high, actual, config.alpha)
    midpoint = (low + high) / 2
    abs_error_mid = abs(midpoint - actual)
    beat_lazy = None if lazy_value is None else abs_error_mid < abs(lazy_value - actual)
    points = max(0.0, 100.0 - config.k_for(metric_key) * score)
    if beat_lazy:
        points += config.beat_lazy_bonus
    return MetricScore(
        metric_key=metric_key,
        interval_score=score,
        points=points,
        hit=low <= actual <= high,
        beat_lazy=beat_lazy,
        abs_error_mid=abs_error_mid,
    )


def event_score(metric_scores: Sequence[MetricScore]) -> float:
    """Average of one forecast's metric points."""
    if not metric_scores:
        raise ValueError("an event score needs at least one scored metric")
    return mean(m.points for m in metric_scores)


def season_score(event_scores: Sequence[float]) -> Optional[float]:
    """Average of a user's event scores; None before any event is scored."""
    return mean(event_scores) if event_scores else None


def leaderboard_eligible(scored_events: int, config: ScoringConfig) -> bool:
    return scored_events >= config.min_scored_events_for_leaderboard


def calibration(hits: int, scored_metrics: int, config: ScoringConfig) -> Optional[float]:
    """Share of 80% ranges that contained the answer, or None while there are
    too few scored metrics for the number to mean anything (the UI then says
    "not enough forecasts yet")."""
    if hits < 0 or hits > scored_metrics:
        raise ValueError(f"hits ({hits}) must be between 0 and scored_metrics ({scored_metrics})")
    if scored_metrics < config.min_scored_metrics_for_calibration:
        return None
    return hits / scored_metrics


def _fmt(value: float) -> str:
    return f"{value:.1f}".replace("-0.0", "0.0")


def explain_metric_score(score: MetricScore, low: float, high: float, actual: float,
                         unit: str, config: ScoringConfig) -> str:
    """One plain-English sentence explaining a metric's points, for beginners."""
    width = high - low
    u = unit
    if score.hit:
        base = (
            f"The actual ({_fmt(actual)}{u}) landed inside your range, so you only lost points "
            f"for its width ({_fmt(width)} points wide)"
        )
    else:
        side = "below" if actual < low else "above"
        miss = low - actual if actual < low else actual - high
        base = (
            f"The actual ({_fmt(actual)}{u}) was {_fmt(miss)} points {side} your range; misses cost "
            f"{_fmt(2 / config.alpha)}x the distance on top of the range's width"
        )
    if score.beat_lazy is True:
        tail = f", and your midpoint beat the lazy forecast, earning a {_fmt(config.beat_lazy_bonus)}-point bonus."
    elif score.beat_lazy is False:
        tail = ", and your midpoint did not beat the lazy forecast."
    else:
        tail = "; there was no lazy forecast to compare against."
    return f"{base}{tail} Score: {_fmt(score.points)}."

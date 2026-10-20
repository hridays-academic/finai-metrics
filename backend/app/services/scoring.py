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
from decimal import ROUND_HALF_UP, Decimal
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


def _n(value: float) -> str:
    """1 decimal, rounding half up like the frontend's toFixed, dropping a
    trailing .0: 4 -> "4", 7.25 -> "7.3" (Python's own formatting would give
    "7.2" and disagree with the number line's label)."""
    text = str(Decimal(repr(value)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))
    text = "0.0" if text == "-0.0" else text
    return text[:-2] if text.endswith(".0") else text


def _pts(value: float) -> str:
    """'1 point', '4 points' -- the number as _n shows it, correctly pluralised."""
    text = _n(value)
    return f"{text} point" if text == "1" else f"{text} points"


def _dist(value: float, unit: str) -> str:
    """A width or a miss, in the metric's own unit: '%' -> percentage points.
    'points' alone always means score, never a distance."""
    text = _n(value)
    if unit == "%":
        return f"{text} percentage point" if text == "1" else f"{text} percentage points"
    return f"{text} {unit}"


def _per_unit(unit: str) -> str:
    return "percentage point" if unit == "%" else unit


_LAZY_MEANING = {
    "revenue_growth_yoy": "The lazy guess assumes revenue grows exactly as fast as it did in the same quarter last year",
    "operating_margin": "The lazy guess assumes the margin stays where it was in the same quarter last year",
}


def explain_metric(score: MetricScore, label: str, low: float, high: float, actual: float,
                   lazy_value: Optional[float], unit: str, config: ScoringConfig,
                   crowd_median: Optional[float] = None, forecasters: int = 0) -> list[str]:
    """Plain-English sentences, one per number on a metric's result, for
    complete beginners. Mirrors score_metric's arithmetic exactly."""
    u = unit
    k = config.k_for(score.metric_key)
    width = high - low
    width_cost = k * width
    base = max(0.0, 100.0 - k * score.interval_score)
    if score.hit:
        points_line = (
            f"Your range was {_dist(width, u)} wide and the result ({_n(actual)}{u}) landed inside it, "
            f"so you lost {_pts(width_cost)} for width: 100 - {_n(width_cost)} = {_n(base)}."
        )
    else:
        side = "below" if actual < low else "above"
        miss = low - actual if actual < low else actual - high
        per_point = k * 2 / config.alpha
        total = width_cost + per_point * miss
        ending = f"100 - {_n(total)} = {_n(100 - total)}."
        if total > 100:
            ending += " Scores can't go below 0, so this counts as 0."
        points_line = (
            f"The result ({_n(actual)}{u}) landed {_dist(miss, u)} {side} your range, so on top of "
            f"{_pts(width_cost)} for your range's width you lost {_pts(per_point * miss)} for the miss "
            f"({_n(per_point)} for each {_per_unit(u)} you missed by): {ending}"
        )
    midpoint = (low + high) / 2
    bonus = config.beat_lazy_bonus
    if score.beat_lazy is True:
        bonus_line = (
            f"Your midpoint ({_n(midpoint)}{u}) was closer to the result than the lazy guess ({_n(lazy_value)}{u}), "
            f"so you earned the +{_n(bonus)} bonus: {_n(base)} + {_n(bonus)} = {_n(score.points)}."
        )
    elif score.beat_lazy is False:
        bonus_line = (
            f"The lazy guess ({_n(lazy_value)}{u}) was at least as close to the result as your midpoint "
            f"({_n(midpoint)}{u}), so no bonus this time."
        )
    else:
        bonus_line = "There was no lazy guess for this number (last year's figure wasn't available), so no bonus was possible."
    lines = [points_line, bonus_line]
    if lazy_value is not None:
        meaning = _LAZY_MEANING.get(
            score.metric_key, f"The lazy guess assumes {label[0].lower() + label[1:]} repeats the same quarter last year")
        lines.append(f"{meaning} ({_n(lazy_value)}{u}).")
    if crowd_median is not None:
        lines.append(f"The crowd median, the middle of all {forecasters} forecasters' midpoints, was {_n(crowd_median)}{u}.")
    return lines


def explain_event_score(points: Sequence[float]) -> str:
    total = " + ".join(_n(p) for p in points)
    return f"Your event score is the average of your {len(points)} scores: ({total}) / {len(points)} = {_n(mean(points))}."


def explain_crowd(forecasters: int, shown: bool, minimum: int) -> str:
    if shown:
        return f"{forecasters} people forecast this company. The crowd median is the middle of their midpoints."
    did = "1 did" if forecasters == 1 else f"{forecasters} did"
    return f"The crowd median appears once at least {minimum} people forecast a company; {did} here."

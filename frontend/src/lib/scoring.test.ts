import { describe, expect, it } from "vitest";
import { explain, micro, n, scoreMetric } from "./scoring";

// Generated 2026-11-18 from backend/app/services/scoring.py (score_metric and
// explain_metric's first two lines), so the guide says exactly what a real
// results page would.
const PYTHON: { low: number; high: number; actual: number; lazy: number | null; points: number; lines: string[] }[] =
[
  {
    "low": 10,
    "high": 14,
    "actual": 12,
    "lazy": 9,
    "points": 102.0,
    "lines": [
      "Your range was 4 percentage points wide and the result (12%) landed inside it, so you lost 8 points for width: 100 - 8 = 92.",
      "Your midpoint (12%) was closer to the result than the lazy guess (9%), so you earned the +10 bonus: 92 + 10 = 102."
    ]
  },
  {
    "low": 10,
    "high": 14,
    "actual": 17,
    "lazy": 9,
    "points": 42.0,
    "lines": [
      "The result (17%) landed 3 percentage points above your range, so on top of 8 points for your range's width you lost 60 points for the miss (20 for each percentage point you missed by): 100 - 68 = 32.",
      "Your midpoint (12%) was closer to the result than the lazy guess (9%), so you earned the +10 bonus: 32 + 10 = 42."
    ]
  },
  {
    "low": 2,
    "high": 8,
    "actual": 12,
    "lazy": 9,
    "points": 8.0,
    "lines": [
      "The result (12%) landed 4 percentage points above your range, so on top of 12 points for your range's width you lost 80 points for the miss (20 for each percentage point you missed by): 100 - 92 = 8.",
      "The lazy guess (9%) was at least as close to the result as your midpoint (5%), so no bonus this time."
    ]
  },
  {
    "low": 11,
    "high": 13,
    "actual": 12,
    "lazy": 12,
    "points": 96.0,
    "lines": [
      "Your range was 2 percentage points wide and the result (12%) landed inside it, so you lost 4 points for width: 100 - 4 = 96.",
      "The lazy guess (12%) was at least as close to the result as your midpoint (12%), so no bonus this time."
    ]
  },
  {
    "low": 0,
    "high": 60,
    "actual": 12,
    "lazy": 9,
    "points": 0.0,
    "lines": [
      "Your range was 60 percentage points wide and the result (12%) landed inside it, so you lost 120 points for width: 100 - 120 = -20. Scores can't go below 0, so this counts as 0.",
      "The lazy guess (9%) was at least as close to the result as your midpoint (30%), so no bonus this time."
    ]
  },
  {
    "low": 7.25,
    "high": 9.5,
    "actual": 7,
    "lazy": null,
    "points": 90.5,
    "lines": [
      "The result (7%) landed 0.3 percentage points below your range, so on top of 4.5 points for your range's width you lost 5 points for the miss (20 for each percentage point you missed by): 100 - 9.5 = 90.5.",
      "There was no lazy guess for this number (last year's figure wasn't available), so no bonus was possible."
    ]
  },
  {
    "low": 10,
    "high": 14,
    "actual": 9,
    "lazy": 9,
    "points": 72.0,
    "lines": [
      "The result (9%) landed 1 percentage point below your range, so on top of 8 points for your range's width you lost 20 points for the miss (20 for each percentage point you missed by): 100 - 28 = 72.",
      "The lazy guess (9%) was at least as close to the result as your midpoint (12%), so no bonus this time."
    ]
  }
];

describe("the guide's scoring mirror", () => {
  it.each(PYTHON)("matches Python for $low to $high, result $actual, lazy $lazy", (c) => {
    expect(scoreMetric(c.low, c.high, c.actual, c.lazy).points).toBeCloseTo(c.points, 9);
    expect(explain(c.low, c.high, c.actual, c.lazy)).toEqual(c.lines);
  });

  it("rounds like Python's _n", () => {
    expect([n(4), n(7.25), n(0.15), n(-7.25), n(-0.04), n(102)]).toEqual(["4", "7.3", "0.2", "-7.3", "0", "102"]);
  });

  // Decimal ties that raw floats got wrong (2026-11-24): equal in decimals,
  // but the midpoint's distance came out a hair smaller as a float.
  it.each([
    { low: 36.9, high: 40.9, actual: 26, lazy: 13.1 }, // midpoint 38.9: both 12.9 from 26
    { low: 4.6, high: 8.6, actual: 5, lazy: 3.4 }, // midpoint 6.6: both 1.6 from 5
    { low: 6.1, high: 10.1, actual: 5, lazy: 1.9 }, // midpoint 8.1: both 3.1 from 5
  ])("a decimal tie ($low to $high, result $actual, lazy $lazy) earns no bonus", (c) => {
    const mid = (c.low + c.high) / 2;
    expect(Math.abs(mid - c.actual)).toBeLessThan(Math.abs(c.lazy - c.actual)); // the float trap is real
    const s = scoreMetric(c.low, c.high, c.actual, c.lazy);
    expect(s.beatLazy).toBe(false);
    expect(s.points).toBe(scoreMetric(c.low, c.high, c.actual, null).points);
    expect(explain(c.low, c.high, c.actual, c.lazy)[1]).toContain("at least as close");
  });

  it("still gives the bonus when closer by a millionth", () => {
    expect(scoreMetric(18, 22, 21, 22.000002).beatLazy).toBe(true);
    expect(micro(12.899999999999999)).toBe(micro(12.9));
  });
});

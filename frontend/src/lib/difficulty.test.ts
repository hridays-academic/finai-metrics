import { describe, expect, it } from "vitest";
import { colourClass, difficultyOf, marginRange, revenueSwing, type DifficultyRow } from "./difficulty";

// Quarter ends a quarter apart, with a revenue and a margin for each.
function rows(revenue: (number | null)[], margin: (number | null)[]): DifficultyRow[] {
  const ends = ["2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"];
  return revenue.map((r, i) => ({ period_end_date: ends[i], revenue: r, margin: margin[i] }));
}

describe("difficulty", () => {
  it("measures the margin's range and the swing in quarter-to-quarter revenue change", () => {
    const r = rows([100, 110, 99, 99, 104], [10, 12, 11, 9, 10]);
    expect(marginRange(r)).toBeCloseTo(3);
    // changes: +10%, -10%, 0%, about +5.1%: swing 20 points
    expect(revenueSwing(r)).toBeCloseTo(20);
  });

  it("skips pairs that aren't back-to-back quarters", () => {
    const gap: DifficultyRow[] = [
      { period_end_date: "2025-03-31", revenue: 100, margin: 10 },
      { period_end_date: "2025-09-30", revenue: 200, margin: 10 },
      { period_end_date: "2025-12-31", revenue: 210, margin: 10 },
    ];
    expect(revenueSwing(gap)).toBeNull(); // only one back-to-back pair
  });

  it("takes the harder of the two bands, like the pilot companies", () => {
    // Mphasis-like: steady margin, steady growth -> easy
    expect(difficultyOf(rows([100, 106, 109.5, 114.4, 120], [15, 15.3, 15.1, 15.6, 15.2]))).toBe("easy");
    // Maruti-like: margin moved 3.7 points, revenue swing about 14 -> medium
    expect(difficultyOf(rows([100, 114.1, 123.8, 124.2, 126], [12, 11, 9.5, 8.3, 9]))).toBe("medium");
    // Jyothy-like: steady revenue but the margin moved 13.7 points -> hard
    expect(difficultyOf(rows([100, 100.5, 97.2, 105, 103.3], [15, 16, 9, 2.3, 10]))).toBe("hard");
  });

  it("returns null with too little data, which colours the company graphite", () => {
    expect(difficultyOf(rows([100, null, null, null, null], [10, null, null, null, null]))).toBeNull();
    expect(colourClass(null)).toBe("sector-neutral");
    expect(colourClass("medium")).toBe("difficulty-medium");
  });
});

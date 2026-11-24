import { describe, expect, it } from "vitest";
import { lastYearValues, latestLeague, leagueSeries, scaleAround, yearAgoEnd } from "./leagueFormat";

const actuals = [
  { period_end_date: "2025-09-30", metric_key: "operating_margin", value: 16.1 },
  { period_end_date: "2025-09-30", metric_key: "revenue_growth_yoy", value: 0.4 },
  { period_end_date: "2026-06-30", metric_key: "operating_margin", value: 14.0 },
];

describe("league figures (T2, T10)", () => {
  it("centres the scale on last year: +-8 for the margin, +-10 for growth", () => {
    expect(scaleAround("operating_margin", 16)).toEqual([8, 24]);
    expect(scaleAround("revenue_growth_yoy", 5)).toEqual([-5, 15]);
    expect(scaleAround("sector_kpi", null)).toBeUndefined();
  });

  it("finds last year's figure for each metric", () => {
    expect(yearAgoEnd("2026-09-30")).toBe("2025-09-30");
    expect(lastYearValues(actuals, "2026-09-30", ["operating_margin", "sector_kpi"])).toEqual({
      operating_margin: 16.1,
      sector_kpi: null,
    });
  });

  it("uses league actuals only for series and the latest figure", () => {
    expect(leagueSeries(actuals, "operating_margin", ["2025-09-30", "2025-12-31", "2026-06-30"])).toEqual([16.1, null, 14.0]);
    expect(latestLeague(actuals, "operating_margin")).toEqual({ value: 14.0, end: "2026-06-30" });
    expect(latestLeague(actuals, "sector_kpi")).toBeNull();
  });
});

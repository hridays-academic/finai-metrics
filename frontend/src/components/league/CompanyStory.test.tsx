// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import CompanyStory, { chapterAt, poseAt, zoomAt } from "./CompanyStory";
import type { EventDetail } from "../../lib/types";

const EVENT = {
  id: 1,
  company: { id: 1, market_code: "IN", exchange: "NSE", ticker: "MARUTI", name: "Maruti Suzuki", sector: "autos", currency: "INR", provider_symbol: "MARUTI.NS", description: "A car maker." },
  fiscal_year_label: "FY27",
  fiscal_quarter: 3,
  period_end_date: "2026-12-31",
  season_label: "Q3 FY27",
  results_date: "2027-01-28",
  lock_at: "2027-01-27T18:29:00Z",
  status: "open",
  submitted: false,
  my_score: null,
  metrics: [{ key: "revenue_growth_yoy", definition_key: "x", label: "Revenue growth (YoY)", unit: "%", definition: "", min_value: -100, max_value: 200 }],
  research_notes: null,
  server_now: "2026-11-15T00:00:00Z",
} as unknown as EventDetail;

describe("story maths", () => {
  it("maps scroll progress to six chapters", () => {
    expect(chapterAt(0)).toBe(0);
    expect(chapterAt(0.25)).toBe(1);
    expect(chapterAt(0.99)).toBe(5);
    expect(chapterAt(1)).toBe(5);
  });

  it("reaches each chapter's angle at its middle, shows the back for chapter 2, and never holds still", () => {
    const mid = (i: number) => (i + 0.5) / 6;
    expect(poseAt(mid(0))).toEqual([10, -24, 0, 1]);
    expect(poseAt(mid(1))[1]).toBe(166); // back face
    expect(poseAt(mid(5))).toEqual([4, 0, 0, 1.05]);
    for (const p of [0, 0.05, 0.1, 0.5, 0.95]) {
      expect(poseAt(p + 0.01)).not.toEqual(poseAt(p));
    }
  });
});

describe("story zoom", () => {
  it("zooms in around a chapter's middle, eases out by its edges, and not at all in the last chapter", () => {
    const mid = (i: number) => (i + 0.5) / 6;
    expect(zoomAt(mid(0)).amount).toBe(1);
    expect(zoomAt(1 / 6 - 0.0001).amount).toBeCloseTo(0, 2);
    expect(zoomAt(mid(5)).amount).toBe(0);
    expect(zoomAt(mid(2)).chapter).toBe(2);
  });
});

describe("CompanyStory", () => {
  it("without pinning shows all five chapters as a list and last year's numbers", () => {
    const history = {
      provider_rows: [],
      provider_source: "",
      provider_definition: "",
      provider_as_of: null,
      actuals: [{ period_id: 1, fiscal_year_label: "FY26", fiscal_quarter: 3, period_end_date: "2025-12-31", metric_key: "revenue_growth_yoy", definition_key: "x", value: 29.2, source_url: "", entered_at: "" }],
    };
    render(
      <CompanyStory event={EVENT} explainer={undefined} history={history} sectorName="Autos" hasForecast={false} onJumpToForm={() => {}} />
    );
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(6);
    expect(screen.getAllByText("29.2%").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Make your forecast" })).toBeTruthy();
  });
});

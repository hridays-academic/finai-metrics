// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminBoardRow, LeagueMetric, ResultProposal } from "../../lib/types";

vi.mock("../../lib/api", () => {
  class ApiError extends Error {
    constructor(message: string, public status: number, public code: string | null = null) {
      super(message);
    }
  }
  return {
    ApiError,
    adminGetProposal: vi.fn(),
    adminPutResults: vi.fn(),
    adminListEvents: vi.fn(),
    fetchLeagueConfig: vi.fn(),
    adminPatchEvent: vi.fn(),
    adminPutLastYear: vi.fn(),
    adminQuickEvent: vi.fn(),
    adminScoreEvent: vi.fn(),
  };
});

import * as api from "../../lib/api";
import AdminCompanies from "./AdminCompanies";
import ReviewResultsPanel from "./ReviewResultsPanel";

const mocked = vi.mocked(api);
const SRC = "https://www.example.com/results.pdf";

const metric = (key: LeagueMetric["key"], label: string, def: string): LeagueMetric => ({ key, label, definition_key: def, unit: "%", definition: "", min_value: -100, max_value: 500 });

const ROW: AdminBoardRow = {
  id: 7, company_id: 3, company_name: "Marico", ticker: "MARICO", sector: "fmcg", season_label: "Q2 FY27",
  fiscal_year_label: "FY27", fiscal_quarter: 2, period_end_date: "2026-09-30", results_date: "2026-11-02",
  lock_at: "2026-11-01T18:29:00Z", lock_passed: true, forecasts: 3, raw_status: "open", status: "results_due",
  year_ago_label: "FY26",
  metrics: [
    metric("revenue_growth_yoy", "Revenue growth (YoY)", "in.revenue_growth_yoy.v1"),
    metric("operating_margin", "Operating margin", "in.operating_margin.v1"),
    metric("sector_kpi", "Underlying volume growth", "in.fmcg.underlying_volume_growth.v1"),
  ],
  missing_last_year: [], missing_results: ["revenue_growth_yoy", "operating_margin", "sector_kpi"],
  research_notes: null, has_proposal: true,
};

const PROPOSAL: ResultProposal = {
  event_id: 7, file: "FY27-Q2.json", prepared_on: "2026-11-12",
  metrics: [
    { metric_key: "revenue_growth_yoy", definition_key: "in.revenue_growth_yoy.v1", label: "Revenue growth (YoY)", unit: "%",
      value: 13, last_year_value: 30.7, source_url: SRC, page: "PDF p5", working: "3,897 / 3,450 - 1 = 12.96%",
      flag: "Last year restated", note: "Like for like: compared with last year as restated" },
    { metric_key: "operating_margin", definition_key: "in.operating_margin.v1", label: "Operating margin", unit: "%",
      value: 18.2, last_year_value: 16.1, source_url: SRC, page: "PDF p5", working: "709 / 3,897 = 18.19%", flag: null, note: null },
    { metric_key: "sector_kpi", definition_key: "in.fmcg.underlying_volume_growth.v1", label: "Underlying volume growth", unit: "%",
      value: 10, last_year_value: null, source_url: SRC, page: "PDF p1", working: "As stated", flag: null, note: null },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocked.adminGetProposal.mockResolvedValue(PROPOSAL);
  mocked.adminPutResults.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("ReviewResultsPanel", () => {
  it("shows each proposed value with last year, source, working, note and flag", async () => {
    render(<ReviewResultsPanel row={ROW} onDone={vi.fn()} onCancel={vi.fn()} />);
    const revenue = (await screen.findByLabelText("Revenue growth (YoY) (%)")) as HTMLInputElement;
    expect(revenue.value).toBe("13");
    expect(screen.getByText("30.7%")).toBeTruthy();
    expect(screen.getByText("Not saved")).toBeTruthy(); // KPI with no year-ago value
    expect(screen.getByText(/Check: Last year restated/)).toBeTruthy();
    expect(screen.getByText("Like for like: compared with last year as restated")).toBeTruthy();
    expect(screen.getByText(/3,897 \/ 3,450 - 1 = 12.96%/)).toBeTruthy();
    const links = screen.getAllByRole("link", { name: "example.com" });
    expect(links[0].getAttribute("href")).toBe(SRC);
    expect(links[0].getAttribute("rel")).toContain("noopener");
    expect(mocked.adminGetProposal).toHaveBeenCalledWith(7);
  });

  it("approves the proposed values through the results endpoint, without scoring", async () => {
    const onDone = vi.fn();
    render(<ReviewResultsPanel row={ROW} onDone={onDone} onCancel={vi.fn()} />);
    await screen.findByLabelText("Operating margin (%)");
    fireEvent.click(screen.getByRole("button", { name: "Approve and save" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocked.adminPutResults).toHaveBeenCalledWith(7, [
      { metric_key: "revenue_growth_yoy", definition_key: "in.revenue_growth_yoy.v1", value: 13, source_url: SRC },
      { metric_key: "operating_margin", definition_key: "in.operating_margin.v1", value: 18.2, source_url: SRC },
      { metric_key: "sector_kpi", definition_key: "in.fmcg.underlying_volume_growth.v1", value: 10, source_url: SRC },
    ], true);
    expect(onDone.mock.calls[0][0]).toBe("Saved Marico's results. Press Score when you're ready.");
    expect(mocked.adminScoreEvent).not.toHaveBeenCalled();
  });

  it("saves an edited value and says it changed", async () => {
    const onDone = vi.fn();
    render(<ReviewResultsPanel row={ROW} onDone={onDone} onCancel={vi.fn()} />);
    const margin = await screen.findByLabelText("Operating margin (%)");
    fireEvent.change(margin, { target: { value: "18.1" } });
    expect(screen.getByText("Changed. Proposed 18.2%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve and save" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const items = mocked.adminPutResults.mock.calls[0][1];
    expect(items.find((i) => i.metric_key === "operating_margin")?.value).toBe(18.1);
    expect(onDone.mock.calls[0][0]).toContain("1 changed from the proposal");
  });

  it("refuses a blank value and shows a server refusal", async () => {
    render(<ReviewResultsPanel row={ROW} onDone={vi.fn()} onCancel={vi.fn()} />);
    const kpi = await screen.findByLabelText("Underlying volume growth (%)");
    fireEvent.change(kpi, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve and save" }));
    expect(await screen.findByText("Enter a number for Underlying volume growth.")).toBeTruthy();
    expect(mocked.adminPutResults).not.toHaveBeenCalled();

    fireEvent.change(kpi, { target: { value: "900" } });
    mocked.adminPutResults.mockRejectedValueOnce(new api.ApiError("Underlying volume growth must be between -40 and 60.", 422, "out_of_bounds"));
    fireEvent.click(screen.getByRole("button", { name: "Approve and save" }));
    expect(await screen.findByText("Underlying volume growth must be between -40 and 60.")).toBeTruthy();
  });

  it("cancel closes without saving", async () => {
    const onCancel = vi.fn();
    render(<ReviewResultsPanel row={ROW} onDone={vi.fn()} onCancel={onCancel} />);
    await screen.findByLabelText("Operating margin (%)");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(mocked.adminPutResults).not.toHaveBeenCalled();
  });
});

describe("Companies board", () => {
  it("offers Review results only where there's a proposal, else Enter results", async () => {
    mocked.fetchLeagueConfig.mockResolvedValue({} as never);
    mocked.adminListEvents.mockResolvedValue([
      ROW,
      { ...ROW, id: 8, company_name: "Hand Co", ticker: "HANDCO", has_proposal: false },
    ]);
    render(<AdminCompanies />);
    fireEvent.click(await screen.findByRole("button", { name: "Review results" }));
    expect(await screen.findByRole("form", { name: "Review results for Marico" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Enter results" })).toHaveLength(1);
    expect(screen.getByText("Results due: review proposal")).toBeTruthy();
    expect(screen.getByText("Results due: enter numbers")).toBeTruthy();
  });
});

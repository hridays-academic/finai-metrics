// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OlderCompany, OlderMetric } from "../../lib/types";

vi.mock("../../lib/api", () => {
  class ApiError extends Error {
    constructor(message: string, public status: number, public code: string | null = null) {
      super(message);
    }
  }
  return { ApiError, adminListOlderResults: vi.fn(), adminApproveOlderResults: vi.fn() };
});

import * as api from "../../lib/api";
import AdminOlderResults from "./AdminOlderResults";

const mocked = vi.mocked(api);
const metric = (metric_key: string, label: string, value: number, flag: string | null = null): OlderMetric => ({
  metric_key, definition_key: `in.${metric_key}.v1`, label, unit: "%", value, saved: null,
  source_url: "https://www.example.com/results.pdf", page: "PDF p5", working: "1 / 1 - 1", flag, note: null,
});
const quarter = (fy: string, q: number, use: "practice" | "last_year") => ({
  fiscal_year_label: fy, fiscal_quarter: q, use, results_date: use === "practice" ? "2026-01-21" : null,
  file: `${fy}-Q${q}.json`, status: "new" as const, archive_event: false,
  metrics: [metric("revenue_growth_yoy", "Revenue growth (YoY)", 4.7), metric("operating_margin", "Operating margin", 6.4, "CHECK: scanned")],
});
const SAGAR: OlderCompany = {
  ticker: "SAGCEM", company: "Sagar Cements", in_stackly: true,
  quarters: [quarter("FY25", 3, "last_year"), quarter("FY26", 3, "practice")],
};

describe("AdminOlderResults", () => {
  beforeEach(() => {
    mocked.adminListOlderResults.mockResolvedValue([SAGAR]);
    mocked.adminApproveOlderResults.mockResolvedValue({ quarters_saved: 2, archive_events_created: 1 });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows every number with its flag and approves a whole company, edits included", async () => {
    render(<AdminOlderResults />);
    expect(await screen.findByText(/2 quarters, 2 to approve, 2 to check/)).toBeTruthy();
    expect(screen.getAllByText(/Check: CHECK: scanned/)).toHaveLength(2);
    const inputs = screen.getAllByLabelText("Revenue growth (YoY) (%)") as HTMLInputElement[];
    fireEvent.change(inputs[1], { target: { value: "5.1" } });
    expect(screen.getByText("Changed. Proposed 4.7%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve all 2 quarters for Sagar Cements" }));
    await waitFor(() => expect(mocked.adminApproveOlderResults).toHaveBeenCalledTimes(1));
    const [ticker, body] = mocked.adminApproveOlderResults.mock.calls[0];
    expect(ticker).toBe("SAGCEM");
    expect(body.quarters.map((q) => `${q.fiscal_year_label} Q${q.fiscal_quarter}`)).toEqual(["FY25 Q3", "FY26 Q3"]);
    expect(body.quarters[1].metrics[0]).toEqual({ metric_key: "revenue_growth_yoy", definition_key: "in.revenue_growth_yoy.v1", value: 5.1 });
    expect(await screen.findByText("Saved 2 quarters for Sagar Cements; 1 added to Practice.")).toBeTruthy();
  });

  it("refuses a blank number", async () => {
    render(<AdminOlderResults />);
    const inputs = (await screen.findAllByLabelText("Operating margin (%)")) as HTMLInputElement[];
    fireEvent.change(inputs[0], { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Approve all/ }));
    expect(await screen.findByText("Enter a number for Operating margin, FY25 Q3.")).toBeTruthy();
    expect(mocked.adminApproveOlderResults).not.toHaveBeenCalled();
  });
});

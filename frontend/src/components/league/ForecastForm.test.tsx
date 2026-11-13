// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventDetail, LeagueConfig } from "../../lib/types";

vi.mock("../../lib/api", () => ({ ApiError: class extends Error {}, saveForecast: vi.fn() }));

import { clearForecastDrafts, setForecastDraft } from "../../lib/forecastDrafts";
import ForecastForm from "./ForecastForm";

const event = {
  id: 3, status: "open", lock_at: "2027-01-19T18:29:00Z", server_now: "2026-11-13T00:00:00Z",
  metrics: [{ key: "revenue_growth_yoy", definition_key: "x", label: "Revenue growth (YoY)", unit: "%", definition: "d",
    min_value: -100, max_value: 500 }],
} as unknown as EventDetail;
const config = { reason_tags: [], note_max_chars: 140 } as unknown as LeagueConfig;

function renderForm() {
  render(<ForecastForm event={event} config={config} user={null} forecast={null} onSaved={vi.fn()}
    onNeedProfile={vi.fn()} onOpenAuth={vi.fn()} onLocked={vi.fn()} />);
}

afterEach(() => {
  cleanup();
  clearForecastDrafts();
});

describe("forecast form started from the worksheet", () => {
  it("fills the range and says where it came from", () => {
    setForecastDraft(3, { ranges: { revenue_growth_yoy: { low: "11.2", high: "13.2" } }, fromWorksheet: true });
    renderForm();
    expect(screen.getByText("Started from your worksheet. Change anything before you save.")).toBeTruthy();
    expect((screen.getAllByRole("spinbutton")[0] as HTMLInputElement).value).toBe("11.2");
  });

  it("says nothing about the worksheet for an ordinary draft", () => {
    setForecastDraft(3, { ranges: { revenue_growth_yoy: { low: "1", high: "2" } }, tags: [], note: "" });
    renderForm();
    expect(screen.queryByText(/Started from your worksheet/)).toBeNull();
  });
});

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventDetail, LeagueConfig, UserPublic, Workspace } from "../../lib/types";

vi.mock("../../lib/api", () => {
  class ApiError extends Error {}
  const never = () => new Promise(() => {});
  return {
    ApiError,
    fetchWorkspace: vi.fn(),
    fetchLeagueEvent: vi.fn(),
    fetchLeagueConfig: vi.fn(),
    fetchResearchHistory: vi.fn(never),
    fetchCompany: vi.fn(never),
    fetchCompanyNews: vi.fn(never),
    fetchPeer: vi.fn(never),
    saveWorkspace: vi.fn(async () => ({ notes: {}, done: [], worksheet: null, updated_at: null })),
    clearWorkspace: vi.fn(async () => undefined),
  };
});

import * as api from "../../lib/api";
import { clearForecastDrafts, getForecastDraft } from "../../lib/forecastDrafts";
import { clearWorkspaceMemory } from "../../lib/workspaceMemory";
import WorkspacePage from "./WorkspacePage";

// jsdom has no layout, so no scrollIntoView.
Element.prototype.scrollIntoView = vi.fn();

const metric = (key: string, label: string) => ({
  key, definition_key: `in.${key}.v1`, label, unit: "%", definition: `${label} definition.`, min_value: -100, max_value: 500,
});

const event: EventDetail = {
  id: 1,
  company: {
    id: 9, market_code: "IN", exchange: "NSE", ticker: "DEMOCEM", name: "Demo Cement", sector: "cement",
    currency: "INR", provider_symbol: null, description: null,
  },
  fiscal_year_label: "FY27", fiscal_quarter: 3, period_end_date: "2026-12-31", season_label: "Q3 FY27",
  results_date: "2027-01-20", lock_at: "2027-01-19T18:29:00Z", status: "open", submitted: false, my_score: null,
  metrics: [
    metric("revenue_growth_yoy", "Revenue growth (YoY)"),
    metric("operating_margin", "Operating margin"),
    metric("sector_kpi", "Sales volume growth (YoY)"),
  ],
  research_notes: null, server_now: "2026-11-13T00:00:00Z",
} as EventDetail;

const config = { sector_explainers: [], kpi_templates: [] } as unknown as LeagueConfig;

const titles = ["The business and the three numbers", "Last year's same quarter (the base)", "The recent trend",
  "What the company said", "Clues already public", "Prices and mix", "Costs and inputs",
  "News and events since the last results", "Your driver worksheet", "Your range"];
const keys = ["business", "base", "trend", "said", "clues", "prices", "costs", "news", "worksheet", "range"];

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    event_id: 1, sector: "cement", locked: false, status: "open",
    steps: keys.map((key, i) => ({ key, title: titles[i], why: "Why.", items: [{ text: `Question ${i + 1}?`, kind: "question" }] })),
    glossary: [], news_since: null,
    last_year: [{ metric_key: "operating_margin", value: 18, source_url: "https://example.com", fiscal_year_label: "FY26", fiscal_quarter: 3 }],
    last_quarter: [],
    save_blocked: null,
    state: { notes: {}, done: [], worksheet: null, updated_at: null },
    ...overrides,
  };
}

const user = { id: 5, handle: "asha", age_band: "18_plus", guardian_consent_status: "not_required", needs_terms: false } as UserPublic;

async function open(ws: Workspace) {
  vi.mocked(api.fetchWorkspace).mockResolvedValue(ws);
  vi.mocked(api.fetchLeagueEvent).mockResolvedValue(event);
  vi.mocked(api.fetchLeagueConfig).mockResolvedValue(config);
  render(<WorkspacePage eventId={1} user={user} onUserChange={vi.fn()} onOpenAuth={vi.fn()} theme="dark-aurora" visible />);
  await screen.findByRole("heading", { name: "Research workspace: Demo Cement" });
}

const goToWorksheet = () => fireEvent.click(screen.getByRole("button", { name: /Your driver worksheet/ }));
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  clearForecastDrafts();
  clearWorkspaceMemory();
  window.location.hash = "";
});

describe("research workspace", () => {
  it("saves a note to the account shortly after typing", async () => {
    await open(workspace());
    vi.useFakeTimers();
    type("Your notes", "Cement demand looked strong");
    expect(api.saveWorkspace).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1300);
    });
    expect(api.saveWorkspace).toHaveBeenCalledWith(1, { notes: { business: "Cement demand looked strong" } });
  });

  it("lets an under-18 without consent read and use the worksheet but saves nothing", async () => {
    await open(workspace({ save_blocked: "guardian_consent_pending", state: { notes: {}, done: [], worksheet: null, updated_at: null } }));
    expect(screen.getByText("Your notes will be saved once your parent's consent is recorded.")).toBeTruthy();
    expect(screen.queryByLabelText("Your notes")).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark as done" })).toBeNull();
    goToWorksheet();
    type("Tonnes sold (volume growth)", "10");
    type("Price per tonne", "2");
    expect(screen.getByText("(1 + 10.0%) x (1 + 2.0%) - 1 = 12.2%")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 1500));
    expect(api.saveWorkspace).not.toHaveBeenCalled();
  });

  it("hides the worksheet once forecasts lock", async () => {
    await open(workspace({ locked: true, status: "locked" }));
    goToWorksheet();
    expect(screen.getAllByText("Forecasts are locked, so the worksheet is hidden.").length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Driver worksheet" })).toBeNull();
    expect(screen.getByLabelText("Your notes")).toBeTruthy();
  });

  it("only offers the last-quarter margin when the league has that figure", async () => {
    await open(workspace());
    goToWorksheet();
    expect(screen.getByLabelText("Last year's same quarter (18.0%, league figure)")).toBeTruthy();
    expect(screen.queryByText(/Last quarter \(/)).toBeNull();
  });

  it("copies the student's results into the forecast form as a starting point", async () => {
    await open(workspace());
    goToWorksheet();
    const copy = screen.getByRole("button", { name: "Use as a starting point" }) as HTMLButtonElement;
    expect(copy.disabled).toBe(true);
    type("Tonnes sold (volume growth)", "10");
    type("Price per tonne", "2");
    fireEvent.change(document.getElementById("ws-1-unsure-revenue_growth_yoy")!, { target: { value: "1" } });
    await waitFor(() => expect(copy.disabled).toBe(false));
    fireEvent.click(copy);
    const draft = getForecastDraft(1);
    expect(draft?.fromWorksheet).toBe(true);
    expect(draft?.ranges.revenue_growth_yoy).toEqual({ low: "11.2", high: "13.2" });
    expect(draft?.ranges.operating_margin).toBeUndefined();
    expect(draft?.tags).toBeUndefined();
    expect(window.location.hash).toBe("#/event/1");
  });
});

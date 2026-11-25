// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PracticeAttempt, PracticeCase } from "../../lib/types";

// Types a range into one metric's range control (its Low and High numbers).
function typeRange(label: string, low: string, high: string) {
  const field = screen.getByRole("group", { name: new RegExp(label) });
  for (const [side, v] of [["Low", low], ["High", high]] as const) {
    fireEvent.click(within(field).getByRole("button", { name: new RegExp(`^${side}:`) }));
    const input = within(field).getByLabelText(`${side} (type a number)`);
    fireEvent.change(input, { target: { value: v } });
    fireEvent.keyDown(input, { key: "Enter" });
  }
}

const METRICS = [
  { key: "revenue_growth_yoy", definition_key: "d1", label: "Revenue growth", unit: "%", definition: "x", min_value: -100, max_value: 200 },
  { key: "operating_margin", definition_key: "d2", label: "Operating margin", unit: "%", definition: "y", min_value: -100, max_value: 100 },
] as PracticeCase["metrics"];

const CASE: PracticeCase = {
  code: "k3x9a0", mystery: true, sector: "autos", sector_name: "Autos",
  description: "A car maker selling mostly in India, from small hatchbacks to SUVs.",
  name: null, ticker: null, season_label: null, results_date: null, period_end_date: "0100-09-30",
  metrics: METRICS, research_notes: null,
  quarters: [{ period_end_date: "0100-06-30", revenue_index: 112, operating_margin_pct: 11.2 },
             { period_end_date: "0100-03-31", revenue_index: 100, operating_margin_pct: 10.9 }],
  actuals: [{ period_end_date: "0099-09-30", metric_key: "operating_margin", value: 10.4, source_url: null }],
  provider_source: "Yahoo Finance", provider_definition: "Yahoo's definitions.", provider_as_of: null,
};

const metric = (key: string, label: string, low: number, high: number, actual: number, points: number) => ({
  metric_key: key, label, unit: "%", low, high, actual, lazy: 9, crowd_median: null, interval_score: high - low,
  points, hit: true, beat_lazy: true, explanations: [`${label} sentence.`], note: null,
});

const ATTEMPT: PracticeAttempt = {
  metrics: [metric("revenue_growth_yoy", "Revenue growth", 10, 14, 12, 102),
    { ...metric("operating_margin", "Operating margin", 12, 14, 11, 66), lazy: 10.5, hit: false, beat_lazy: false }],
  event_score: 104, event_score_explanation: "Your event score is the average of your 2 scores: (102 + 106) / 2 = 104.",
  reveal: { name: "Maruti Suzuki", ticker: "MARUTI", season_label: "Q2 FY27", results_date: "2026-10-31", sources: { revenue_growth_yoy: "https://www.marutisuzuki.com/q2.pdf" } },
  saved: false, not_saved_reason: "signed_out", is_replay: false, first_score: null,
};

const submit = vi.fn(() => Promise.resolve(ATTEMPT));
vi.mock("../../lib/api", () => ({
  ApiError: class extends Error {},
  fetchPracticeCase: vi.fn(() => Promise.resolve(CASE)),
  fetchPracticePrices: vi.fn(() => Promise.resolve({ points: [{ date: "0099-10-05", index: 100 }, { date: "0099-10-12", index: 104 }] })),
  fetchLeagueConfig: vi.fn(() => Promise.resolve({ sector_explainers: [], kpi_templates: [] })),
  fetchPracticeCases: vi.fn(() => Promise.resolve([])),
  fetchPriceHistory: vi.fn(() => Promise.reject(new Error("must not be called"))),
  submitPracticeAttempt: (...a: unknown[]) => submit(...(a as [])),
}));

import PracticeCasePage from "./PracticeCasePage";
import { fetchPriceHistory } from "../../lib/api";

beforeEach(() => {
  // Reduced motion: the story renders as a flat list.
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} }) as unknown as typeof window.matchMedia;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a practice company page", () => {
  it("in Mystery mode shows no name or dates and none of the hidden parts", async () => {
    const { container } = render(<PracticeCasePage code="k3x9a0" onOpenAuth={() => {}} />);
    await screen.findByText("Your forecast");
    const text = container.textContent ?? "";
    expect(text).toContain("Mystery company");
    expect(text).toContain("A past quarter. Everything here is as it was before the results came out.");
    expect(text).toContain("Apr to Jun, this year");
    expect(text).toContain("Revenue index");
    for (const hidden of ["Open in Research", "research workspace", "Results expected", "Results are in", "Maruti", "2026"]) {
      expect(text).not.toContain(hidden);
    }
    expect(container.querySelector('a[href^="http"]')).toBeNull();
    expect(fetchPriceHistory).not.toHaveBeenCalled();
    // One "Sources and notes", and only quarters with something in them.
    expect(screen.getAllByText("Sources and notes")).toHaveLength(1);
    expect([...container.querySelectorAll(".league-history-table tbody tr")].map((r) => r.firstElementChild?.textContent))
      .toEqual(["Apr to Jun, this year", "Jan to Mar, this year", "Jul to Sep, last year"]);
  });

  it("scores on submit and then reveals the company, with the sign-in note", async () => {
    render(<PracticeCasePage code="k3x9a0" onOpenAuth={() => {}} />);
    await screen.findByText("Your forecast");
    for (const [label, low, high] of [["Revenue growth", "10", "14"], ["Operating margin", "10", "12"]]) {
      typeRange(label, low, high);
    }
    fireEvent.click(screen.getByRole("button", { name: "Submit and see my score" }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls[0]).toEqual(["k3x9a0", [
      { metric_key: "revenue_growth_yoy", low: 10, high: 14 },
      { metric_key: "operating_margin", low: 10, high: 12 }], true]);
    await screen.findByText("It was Maruti Suzuki: Q2 FY27 results, out on 31 Oct 2026.");
    expect(screen.getByText("Sign in to keep your practice scores. This one isn't saved.")).toBeTruthy();
    expect(screen.getByText("Revenue growth sentence.")).toBeTruthy();
    expect(screen.getByText("Beat the lazy guess").className).toContain("dot-positive");
    expect(screen.getByText("Lazy guess was closer").className).not.toContain("dot-positive");
    expect(screen.queryByText("Replay", { selector: ".practice-badge" })).toBeNull();
  });

  it("marks a replay with the first score", async () => {
    submit.mockResolvedValueOnce({ ...ATTEMPT, saved: true, not_saved_reason: null, is_replay: true, first_score: 88 });
    render(<PracticeCasePage code="k3x9a0" onOpenAuth={() => {}} />);
    await screen.findByText("Your forecast");
    for (const label of ["Revenue growth", "Operating margin"]) {
      typeRange(label, "1", "2");
    }
    fireEvent.click(screen.getByRole("button", { name: "Submit and see my score" }));
    await screen.findByText("Replay", { selector: ".practice-badge" });
    expect(screen.getByText(/Replays don't change your first score\./).textContent).toContain("First try: 88 points");
    expect(screen.queryByText(/Sign in to keep/)).toBeNull();
  });
});

import PracticeTile from "./PracticeTile";

describe("practice tiles", () => {
  it("show the Practice badge only when asked (Home), never on the Practice page", () => {
    const card = { code: "k3x9a0", sector: "autos", sector_name: "Autos", difficulty: null, mystery_line: "A car maker.",
      name: null, ticker: null, season_label: null, description: null, first_score: null, attempts: 0 };
    const page = render(<ul><PracticeTile card={card} /></ul>);
    expect(page.container.querySelector(".practice-badge")).toBeNull();
    page.unmount();
    const home = render(<ul><PracticeTile card={card} badge /></ul>);
    expect(home.container.querySelector(".practice-badge")?.textContent).toBe("Practice");
  });
});

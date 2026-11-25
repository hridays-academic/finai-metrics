// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventDetail, EventOutcome, EventSummary, OutcomeMetric, UserPublic } from "../../lib/types";

vi.mock("../../lib/api", () => {
  class ApiError extends Error {
    constructor(message: string, public status: number, public code: string | null = null) {
      super(message);
    }
  }
  return {
    ApiError,
    fetchMyResult: vi.fn(), fetchOutcome: vi.fn(), fetchLeagueEvent: vi.fn(), fetchLeagueConfig: vi.fn(),
    fetchMyForecast: vi.fn(), fetchResearchHistory: vi.fn(),
    // The story's share price chapter; never resolves (no chart under test).
    fetchPriceHistory: vi.fn(() => new Promise(() => {})),
  };
});
// Charts and research tables aren't under test here.
vi.mock("./ResearchPanel", () => ({ default: () => <div>research</div> }));
vi.mock("./ForecastForm", () => ({ default: () => <form aria-label="forecast form" /> }));

import * as api from "../../lib/api";
import ForecastPage, { KeyStats, ScoredPanel } from "./ForecastPage";
import { RecentResults } from "./LeagueHome";
import { LEAGUE_FOOTNOTE, NO_FORECAST_LINE, formatOutcome, lazyBenchmark, outcomeSummary, rupeeNote } from "./outcome";
import ResultsPage from "./ResultsPage";

const mocked = vi.mocked(api);
const SRC = "https://marico.com/investorspdf/results.pdf";
const NOTE = "Marico changed how it counts some promotions and restated last year's revenue the same way, so the 13.0% compares like with like.";

const METRICS: OutcomeMetric[] = [
  { metric_key: "revenue_growth_yoy", label: "Revenue growth (YoY)", unit: "%", actual: 13, lazy: 30.7, source_url: SRC, crowd_median: null, note: NOTE },
  { metric_key: "operating_margin", label: "Operating margin", unit: "%", actual: 18.2, lazy: 16.1, source_url: SRC, crowd_median: null, note: null },
  { metric_key: "sector_kpi", label: "Underlying volume growth", unit: "%", actual: 10, lazy: 7, source_url: SRC, crowd_median: null, note: null },
];
const SUMMARY: EventSummary = {
  id: 3, company: { id: 3, market_code: "IN", exchange: "NSE", ticker: "MARICO", name: "Marico", sector: "fmcg", currency: "INR", provider_symbol: "MARICO.NS", description: null },
  fiscal_year_label: "FY27", fiscal_quarter: 2, period_end_date: "2026-09-30", season_label: "Q2 FY27", results_date: "2026-11-02",
  lock_at: "2026-11-01T18:29:00Z", status: "scored", submitted: false, my_score: null,
};
const OUTCOME: EventOutcome = { event: SUMMARY, forecasters: 0, crowd_shown: false, crowd_explanation: "The crowd median appears once at least 5 people forecast a company; 0 did here.", metrics: METRICS };
const DETAIL: EventDetail = { ...SUMMARY, metrics: [], research_notes: null, server_now: "2026-11-12T10:00:00Z" };
const USER = { id: 9, email: "s@example.com", name: "S", created_at: "2026-11-01T00:00:00Z", has_password: true, handle: "s",
  age_band: "18_plus", guardian_consent_status: "not_required", school_name: null, is_admin: false,
  terms_accepted_at: "2026-11-11T00:00:00Z", needs_terms: false } as UserPublic;

// jsdom has no ResizeObserver (TileGrid and the number line use it).
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchOutcome.mockResolvedValue(OUTCOME);
});
afterEach(cleanup);

describe("formatting", () => {
  it("signs growth, not the margin, with one decimal", () => {
    expect(formatOutcome(13, "revenue_growth_yoy", "%")).toBe("+13.0%");
    expect(formatOutcome(-2.4, "sector_kpi", "%")).toBe("-2.4%");
    expect(formatOutcome(18.2, "operating_margin", "%")).toBe("18.2%");
    expect(formatOutcome(null, "operating_margin", "%")).toBe("N/A");
  });

  it("explains the rupee for IT when reported and constant-currency growth differ by over 2 points (T23)", () => {
    const m = (r: number, c: number) => [
      { metric_key: "revenue_growth_yoy", actual: r },
      { metric_key: "sector_kpi", actual: c },
    ];
    expect(rupeeNote(m(17.4, 9.7), "it")).toBe(
      "Revenue grew +17.4% in rupees but +9.7% in constant currency. Most of the 7.7-point gap is the rupee: it was weaker against the dollar, so each dollar earned was worth more rupees."
    );
    expect(rupeeNote(m(4, 7), "it")).toContain("stronger against the dollar");
    expect(rupeeNote(m(10, 8.5), "it")).toBeNull(); // within 2 points
    expect(rupeeNote(m(10, 8), "it")).toBeNull(); // exactly 2: no note
    expect(rupeeNote(m(17.4, 9.7), "fmcg")).toBeNull();
  });

  it("writes Home's summary with each sector's KPI name", () => {
    expect(outcomeSummary(METRICS, "fmcg")).toBe("Revenue growth +13.0%, margin 18.2%, volume growth +10.0%");
    expect(outcomeSummary(METRICS, "autos")).toContain("units sold growth +10.0%");
    expect(outcomeSummary(METRICS, "it")).toContain("constant-currency growth +10.0%");
  });
});

describe("results page without a score", () => {
  it("signed in with no forecast: the personal line, the numbers, no points", async () => {
    mocked.fetchMyResult.mockRejectedValue(new api.ApiError("You didn't make a forecast for this company.", 404, "no_forecast"));
    render(<ResultsPage eventId={3} user={USER} onOpenAuth={vi.fn()} />);
    expect(await screen.findByText(NO_FORECAST_LINE)).toBeTruthy();
    expect(screen.getByText("+13.0%")).toBeTruthy();
    expect(screen.getByText("+30.7%")).toBeTruthy(); // last year, the lazy guess
    expect(screen.getByText(NOTE)).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "marico.com" })[0].getAttribute("href")).toBe(SRC);
    expect(screen.getByText(LEAGUE_FOOTNOTE)).toBeTruthy();
    expect(screen.getByText(/0 did here/)).toBeTruthy();
    // No personal points; only the lazy-guess benchmark lines mention points.
    expect(screen.queryAllByText(/points/).every((el) => /^Last year.s figure ±2 points/.test(el.textContent ?? ""))).toBe(true);
    expect(screen.queryByText("Your score")).toBeNull();
  });

  it("signed out: the same numbers without the personal line", async () => {
    render(<ResultsPage eventId={3} user={null} onOpenAuth={vi.fn()} />);
    expect(await screen.findByText("18.2%")).toBeTruthy();
    expect(screen.queryByText(NO_FORECAST_LINE)).toBeNull();
    expect(screen.queryByText("Sign in to see your results.")).toBeNull();
    expect(mocked.fetchMyResult).not.toHaveBeenCalled();
  });

  it("signed out before scoring keeps the sign-in prompt", async () => {
    mocked.fetchOutcome.mockRejectedValue(new api.ApiError("not scored", 404, "not_scored"));
    mocked.fetchLeagueEvent.mockResolvedValue({ ...DETAIL, status: "locked" });
    render(<ResultsPage eventId={3} user={null} onOpenAuth={vi.fn()} />);
    expect(await screen.findByText("Sign in to see your results.")).toBeTruthy();
  });
});

describe("company page after scoring", () => {
  it("says 'Results are in' and shows only the league's margin (T2)", () => {
    const history = { provider_rows: [{ period_end_date: "2026-09-30", revenue: 3897, net_income: 550, operating_margin_pct: 16.6 }],
      actuals: [{ period_end_date: "2026-09-30", metric_key: "operating_margin", value: 18.2 }],
      provider_source: "Yahoo Finance (via yfinance)", provider_as_of: "2026-11-06" } as never;
    render(<KeyStats event={DETAIL} history={history} historyError={null} outcome={OUTCOME} />);
    expect(screen.getByText("Results are in")).toBeTruthy();
    expect(screen.queryByText("Results expected")).toBeNull();
    expect(screen.getByText("18.2%")).toBeTruthy();
    expect(screen.queryByText("16.6%")).toBeNull();
    expect(screen.queryByText(/Yahoo Finance puts/)).toBeNull();
  });

  it("still says 'Results expected' before scoring, with no note", () => {
    render(<KeyStats event={{ ...DETAIL, status: "locked" }} history={null} historyError={null} outcome={null} />);
    expect(screen.getByText("Results expected")).toBeTruthy();
    expect(screen.queryByText(/Yahoo Finance puts/)).toBeNull();
  });

  it("links to the results page, or to your score if you forecast", () => {
    const { rerender } = render(<ScoredPanel event={DETAIL} outcome={OUTCOME} />);
    expect(screen.getByRole("link", { name: "See the full results" }).getAttribute("href")).toBe("#/results/3");
    rerender(<ScoredPanel event={{ ...DETAIL, submitted: true }} outcome={OUTCOME} />);
    expect(screen.getByRole("link", { name: "See your score" })).toBeTruthy();
  });

  it("hides the forecast form once scored", async () => {
    mocked.fetchLeagueEvent.mockResolvedValue(DETAIL);
    mocked.fetchLeagueConfig.mockResolvedValue({ sector_explainers: [], kpi_templates: [] } as never);
    mocked.fetchResearchHistory.mockReturnValue(new Promise(() => {}));
    render(<ForecastPage eventId={3} user={null} onUserChange={vi.fn()} onOpenAuth={vi.fn()} theme="dark" onOpenInResearch={vi.fn()} visible />);
    // The story's last chapter shares the panel's title now that chapters carry no "06".
    expect((await screen.findAllByRole("heading", { name: "How it turned out" })).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText("+13.0%")).toBeTruthy());
    expect(screen.queryByRole("form", { name: "forecast form" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Your forecast" })).toBeNull();
  });

  it("keeps the forecast form while open", async () => {
    mocked.fetchLeagueEvent.mockResolvedValue({ ...DETAIL, status: "open" });
    mocked.fetchLeagueConfig.mockResolvedValue({ sector_explainers: [], kpi_templates: [] } as never);
    mocked.fetchResearchHistory.mockReturnValue(new Promise(() => {}));
    render(<ForecastPage eventId={3} user={null} onUserChange={vi.fn()} onOpenAuth={vi.fn()} theme="dark" onOpenInResearch={vi.fn()} visible />);
    expect(await screen.findByRole("form", { name: "forecast form" })).toBeTruthy();
    expect(mocked.fetchOutcome).not.toHaveBeenCalled();
  });
});

describe("Home recent results", () => {
  it("lists scored companies with their numbers, and your score if you forecast", () => {
    render(<RecentResults results={[
      { event: SUMMARY, metrics: METRICS },
      { event: { ...SUMMARY, id: 5, company: { ...SUMMARY.company, id: 5, name: "Dabur India" }, submitted: true, my_score: 62.66 }, metrics: METRICS },
    ]} />);
    expect(screen.getAllByText("Revenue growth +13.0%, margin 18.2%, volume growth +10.0%")).toHaveLength(2);
    expect(screen.getByRole("link", { name: /Marico.*See results/ }).getAttribute("href")).toBe("#/results/3");
    expect(screen.getByRole("link", { name: /Dabur India.*Your score 62.7/ })).toBeTruthy();
  });
});

describe("lazyBenchmark (Stop 2, item 3)", () => {
  it("scores last year's figure ±2 points, and says when it missed", () => {
    expect(lazyBenchmark(11.0, 10.3, "%", "operating_margin")).toMatch(
      /^Last year's figure ±2 points \(8\.3% to 12\.3%\) would have scored [\d.]+ points\.$/
    );
    expect(lazyBenchmark(20.0, 10.3, "%", "operating_margin")).toMatch(/would have missed, for [\d.]+ points\.$/);
    expect(lazyBenchmark(11.0, null, "%", "operating_margin")).toBeNull();
  });
});

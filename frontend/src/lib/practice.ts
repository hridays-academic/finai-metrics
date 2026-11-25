import type { EventDetail, PracticeCase, ResearchHistory } from "./types";
import { quarterLabel } from "./leagueFormat";

// Practice (2026-11-18). Mystery mode is on by default and remembered in this
// browser only (the Privacy Policy lists it). Storage that can't be read
// counts as the default.
const MYSTERY_KEY = "stackly_practice_mystery";

export function mysteryOn(): boolean {
  try {
    return localStorage.getItem(MYSTERY_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setMystery(on: boolean): void {
  try {
    localStorage.setItem(MYSTERY_KEY, on ? "on" : "off");
  } catch {
    // storage unavailable: the setting lasts for this page only
  }
}

// Quarter names on Mystery mode's relative calendar, where the quarter being
// forecast sits in year 100: "Apr to Jun, this year", "Jul to Sep, last year".
// P8 (master plan; approved 2.28): Mystery mode letters the quarters back
// from the one being forecast: Quarter A is the newest before it.
export function mysteryQuarterLabel(end: string, anchor: string): string {
  const months = (Number(anchor.slice(0, 4)) - Number(end.slice(0, 4))) * 12 + (Number(anchor.slice(5, 7)) - Number(end.slice(5, 7)));
  const back = Math.round(months / 3);
  if (back <= 0) return "This quarter";
  return `Quarter ${String.fromCharCode(64 + Math.min(back, 26))}`;
}

export const MYSTERY_QUARTERS_NOTE = "Letters hide the dates so they don't give the company away. Quarter A is the newest.";

export function practiceQuarterLabel(c: PracticeCase): (end: string) => string {
  return c.mystery ? (end) => mysteryQuarterLabel(end, c.period_end_date) : quarterLabel;
}

export const MYSTERY_NAME = "Mystery company";

// The case as the company page's pieces expect it (CompanyStory and the
// quarters table), so practice reuses them rather than copying them. Fields
// practice never shows (lock time, results date in Mystery mode) are blank
// and the pieces hide them when given `practice`.
export function asEvent(c: PracticeCase): EventDetail {
  return {
    id: 0,
    company: {
      id: 0,
      market_code: "IN",
      exchange: "",
      ticker: c.ticker ?? "",
      name: c.name ?? MYSTERY_NAME,
      sector: c.sector,
      currency: "INR",
      provider_symbol: null,
      description: c.description,
    },
    fiscal_year_label: "",
    fiscal_quarter: 0,
    period_end_date: c.period_end_date,
    season_label: c.season_label ?? "",
    results_date: c.results_date ?? "",
    lock_at: "",
    status: "locked",
    submitted: false,
    my_score: null,
    metrics: c.metrics,
    research_notes: c.research_notes,
    server_now: "",
  };
}

// Revenue arrives as an index (first quarter shown = 100); it goes in the
// revenue column and is formatted as an index by the pieces.
export function asHistory(c: PracticeCase): ResearchHistory {
  return {
    provider_rows: c.quarters.map((q) => ({
      period_end_date: q.period_end_date,
      revenue: q.revenue_index,
      operating_margin_pct: q.operating_margin_pct,
      net_income: null,
    })),
    provider_source: c.provider_source,
    provider_definition: c.provider_definition,
    provider_as_of: c.provider_as_of,
    actuals: c.actuals.map((a) => ({
      period_id: 0,
      fiscal_year_label: "",
      fiscal_quarter: 0,
      period_end_date: a.period_end_date,
      metric_key: a.metric_key,
      definition_key: "",
      value: a.value,
      source_url: a.source_url ?? "",
      entered_at: "",
    })),
  };
}

export const indexText = (v: number) => v.toFixed(0);

// Picks a random case, never `except` when there's another to choose.
export function surprise<T extends { code: string }>(cases: T[], except?: string): T | undefined {
  const pool = cases.length > 1 ? cases.filter((c) => c.code !== except) : cases;
  return pool[Math.floor(Math.random() * pool.length)];
}

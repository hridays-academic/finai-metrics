import { todayInIndia } from "./marketHolidays";

// Rupees in crore, sign first: "-₹44 cr", never "₹-44 cr".
export function formatCrore(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const crore = Math.round(value / 1e7);
  const sign = crore < 0 ? "-" : "";
  return `${sign}₹${Math.abs(crore).toLocaleString("en-IN")} cr`;
}

export function formatDay(iso: string, withYear = false): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

// Whole days from today (India time) to a YYYY-MM-DD date.
export function daysUntil(isoDate: string): number {
  const today = Date.parse(`${todayInIndia().dateStr}T00:00:00Z`);
  return Math.round((Date.parse(`${isoDate}T00:00:00Z`) - today) / 86_400_000);
}

export function resultsCountdown(isoDate: string): string {
  const d = daysUntil(isoDate);
  if (d > 1) return `Results in ${d} days`;
  if (d === 1) return "Results tomorrow";
  if (d === 0) return "Results today";
  return "Results due";
}

const QUARTER_ENDS = ["03-31", "06-30", "09-30", "12-31"];

// The eight quarter-end dates before the event's own period, newest first.
// Generated rather than taken from the data, so a missing quarter shows as
// N/A instead of silently disappearing (yfinance often skips one).
export function previousQuarterEnds(periodEnd: string, count: number): string[] {
  let year = Number(periodEnd.slice(0, 4));
  let idx = QUARTER_ENDS.indexOf(periodEnd.slice(5));
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    idx -= 1;
    if (idx < 0) {
      idx = 3;
      year -= 1;
    }
    // Padded, so Practice's relative calendar (year 100) stays YYYY-MM-DD.
    out.push(`${String(year).padStart(4, "0")}-${QUARTER_ENDS[idx]}`);
  }
  return out;
}

export function quarterLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

export function crorePlain(value: number): string {
  return formatCrore(value) as string;
}

// T2 (master plan phase 1): one operating margin everywhere, on the league's
// definition. A league series over some quarter ends, from the admin-entered
// actuals only (never Yahoo's figures); null where the league has none.
export function leagueSeries(
  actuals: { period_end_date: string; metric_key: string; value: number }[] | undefined,
  key: string,
  ends: string[]
): (number | null)[] {
  return ends.map((end) => actuals?.find((a) => a.period_end_date === end && a.metric_key === key)?.value ?? null);
}

// The newest league figure for a metric, with its quarter end.
export function latestLeague(
  actuals: { period_end_date: string; metric_key: string; value: number }[] | undefined,
  key: string
): { value: number; end: string } | null {
  const rows = (actuals ?? []).filter((a) => a.metric_key === key).sort((a, b) => b.period_end_date.localeCompare(a.period_end_date));
  return rows.length ? { value: rows[0].value, end: rows[0].period_end_date } : null;
}

export const signedPct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;

// The same quarter end a year earlier ("2026-09-30" -> "2025-09-30").
export function yearAgoEnd(iso: string): string {
  return `${String(Number(iso.slice(0, 4)) - 1).padStart(4, "0")}${iso.slice(4)}`;
}

// Last year's league figure for each metric (the lazy guess), or null.
export function lastYearValues(
  actuals: { period_end_date: string; metric_key: string; value: number }[] | undefined,
  periodEnd: string,
  keys: string[]
): Record<string, number | null> {
  const end = yearAgoEnd(periodEnd);
  return Object.fromEntries(
    keys.map((k) => [k, actuals?.find((a) => a.period_end_date === end && a.metric_key === k)?.value ?? null])
  );
}

// T10/F5 (master plan): before any typing, a metric's scale centres on last
// year's value: +-8 points for the margin, +-10 for growth figures.
export function scaleAround(key: string, lastYear: number | null | undefined): [number, number] | undefined {
  if (lastYear === null || lastYear === undefined) return undefined;
  const half = key === "operating_margin" ? 8 : 10;
  return [lastYear - half, lastYear + half];
}

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
    out.push(`${year}-${QUARTER_ENDS[idx]}`);
  }
  return out;
}

export function quarterLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

export function crorePlain(value: number): string {
  return formatCrore(value) as string;
}

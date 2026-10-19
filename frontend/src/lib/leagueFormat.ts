import { todayInIndia } from "./marketHolidays";

export function formatCrore(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return `₹${(value / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 0 })} cr`;
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

import type { Metric } from "./types";

// Indian numbering convention (lakh/crore) for large rupee figures -- much
// more readable than a raw 12-digit number for market cap, revenue, etc.
export function formatINR(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} L`;
  // Round to whole rupees -- toLocaleString alone doesn't, so a value with
  // any fractional remainder (e.g. shares x a price with paise) rendered as
  // "52,867.067" instead of "52,867".
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
}

export function formatMetricValue(metric: Metric): string {
  if (metric.value === null || metric.value === undefined) return "N/A";
  switch (metric.unit) {
    case "%":
      return `${metric.value.toFixed(2)}%`;
    case "x":
      return `${metric.value.toFixed(2)}x`;
    case "INR":
      return formatINR(metric.value);
    default:
      return metric.value.toFixed(2);
  }
}

export function formatRawValue(value: number | null, currency: string): string {
  if (value === null || value === undefined) return "N/A";
  if (currency === "INR") return formatINR(value);
  return value.toLocaleString();
}

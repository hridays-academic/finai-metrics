import type { Metric } from "./types";

// Indian numbering convention (lakh/crore) for large rupee figures -- much
// more readable than a raw 12-digit number for market cap, revenue, etc.
export function formatINR(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e7) {
    const cr = abs / 1e7;
    // Large companies routinely report revenue/assets in the lakhs-of-crores
    // range (e.g. ~9,00,000 Cr) -- "900000.00 Cr" with no grouping and two
    // decimals nobody needs reads as an unformatted raw number, not a
    // deliberately-designed figure. Real Indian financial reporting groups
    // the crore figure itself (en-IN) and drops decimal noise once it's
    // already a 3+ digit crore value; smaller crore figures (a mid-cap's
    // ~45.32 Cr) still want the two decimals of precision.
    const formatted = cr >= 100 ? Math.round(cr).toLocaleString("en-IN") : cr.toFixed(2);
    return `${sign}₹${formatted} Cr`;
  }
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

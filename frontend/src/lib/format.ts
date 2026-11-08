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

// A statement amount in its reporting currency. Yahoo reports a few Indian
// companies' accounts in US dollars (e.g. Infosys), so not everything is rupees.
export function formatAmount(value: number, currency: string): string {
  if (currency === "INR") return formatINR(value);
  const sign = value < 0 ? "-" : "";
  const millions = Math.abs(value) / 1e6;
  const symbol = currency === "USD" ? "$" : `${currency} `;
  return `${sign}${symbol}${millions.toLocaleString("en-US", { maximumFractionDigits: millions >= 100 ? 0 : 1 })} m`;
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
    case "days":
      return `${Math.round(metric.value)} days`;
    case "USD":
      return formatAmount(metric.value, "USD");
    default:
      return metric.value.toFixed(2);
  }
}

export function formatRawValue(value: number | null, currency: string): string {
  if (value === null || value === undefined) return "N/A";
  if (currency === "INR") return formatINR(value);
  return value.toLocaleString();
}

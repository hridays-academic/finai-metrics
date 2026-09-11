// Paper Trading's own currency formatting -- deliberately separate from
// lib/format.ts's formatINR, which formats REAL rupee figures for real
// companies' actual reported financials elsewhere in the app (Calculator,
// the main dashboard, etc.). Paper Trading is a game played with fake
// money, so its cash/portfolio-value/P&L/share-price figures are labeled
// "coins" (🪙) instead of ₹ -- a pure relabeling for now, at parity with
// real rupees (1 coin == 1 rupee's worth of buying power), NOT a currency
// conversion. If a coins-per-rupee exchange rate is ever introduced (e.g.
// for a "top up your balance" feature), convert the underlying number
// before it reaches these formatters -- they should keep just displaying
// whatever number they're given, unconverted.

// Whole-number amounts: cash balance, portfolio value, P&L, market value,
// transaction totals. Indian digit grouping (en-IN) is a grouping-style
// choice independent of currency identity, kept for consistency with the
// rest of the app's numeric formatting.
export function formatCoins(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}🪙${Math.round(Math.abs(value)).toLocaleString("en-IN")}`;
}

export function formatSignedCoins(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatCoins(value)}`;
}

// Per-share prices keep up to 2 decimal places (a real market price like
// ₹1,349.20 shouldn't get rounded away) -- same precision formatINR's
// sibling, formatPrice-style helpers elsewhere in the app already use.
export function formatCoinPrice(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}🪙${Math.abs(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

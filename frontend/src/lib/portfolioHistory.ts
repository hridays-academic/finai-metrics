// Reconstructs a Paper Trading portfolio's value over time for the
// Portfolio Analysis tab's chart (see PortfolioValueChart.tsx). This app
// has no time-series snapshot storage anywhere -- lib/portfolio.ts only
// ever tracks "current cash + current holdings," never a history of what
// that was at any past moment (see CLAUDE.md's "Paper Trading" section on
// why portfolio state is localStorage-only, current-state-only). There was
// never a "value as of last Tuesday" number sitting anywhere to read, so
// this rebuilds one from the two things that ARE real historical records:
// the transaction log (exact, always correct) and each traded symbol's own
// real historical closing prices (fetched separately via
// /api/trading/history, see PortfolioValueChart.tsx) -- replaying every
// transaction chronologically against those real prices.

import type { Transaction } from "./portfolio";
import type { PricePoint, TradingRange } from "./types";

// Picks a /api/trading/history range wide enough to cover from a
// portfolio's first-ever transaction to now. Errs toward a wider bucket
// than the exact span needs (e.g. a 40-day-old portfolio gets "3M", not a
// precise "41 days") since that endpoint only serves this fixed set of
// ranges, not an arbitrary custom window.
export function pickHistoryRange(daysSinceFirstTransaction: number): TradingRange {
  if (daysSinceFirstTransaction <= 1) return "1D";
  if (daysSinceFirstTransaction <= 7) return "1W";
  if (daysSinceFirstTransaction <= 30) return "1M";
  if (daysSinceFirstTransaction <= 90) return "3M";
  if (daysSinceFirstTransaction <= 365) return "1Y";
  return "5Y";
}

export interface ValuePoint {
  time: number; // unix seconds
  value: number;
}

// `priceSeries` maps symbol -> that symbol's fetched PricePoint[] (any
// order). A symbol missing from `priceSeries` entirely (its history fetch
// failed) falls back to using its position's own weighted-average buy
// price as a flat stand-in for every timestamp -- a disclosed
// approximation (see PortfolioValueChart.tsx's error copy), not real
// history, but better than silently dropping that holding's value from
// the whole chart.
export function buildPortfolioValueSeries(
  transactions: Transaction[],
  startingBalance: number,
  priceSeries: Record<string, PricePoint[]>
): ValuePoint[] {
  if (transactions.length === 0) return [];

  const sorted = [...transactions].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const firstTradeMs = new Date(sorted[0].timestamp).getTime();

  // Each symbol's own points, pre-sorted ascending once up front rather
  // than re-sorting inside the per-timestamp price lookup below.
  const sortedSeries: Record<string, { t: number; close: number }[]> = {};
  Object.entries(priceSeries).forEach(([symbol, points]) => {
    sortedSeries[symbol] = points
      .map((p) => ({ t: new Date(p.date).getTime(), close: p.close }))
      .filter((p) => !Number.isNaN(p.t))
      .sort((a, b) => a.t - b.t);
  });

  // The chart's x-axis is the union of every real price-point timestamp
  // (at or after the first trade's OWN CALENDAR DAY, not its exact
  // millisecond) across every traded symbol -- those are the only moments
  // there's real price data to plot a value against. Using the exact
  // first-trade instant here was a real bug: daily/weekly PricePoints are
  // always stamped at that day's UTC midnight, which is always earlier
  // than whatever time of day the actual trade happened -- so the entire
  // first trading day's point got filtered out unconditionally, silently
  // dropping one real data point (and shifting every subsequent point's
  // apparent "day number" by one) every single time. Flooring to the
  // trade's own day fixes this: an intraday point earlier that same day
  // than the trade itself still isn't wrongly counted as "already
  // invested," since the replay loop below only starts consuming
  // transactions once `atMs` actually reaches each one -- it just
  // correctly renders as still-100%-cash for those few earlier bars.
  const firstTradeDay = new Date(firstTradeMs);
  const firstTradeDayStartMs = Date.UTC(
    firstTradeDay.getUTCFullYear(),
    firstTradeDay.getUTCMonth(),
    firstTradeDay.getUTCDate()
  );
  const timestampSet = new Set<number>();
  Object.values(sortedSeries).forEach((points) => {
    points.forEach((p) => {
      if (p.t >= firstTradeDayStartMs) timestampSet.add(p.t);
    });
  });
  const timestamps = Array.from(timestampSet).sort((a, b) => a - b);
  if (timestamps.length === 0) return [];

  // Most recent close at-or-before `atMs` for one symbol -- a plain
  // forward scan is fine (each series is at most a few hundred points,
  // and this runs once per timestamp bucket, not per animation frame).
  function priceAt(symbol: string, atMs: number, fallback: number): number {
    const points = sortedSeries[symbol];
    if (!points || points.length === 0) return fallback;
    let best: number | null = null;
    for (const p of points) {
      if (p.t <= atMs) best = p.close;
      else break;
    }
    return best ?? fallback;
  }

  const result: ValuePoint[] = [];
  let txIndex = 0;
  let cash = startingBalance;
  const qty: Record<string, number> = {};
  const avgCost: Record<string, number> = {};

  for (const atMs of timestamps) {
    // Replay every transaction up to and including this moment -- `sorted`
    // and `timestamps` are both ascending, so txIndex only ever moves
    // forward across the whole loop, never re-scanning from the start.
    while (txIndex < sorted.length && new Date(sorted[txIndex].timestamp).getTime() <= atMs) {
      const t = sorted[txIndex];
      if (t.type === "buy") {
        const prevQty = qty[t.symbol] ?? 0;
        const prevCost = avgCost[t.symbol] ?? 0;
        const newQty = prevQty + t.qty;
        avgCost[t.symbol] = newQty > 0 ? (prevQty * prevCost + t.qty * t.price) / newQty : 0;
        qty[t.symbol] = newQty;
        cash -= t.total;
      } else {
        qty[t.symbol] = (qty[t.symbol] ?? 0) - t.qty;
        cash += t.total;
      }
      txIndex += 1;
    }

    let holdingsValue = 0;
    for (const symbol of Object.keys(qty)) {
      const heldQty = qty[symbol];
      if (heldQty <= 0) continue;
      holdingsValue += heldQty * priceAt(symbol, atMs, avgCost[symbol] ?? 0);
    }

    result.push({ time: Math.floor(atMs / 1000), value: cash + holdingsValue });
  }

  return result;
}

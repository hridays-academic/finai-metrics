import { useState } from "react";
import {
  getPortfolio,
  savePortfolio,
  resetPortfolio as resetStoredPortfolio,
  type Portfolio,
  type Transaction,
} from "../lib/portfolio";

export interface TradeResult {
  ok: boolean;
  error?: string;
}

// Whole shares only, matching how NSE/BSE actually trade -- no Indian
// broker offers fractional share trading on the primary exchanges, unlike
// some US brokers. Enforced here (Number.isInteger) rather than just via
// the quantity input's `step="1"`, since a pasted or scripted value could
// still arrive as a non-integer otherwise.
function isValidQty(qty: number): boolean {
  return Number.isInteger(qty) && qty > 0;
}

// All portfolio math (average cost basis, realized/unrealized P&L,
// insufficient-funds/oversell checks) lives here, not in PaperTrading.tsx --
// same separation as lib/portfolio.ts holding pure storage vs. this hook
// holding the business rules that decide what gets stored.
export function usePortfolio() {
  const [portfolio, setPortfolio] = useState<Portfolio>(() => getPortfolio());

  function persist(next: Portfolio) {
    savePortfolio(next);
    setPortfolio(next);
  }

  function buy(symbol: string, name: string, qty: number, price: number): TradeResult {
    if (!isValidQty(qty)) return { ok: false, error: "Enter a whole number of shares (1 or more)." };
    if (!price || price <= 0) return { ok: false, error: "No live price available for this stock yet." };

    const cost = qty * price;
    if (cost > portfolio.cash) {
      return { ok: false, error: "Insufficient virtual funds for this purchase." };
    }

    const holdings = [...portfolio.holdings];
    const idx = holdings.findIndex((h) => h.symbol === symbol);
    if (idx >= 0) {
      // Weighted-average cost basis -- the standard, simplest convention
      // for tracking a position built up across multiple buys.
      const existing = holdings[idx];
      const totalQty = existing.qty + qty;
      const avgBuyPrice = (existing.qty * existing.avgBuyPrice + qty * price) / totalQty;
      holdings[idx] = { ...existing, qty: totalQty, avgBuyPrice };
    } else {
      holdings.push({ symbol, name, qty, avgBuyPrice: price });
    }

    const tx: Transaction = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      type: "buy",
      symbol,
      name,
      qty,
      price,
      total: cost,
      realizedPnl: null,
    };
    persist({ ...portfolio, cash: portfolio.cash - cost, holdings, transactions: [tx, ...portfolio.transactions] });
    return { ok: true };
  }

  function sell(symbol: string, qty: number, price: number): TradeResult {
    if (!isValidQty(qty)) return { ok: false, error: "Enter a whole number of shares (1 or more)." };
    if (!price || price <= 0) return { ok: false, error: "No live price available for this stock yet." };

    const idx = portfolio.holdings.findIndex((h) => h.symbol === symbol);
    const holding = idx >= 0 ? portfolio.holdings[idx] : null;
    if (!holding || holding.qty < qty) {
      return { ok: false, error: "You don't hold enough shares to sell that many." };
    }

    const proceeds = qty * price;
    const realizedPnl = (price - holding.avgBuyPrice) * qty;
    const holdings = [...portfolio.holdings];
    if (holding.qty === qty) {
      holdings.splice(idx, 1);
    } else {
      holdings[idx] = { ...holding, qty: holding.qty - qty };
    }

    const tx: Transaction = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      type: "sell",
      symbol,
      name: holding.name,
      qty,
      price,
      total: proceeds,
      realizedPnl,
    };
    persist({ ...portfolio, cash: portfolio.cash + proceeds, holdings, transactions: [tx, ...portfolio.transactions] });
    return { ok: true };
  }

  function reset() {
    persist(resetStoredPortfolio());
  }

  return { portfolio, buy, sell, reset };
}

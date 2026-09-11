// Pure localStorage storage for Paper Trading's virtual portfolio -- same
// pattern as lib/tapetideKey.ts, and for the same underlying reason: this
// app has no per-user backend store that doesn't require being signed in
// (see CLAUDE.md's "Accounts & activity tracking" -- sign-in is additive,
// never a gate), and Paper Trading works fully signed-out like every other
// feature. LIMITATION (explicitly not solved here, see CLAUDE.md's "Paper
// Trading" section): this means the portfolio lives only in this browser --
// it does not sync across devices/browsers, and clearing site data erases
// it permanently. A signed-in-only backend store (a new Postgres table,
// mirroring how a saved Tapetide key works) would fix that, but was left
// as a deliberate follow-up rather than built now, since it would make
// Paper Trading behave differently signed-in vs. not, unlike every other
// feature in this app.

export interface Holding {
  symbol: string;
  name: string;
  qty: number;
  avgBuyPrice: number;
}

export interface Transaction {
  id: string;
  timestamp: string; // ISO 8601
  type: "buy" | "sell";
  symbol: string;
  name: string;
  qty: number;
  price: number;
  total: number; // qty * price
  realizedPnl: number | null; // only set for "sell" transactions
}

export interface Portfolio {
  cash: number;
  startingBalance: number;
  holdings: Holding[];
  transactions: Transaction[];
}

const PORTFOLIO_KEY = "finai_paper_trading_portfolio";
const STARTING_BALANCE_KEY = "finai_paper_trading_starting_balance";

// 1,000,000 coins (see lib/coins.ts) -- a round, recognizable number for a
// paper-trading demo. Originally introduced as ₹10,00,000; the currency
// was relabeled to "coins" (2026-09) at parity with that same number --
// see lib/coins.ts's module comment for why this isn't a conversion.
const DEFAULT_STARTING_BALANCE = 1_000_000;

export function getStartingBalance(): number {
  const raw = localStorage.getItem(STARTING_BALANCE_KEY);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STARTING_BALANCE;
}

// Deliberately does NOT touch an already-initialized portfolio's current
// cash balance -- see SettingsPanel.tsx's copy next to this control. It
// only changes what a *future* first-use or "Reset portfolio" seeds with,
// so editing it mid-session can never silently teleport an in-progress
// portfolio's cash (which would be confusing and order-dependent -- does
// changing it after some trades add/remove the difference from cash? from
// holdings? There's no non-arbitrary answer, so this sidesteps the
// question entirely).
export function setStartingBalance(amount: number): void {
  localStorage.setItem(STARTING_BALANCE_KEY, String(amount));
}

function freshPortfolio(): Portfolio {
  const startingBalance = getStartingBalance();
  return { cash: startingBalance, startingBalance, holdings: [], transactions: [] };
}

export function getPortfolio(): Portfolio {
  const raw = localStorage.getItem(PORTFOLIO_KEY);
  if (!raw) return freshPortfolio();
  try {
    const parsed = JSON.parse(raw) as Portfolio;
    if (typeof parsed.cash !== "number" || !Array.isArray(parsed.holdings)) return freshPortfolio();
    return parsed;
  } catch {
    return freshPortfolio();
  }
}

export function savePortfolio(portfolio: Portfolio): void {
  localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(portfolio));
}

export function resetPortfolio(): Portfolio {
  const fresh = freshPortfolio();
  savePortfolio(fresh);
  return fresh;
}

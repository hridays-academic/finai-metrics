import { FormEvent, useMemo, useState } from "react";
import { ApiError, searchTradingSymbol } from "../lib/api";
import { formatINR } from "../lib/format";
import { getStartingBalance } from "../lib/portfolio";
import { usePortfolio } from "../hooks/usePortfolio";
import { useLiveQuotes } from "../hooks/useLiveQuotes";
import TradingChart from "./TradingChart";
import type { Theme } from "../hooks/useTheme";

function formatPrice(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function formatSignedINR(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatINR(value)}`;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface PaperTradingProps {
  theme: Theme;
  // Pauses live-quote polling while this page's tab isn't the one currently
  // selected (see App.tsx's view-wrapper pattern + useLiveQuotes.ts) --
  // without this, every picked/held symbol would keep polling in the
  // background forever, even while the user is on a different tab.
  visible: boolean;
}

export default function PaperTrading({ theme, visible }: PaperTradingProps) {
  const { portfolio, buy, sell, reset } = usePortfolio();

  const [stockQuery, setStockQuery] = useState("");
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);
  const [pickedSymbol, setPickedSymbol] = useState<string | null>(null);
  const [pickedName, setPickedName] = useState<string>("");

  const [qty, setQty] = useState("1");
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [tradeMessage, setTradeMessage] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);

  // Every symbol worth polling right now: whatever's picked (for the chart
  // + buy/sell panel) plus every symbol actually held (for the holdings
  // table's current prices / unrealized P&L) -- deduped, since the picked
  // stock is very often also a holding.
  const symbolsToTrack = useMemo(() => {
    const set = new Set<string>();
    if (pickedSymbol) set.add(pickedSymbol);
    portfolio.holdings.forEach((h) => set.add(h.symbol));
    return Array.from(set);
  }, [pickedSymbol, portfolio.holdings]);

  const liveQuotes = useLiveQuotes(symbolsToTrack, visible);
  const liveQuote = pickedSymbol ? liveQuotes[pickedSymbol] : undefined;

  const holdingsValue = portfolio.holdings.reduce(
    (sum, h) => sum + h.qty * (liveQuotes[h.symbol]?.price ?? h.avgBuyPrice),
    0
  );
  const totalValue = portfolio.cash + holdingsValue;
  const totalPnl = totalValue - portfolio.startingBalance;
  const totalPnlPct = portfolio.startingBalance > 0 ? (totalPnl / portfolio.startingBalance) * 100 : 0;

  const heldQty = pickedSymbol ? portfolio.holdings.find((h) => h.symbol === pickedSymbol)?.qty ?? 0 : 0;
  const qtyNum = Number(qty);
  const estimatedTotal = liveQuote && qtyNum > 0 ? qtyNum * liveQuote.price : 0;
  const maxAffordable = liveQuote && liveQuote.price > 0 ? Math.floor(portfolio.cash / liveQuote.price) : 0;

  async function handlePickStock(e: FormEvent) {
    e.preventDefault();
    const query = stockQuery.trim();
    if (!query) return;
    setStockLoading(true);
    setStockError(null);
    setTradeError(null);
    setTradeMessage(null);
    try {
      const info = await searchTradingSymbol(query);
      setPickedSymbol(info.resolved_symbol);
      setPickedName(info.company_name);
      setStockQuery("");
    } catch (err) {
      setStockError(err instanceof ApiError ? err.message : "Couldn't find that stock.");
    } finally {
      setStockLoading(false);
    }
  }

  function clearStock() {
    setPickedSymbol(null);
    setPickedName("");
    setStockError(null);
    setTradeError(null);
    setTradeMessage(null);
  }

  function handleBuy() {
    if (!pickedSymbol || !liveQuote) return;
    const result = buy(pickedSymbol, pickedName, qtyNum, liveQuote.price);
    if (!result.ok) {
      setTradeError(result.error ?? "Couldn't complete that purchase.");
      setTradeMessage(null);
    } else {
      setTradeError(null);
      setTradeMessage(`Bought ${qtyNum.toLocaleString("en-IN")} share${qtyNum === 1 ? "" : "s"} of ${pickedName} at ${formatPrice(liveQuote.price)}.`);
    }
  }

  function handleSell() {
    if (!pickedSymbol || !liveQuote) return;
    const result = sell(pickedSymbol, qtyNum, liveQuote.price);
    if (!result.ok) {
      setTradeError(result.error ?? "Couldn't complete that sale.");
      setTradeMessage(null);
    } else {
      setTradeError(null);
      setTradeMessage(`Sold ${qtyNum.toLocaleString("en-IN")} share${qtyNum === 1 ? "" : "s"} of ${pickedName} at ${formatPrice(liveQuote.price)}.`);
    }
  }

  function handleReset() {
    reset();
    setConfirmingReset(false);
    setPickedSymbol(null);
    setPickedName("");
    setTradeError(null);
    setTradeMessage(null);
  }

  return (
    <div className="calculator-page">
      <div className="calculator-card trading-card">
        <h2>Paper Trading</h2>
        <p className="calculator-subtitle">
          Practice buying and selling real NSE/BSE stocks with virtual money -- track a portfolio,
          watch it move with (delayed) live prices, with zero real financial risk.
        </p>
        <p className="page-disclaimer">
          This is a simulation using fake money and delayed market data (see the "Delayed data" badge
          on the chart) -- not real trading, not investment advice, and not a live/real-time feed. Stackly
          holds no liability for any financial decisions made using this simulation.
        </p>

        <div className="calculator-results trading-summary">
          <div className="calculator-result-tile">
            <div className="label">Cash balance</div>
            <div className="value">{formatINR(portfolio.cash)}</div>
          </div>
          <div className="calculator-result-tile">
            <div className="label">Portfolio value</div>
            <div className="value">{formatINR(totalValue)}</div>
          </div>
          <div className="calculator-result-tile">
            <div className="label">Total P&amp;L</div>
            <div className={`value ${totalPnl >= 0 ? "good" : "bad"}`}>
              {formatSignedINR(totalPnl)} ({totalPnlPct >= 0 ? "+" : ""}
              {totalPnlPct.toFixed(1)}%)
            </div>
          </div>
        </div>

        <div className="calculator-stock-picker">
          <div className="calculator-field-header">
            <span>Pick a stock to trade</span>
          </div>
          {pickedSymbol ? (
            <div className="calculator-stock-chip">
              <span>
                {pickedName} <span className="calculator-stock-chip-ticker">{pickedSymbol}</span>
              </span>
              <button type="button" onClick={clearStock} aria-label="Remove stock" title="Remove stock">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ) : (
            <form className="calculator-stock-form" onSubmit={handlePickStock}>
              <input
                type="text"
                placeholder="e.g. Reliance, TCS, or RELIANCE"
                value={stockQuery}
                onChange={(e) => setStockQuery(e.target.value)}
                aria-label="Search a stock to trade"
              />
              <button type="submit" disabled={stockLoading || !stockQuery.trim()}>
                {stockLoading ? "Loading..." : "Use"}
              </button>
            </form>
          )}
          {stockError && <div className="calculator-stock-error">{stockError}</div>}
        </div>

        {!pickedSymbol && <div className="calculator-empty-hint">Pick a stock above to start trading.</div>}

        {pickedSymbol && (
          <>
            <TradingChart symbol={pickedSymbol} theme={theme} />

            <div className="trading-trade-panel">
              <div className="trading-live-price">
                {liveQuote ? (
                  <>
                    <span className="trading-live-price-value">{formatPrice(liveQuote.price)}</span>
                    {liveQuote.change !== null && liveQuote.change_pct !== null && (
                      <span className={`price-chart-change ${liveQuote.change >= 0 ? "good" : "bad"}`}>
                        {liveQuote.change >= 0 ? "+" : ""}
                        {formatPrice(liveQuote.change)} ({liveQuote.change_pct >= 0 ? "+" : ""}
                        {liveQuote.change_pct.toFixed(2)}%)
                      </span>
                    )}
                    <span className="trading-delayed-badge">Delayed</span>
                  </>
                ) : (
                  <span className="calculator-field-note">Fetching a live price...</span>
                )}
                {heldQty > 0 && <span className="trading-held-note">You hold {heldQty.toLocaleString("en-IN")} shares</span>}
              </div>

              <div className="trading-trade-controls">
                <label className="calculator-field trading-qty-field">
                  <span>Quantity (whole shares)</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                  />
                </label>
                <div className="trading-trade-buttons">
                  <button type="button" className="trading-buy-btn" onClick={handleBuy} disabled={!liveQuote}>
                    Buy
                  </button>
                  <button type="button" className="trading-sell-btn" onClick={handleSell} disabled={!liveQuote || heldQty === 0}>
                    Sell
                  </button>
                </div>
              </div>

              {liveQuote && qtyNum > 0 && (
                <div className="calculator-field-note">
                  Estimated {estimatedTotal <= portfolio.cash ? "cost" : "cost (exceeds cash)"}: {formatINR(estimatedTotal)}
                  {" -- "}
                  max affordable: {maxAffordable.toLocaleString("en-IN")} share{maxAffordable === 1 ? "" : "s"}
                </div>
              )}
              {tradeError && <div className="calculator-stock-error">{tradeError}</div>}
              {tradeMessage && !tradeError && <div className="trading-trade-success">{tradeMessage}</div>}
            </div>
          </>
        )}

        <div className="calculator-field-header trading-section-header">
          <span>Holdings</span>
        </div>
        {portfolio.holdings.length === 0 ? (
          <div className="calculator-empty-hint">No holdings yet -- buy a stock above to get started.</div>
        ) : (
          <div className="trading-table-wrap">
            <table className="trading-holdings-table">
              <thead>
                <tr>
                  <th>Stock</th>
                  <th>Qty</th>
                  <th>Avg. buy price</th>
                  <th>Current price</th>
                  <th>Market value</th>
                  <th>Unrealized P&amp;L</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {portfolio.holdings.map((h) => {
                  const price = liveQuotes[h.symbol]?.price;
                  const marketValue = price !== undefined ? price * h.qty : null;
                  const unrealizedPnl = price !== undefined ? (price - h.avgBuyPrice) * h.qty : null;
                  const unrealizedPnlPct = price !== undefined && h.avgBuyPrice > 0 ? ((price - h.avgBuyPrice) / h.avgBuyPrice) * 100 : null;
                  return (
                    <tr key={h.symbol}>
                      <td>
                        <div className="trading-table-stock-name">{h.name}</div>
                        <div className="trading-table-stock-ticker">{h.symbol}</div>
                      </td>
                      <td>{h.qty.toLocaleString("en-IN")}</td>
                      <td>{formatPrice(h.avgBuyPrice)}</td>
                      <td>{price !== undefined ? formatPrice(price) : "..."}</td>
                      <td>{marketValue !== null ? formatINR(marketValue) : "..."}</td>
                      <td className={unrealizedPnl !== null ? (unrealizedPnl >= 0 ? "good" : "bad") : ""}>
                        {unrealizedPnl !== null && unrealizedPnlPct !== null
                          ? `${formatSignedINR(unrealizedPnl)} (${unrealizedPnlPct >= 0 ? "+" : ""}${unrealizedPnlPct.toFixed(1)}%)`
                          : "..."}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="trading-table-trade-btn"
                          onClick={() => {
                            setPickedSymbol(h.symbol);
                            setPickedName(h.name);
                            setTradeError(null);
                            setTradeMessage(null);
                          }}
                        >
                          Trade
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="calculator-field-header trading-section-header">
          <span>Transaction history</span>
        </div>
        {portfolio.transactions.length === 0 ? (
          <div className="calculator-empty-hint">No transactions yet.</div>
        ) : (
          <div className="trading-transactions-list">
            {portfolio.transactions.map((t) => (
              <div className={`trading-transaction-row ${t.type}`} key={t.id}>
                <span className={`trading-transaction-badge ${t.type}`}>{t.type === "buy" ? "BUY" : "SELL"}</span>
                <span className="trading-transaction-main">
                  {t.qty.toLocaleString("en-IN")} {t.symbol} @ {formatPrice(t.price)}
                </span>
                <span className="trading-transaction-total">{formatINR(t.total)}</span>
                {t.realizedPnl !== null && (
                  <span className={`trading-transaction-pnl ${t.realizedPnl >= 0 ? "good" : "bad"}`}>
                    {formatSignedINR(t.realizedPnl)}
                  </span>
                )}
                <span className="trading-transaction-time">{formatTimestamp(t.timestamp)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="trading-reset-row">
          {!confirmingReset ? (
            <button type="button" className="trading-reset-btn" onClick={() => setConfirmingReset(true)}>
              Reset portfolio
            </button>
          ) : (
            <div className="trading-reset-confirm">
              <span>Erase your portfolio and start over with {formatINR(getStartingBalance())}?</span>
              <button type="button" className="trading-reset-confirm-btn" onClick={handleReset}>
                Confirm reset
              </button>
              <button type="button" className="tapetide-gate-skip" onClick={() => setConfirmingReset(false)}>
                Cancel
              </button>
            </div>
          )}
        </div>

        <div className="calculator-disclaimer">
          Your portfolio and transaction history are saved only in this browser (localStorage) -- they
          are not tied to your account and won't follow you to another device or browser, and clearing
          this site's data will erase them. Starting balance is configurable in Settings.
        </div>
      </div>
    </div>
  );
}

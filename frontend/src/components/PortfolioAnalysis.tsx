import { useMemo, useState } from "react";
import type { Portfolio, Transaction } from "../lib/portfolio";
import type { LiveQuote } from "../lib/types";
import type { Theme } from "../hooks/useTheme";
import CoinAmount from "./CoinAmount";
import PortfolioValueChart from "./PortfolioValueChart";

interface AllocationRow {
  symbol: string;
  name: string;
  value: number;
  pct: number;
  color: string;
}

const CASH_KEY = "__cash__";
const CASH_COLOR = "var(--text-tertiary)";

// Golden-angle hue steps give every holding a visually distinct color with
// no fixed palette to run out of, however many stocks a portfolio ends up
// holding -- fixed saturation/lightness chosen to stay legible against
// both the dark and light --bg-elevated backgrounds this renders on.
function holdingColor(index: number): string {
  const hue = Math.round((index * 137.508) % 360);
  return `hsl(${hue}, 55%, 52%)`;
}

interface PortfolioAnalysisProps {
  portfolio: Portfolio;
  liveQuotes: Record<string, LiveQuote>;
  theme: Theme;
  totalValue: number;
  holdingsValue: number;
  totalPnl: number;
  totalPnlPct: number;
  // Lets clicking a holding in the allocation legend jump back to the
  // Trade tab with that stock already picked -- the same "click to focus
  // a stock" interaction the holdings table on the Trade tab already has.
  onSelectHolding: (symbol: string, name: string) => void;
}

export default function PortfolioAnalysis({
  portfolio,
  liveQuotes,
  theme,
  totalValue,
  holdingsValue,
  totalPnl,
  totalPnlPct,
  onSelectHolding,
}: PortfolioAnalysisProps) {
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);

  const stats = useMemo(() => {
    const sells = portfolio.transactions.filter(
      (t): t is Transaction & { realizedPnl: number } => t.type === "sell" && t.realizedPnl !== null
    );
    const realizedPnl = sells.reduce((sum, t) => sum + t.realizedPnl, 0);
    const costBasisHeld = portfolio.holdings.reduce((sum, h) => sum + h.qty * h.avgBuyPrice, 0);
    const unrealizedPnl = holdingsValue - costBasisHeld;
    const wins = sells.filter((t) => t.realizedPnl > 0).length;
    const winRate = sells.length > 0 ? (wins / sells.length) * 100 : null;
    const best = sells.reduce<(typeof sells)[number] | null>(
      (acc, t) => (!acc || t.realizedPnl > acc.realizedPnl ? t : acc),
      null
    );
    const worst = sells.reduce<(typeof sells)[number] | null>(
      (acc, t) => (!acc || t.realizedPnl < acc.realizedPnl ? t : acc),
      null
    );
    const distinctSymbols = new Set(portfolio.transactions.map((t) => t.symbol)).size;
    return {
      realizedPnl,
      unrealizedPnl,
      winRate,
      sellCount: sells.length,
      totalTrades: portfolio.transactions.length,
      best,
      worst,
      distinctSymbols,
    };
  }, [portfolio.transactions, portfolio.holdings, holdingsValue]);

  const allocation = useMemo<AllocationRow[]>(() => {
    const rows: { symbol: string; name: string; value: number; color: string }[] = portfolio.holdings.map(
      (h, i) => ({
        symbol: h.symbol,
        name: h.name,
        value: h.qty * (liveQuotes[h.symbol]?.price ?? h.avgBuyPrice),
        color: holdingColor(i),
      })
    );
    rows.push({ symbol: CASH_KEY, name: "Cash", value: portfolio.cash, color: CASH_COLOR });
    const total = rows.reduce((sum, r) => sum + r.value, 0);
    return rows
      .filter((r) => r.value > 0)
      .map((r) => ({ ...r, pct: total > 0 ? (r.value / total) * 100 : 0 }))
      .sort((a, b) => b.value - a.value);
  }, [portfolio.holdings, portfolio.cash, liveQuotes]);

  const hasAnyTrades = portfolio.transactions.length > 0;

  return (
    <div className="portfolio-analysis">
      {!hasAnyTrades ? (
        <div className="calculator-empty-hint">
          Buy your first stock on the Trade tab to start seeing your portfolio's performance here.
        </div>
      ) : (
        <>
          <div className="calculator-results trading-summary">
            <div className="calculator-result-tile">
              <div className="label">Total return</div>
              <div className={`value ${totalPnl >= 0 ? "good" : "bad"}`}>
                {totalPnlPct >= 0 ? "+" : ""}
                {totalPnlPct.toFixed(1)}%
              </div>
            </div>
            <div className="calculator-result-tile">
              <div className="label">Realized P&amp;L</div>
              <div className={`value ${stats.realizedPnl >= 0 ? "good" : "bad"}`}>
                <CoinAmount value={stats.realizedPnl} signed />
              </div>
            </div>
            <div className="calculator-result-tile">
              <div className="label">Unrealized P&amp;L</div>
              <div className={`value ${stats.unrealizedPnl >= 0 ? "good" : "bad"}`}>
                <CoinAmount value={stats.unrealizedPnl} signed />
              </div>
            </div>
            <div className="calculator-result-tile">
              <div className="label">Win rate</div>
              <div className="value">
                {stats.winRate !== null ? `${stats.winRate.toFixed(0)}%` : "--"}
              </div>
            </div>
            <div className="calculator-result-tile">
              <div className="label">Total trades</div>
              <div className="value">{stats.totalTrades}</div>
            </div>
            <div className="calculator-result-tile">
              <div className="label">Stocks traded</div>
              <div className="value">{stats.distinctSymbols}</div>
            </div>
          </div>
          {stats.winRate === null && (
            <div className="calculator-field-note">
              Win rate and best/worst closed trade appear once you've sold something -- unrealized gains on
              stocks you still hold don't count as a "win" yet.
            </div>
          )}

          {stats.best && (
            <div className="calculator-risk-rows portfolio-analysis-trade-rows">
              <div className={`calculator-risk-row ${stats.best.realizedPnl >= 0 ? "good" : "bad"}`}>
                <div className="calculator-risk-row-top">
                  <span className="calculator-risk-row-label">Best closed trade</span>
                  <span className={`calculator-risk-row-tier ${stats.best.realizedPnl >= 0 ? "good" : "bad"}`}>
                    <CoinAmount value={stats.best.realizedPnl} signed />
                  </span>
                </div>
                <div className="calculator-risk-row-value">
                  Sold {stats.best.qty.toLocaleString("en-IN")} {stats.best.symbol}
                </div>
              </div>
              {stats.worst && stats.worst.id !== stats.best.id && (
                <div className={`calculator-risk-row ${stats.worst.realizedPnl >= 0 ? "good" : "bad"}`}>
                  <div className="calculator-risk-row-top">
                    <span className="calculator-risk-row-label">Worst closed trade</span>
                    <span className={`calculator-risk-row-tier ${stats.worst.realizedPnl >= 0 ? "good" : "bad"}`}>
                      <CoinAmount value={stats.worst.realizedPnl} signed />
                    </span>
                  </div>
                  <div className="calculator-risk-row-value">
                    Sold {stats.worst.qty.toLocaleString("en-IN")} {stats.worst.symbol}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="calculator-field-header trading-section-header">
            <span>Portfolio value over time</span>
          </div>
          <PortfolioValueChart
            transactions={portfolio.transactions}
            startingBalance={portfolio.startingBalance}
            currentValue={totalValue}
            theme={theme}
          />
          <div className="calculator-field-note">
            Reconstructed from your real transaction log against each stock's real historical prices --
            not a live-tracked snapshot history, since this portfolio only ever stores its current state
            (see Settings/CLAUDE.md for why).
          </div>

          <div className="calculator-field-header trading-section-header">
            <span>Allocation</span>
          </div>
          <div className="portfolio-allocation">
            <div className={`portfolio-allocation-bar ${hoveredSymbol ? "has-hover" : ""}`}>
              {allocation.map((row) => (
                <div
                  key={row.symbol}
                  className={`portfolio-allocation-segment ${hoveredSymbol === row.symbol ? "highlighted" : ""}`}
                  style={{ width: `${row.pct}%`, backgroundColor: row.color }}
                  onMouseEnter={() => setHoveredSymbol(row.symbol)}
                  onMouseLeave={() => setHoveredSymbol(null)}
                  title={`${row.name}: ${row.pct.toFixed(1)}%`}
                />
              ))}
            </div>
            <div className="portfolio-allocation-legend">
              {allocation.map((row) => {
                const isCash = row.symbol === CASH_KEY;
                return (
                  <div
                    key={row.symbol}
                    className={`portfolio-allocation-row ${hoveredSymbol === row.symbol ? "highlighted" : ""}`}
                    role={isCash ? undefined : "button"}
                    tabIndex={isCash ? undefined : 0}
                    onMouseEnter={() => setHoveredSymbol(row.symbol)}
                    onMouseLeave={() => setHoveredSymbol(null)}
                    onClick={isCash ? undefined : () => onSelectHolding(row.symbol, row.name)}
                    onKeyDown={
                      isCash
                        ? undefined
                        : (e) => {
                            if (e.key === "Enter" || e.key === " ") onSelectHolding(row.symbol, row.name);
                          }
                    }
                    title={isCash ? undefined : `View ${row.name} on the Trade tab`}
                  >
                    <span className="portfolio-allocation-swatch" style={{ backgroundColor: row.color }} />
                    <span className="portfolio-allocation-name">{row.name}</span>
                    <span className="portfolio-allocation-pct">{row.pct.toFixed(1)}%</span>
                    <span className="portfolio-allocation-value">
                      <CoinAmount value={row.value} />
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

import { FormEvent, useEffect, useRef, useState } from "react";
import { fetchCompany, fetchPriceHistory, ApiError } from "../lib/api";
import { formatINR } from "../lib/format";
import QuotaCounter from "./QuotaCounter";
import SimulatorChart, { type SimPoint } from "./SimulatorChart";
import type { PricePoint, QuotaStatus } from "../lib/types";
import type { Theme } from "../hooks/useTheme";

type Horizon = 13 | 26 | 52 | 104;

const HORIZON_OPTIONS: { weeks: Horizon; label: string }[] = [
  { weeks: 13, label: "3 Months" },
  { weeks: 26, label: "6 Months" },
  { weeks: 52, label: "1 Year" },
  { weeks: 104, label: "2 Years" },
];

interface PickedStock {
  name: string;
  ticker: string;
  currentPrice: number | null;
  // ~5yr weekly closes (same series ReturnCalculator.tsx's volatility
  // calculation uses) -- this is the ONLY thing the simulation is derived
  // from: how much this specific stock has actually moved, week to week,
  // historically. Nothing about the simulated path itself is real.
  points: PricePoint[];
}

interface WeeklyStats {
  mu: number; // mean weekly log return
  sigma: number; // stddev of weekly log returns
}

// Same stat basis as ReturnCalculator.tsx's computeVolatility, but keeping
// log returns (not simple returns) and both moments (not just stddev) --
// geometric Brownian motion below needs mu and sigma separately, whereas
// the calculator only ever needed the single annualized volatility figure.
function computeWeeklyStats(points: PricePoint[]): WeeklyStats | null {
  if (points.length < 10) return null;
  const logReturns: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].close;
    const cur = points[i].close;
    if (prev > 0 && cur > 0) logReturns.push(Math.log(cur / prev));
  }
  if (logReturns.length < 8) return null;
  const mu = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance = logReturns.reduce((a, b) => a + (b - mu) ** 2, 0) / logReturns.length;
  return { mu, sigma: Math.sqrt(variance) };
}

// Box-Muller transform -- Math.random() alone is uniform, and a geometric
// random walk needs normally-distributed shocks.
function randomNormal(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Generates ONE random walk (geometric Brownian motion, the same model
// options-pricing theory uses for "a plausible future price path") seeded
// by the picked stock's own historical weekly drift/volatility. Calling
// this again with the same stats produces a completely different path --
// that unpredictability is the entire point of a simulator page, not a bug
// to average away. Not a forecast: nothing here claims this specific path
// is what will actually happen, only that its week-to-week jumpiness is
// statistically consistent with how this stock has actually moved before.
function simulatePath(startPrice: number, stats: WeeklyStats, weeks: Horizon): SimPoint[] {
  const path: SimPoint[] = [];
  const startDate = new Date();
  let price = startPrice;
  path.push({ time: startDate.toISOString().slice(0, 10), value: price });
  for (let i = 1; i <= weeks; i++) {
    const z = randomNormal();
    price = price * Math.exp(stats.mu - 0.5 * stats.sigma * stats.sigma + stats.sigma * z);
    const date = new Date(startDate.getTime() + i * 7 * 86_400_000);
    path.push({ time: date.toISOString().slice(0, 10), value: price });
  }
  return path;
}

function toNumber(raw: string): number {
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

interface StockMarketSimulatorProps {
  quota: QuotaStatus | null;
  onQuotaSpent: () => void;
  theme: Theme;
}

// The app's third top-level page (via Sidebar) -- a Monte Carlo "what
// might happen" game for a real, picked stock, distinct from Return
// Calculator's deterministic analyst-target projection. Picking a stock
// still costs real Tapetide quota (same fetchCompany + fetchPriceHistory
// call pair ReturnCalculator.tsx makes); re-running the simulation itself
// is pure client-side math and costs nothing.
export default function StockMarketSimulator({ quota, onQuotaSpent, theme }: StockMarketSimulatorProps) {
  const [stockQuery, setStockQuery] = useState("");
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);
  const [pickedStock, setPickedStock] = useState<PickedStock | null>(null);

  const [capital, setCapital] = useState("100000");
  const [horizon, setHorizon] = useState<Horizon>(26);

  const [path, setPath] = useState<SimPoint[] | null>(null);
  // The horizon the CURRENT `path` was actually generated for -- deliberately
  // separate from the live `horizon` toggle above. Changing the toggle
  // doesn't auto-regenerate (same "locked until you act" pattern as
  // ReturnCalculator.tsx's Time period field), so the results section below
  // must keep describing whatever `path` actually is, not whatever the
  // toggle currently says, or it'd mislabel an unchanged chart the moment
  // someone clicks a different horizon button without re-running.
  const [pathHorizon, setPathHorizon] = useState<Horizon | null>(null);
  const [revealedCount, setRevealedCount] = useState(1);
  const animationRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopAnimation() {
    if (animationRef.current) {
      clearInterval(animationRef.current);
      animationRef.current = null;
    }
  }

  // Draws the just-generated path left to right over ~2.2s (regardless of
  // horizon length) rather than dumping the whole line on-screen at once --
  // a static chart doesn't read as a "simulation," it reads as a chart.
  // Cleaned up on every new path and on unmount so a stale interval from a
  // previous run/stock can never keep ticking in the background.
  useEffect(() => {
    stopAnimation();
    if (!path) return;
    setRevealedCount(1);
    const totalSteps = path.length;
    const tickMs = Math.max(30, Math.round(2200 / totalSteps));
    animationRef.current = setInterval(() => {
      setRevealedCount((n) => {
        if (n >= totalSteps) {
          stopAnimation();
          return n;
        }
        return n + 1;
      });
    }, tickMs);
    return stopAnimation;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  function runSimulation(stock: PickedStock, weeks: Horizon) {
    const stats = stock.currentPrice ? computeWeeklyStats(stock.points) : null;
    if (!stats || !stock.currentPrice) {
      setPath(null);
      setPathHorizon(null);
      return;
    }
    setPath(simulatePath(stock.currentPrice, stats, weeks));
    setPathHorizon(weeks);
  }

  async function handlePickStock(e: FormEvent) {
    e.preventDefault();
    const query = stockQuery.trim();
    if (!query) return;
    setStockLoading(true);
    setStockError(null);
    try {
      const company = await fetchCompany(query);
      const history = await fetchPriceHistory(company.info.resolved_symbol);
      const stock: PickedStock = {
        name: company.info.company_name,
        ticker: company.info.resolved_symbol,
        currentPrice: company.raw.current_price,
        points: history.points,
      };
      setPickedStock(stock);
      setStockQuery("");
      runSimulation(stock, horizon);
    } catch (err) {
      setPickedStock(null);
      setStockError(err instanceof ApiError ? err.message : "Couldn't load that stock's price history.");
    } finally {
      setStockLoading(false);
      // Both calls spend real Tapetide quota -- see CLAUDE.md's "Sourcing"
      // section -- refresh even on failure, since a quota-exceeded response
      // still means calls were attempted.
      onQuotaSpent();
    }
  }

  function clearStock() {
    stopAnimation();
    setPickedStock(null);
    setPath(null);
    setPathHorizon(null);
    setStockError(null);
  }

  const capitalNum = Math.max(0, toNumber(capital));
  const shares = pickedStock?.currentPrice ? capitalNum / pickedStock.currentPrice : 0;

  const revealedPath = path?.slice(0, Math.max(1, revealedCount)) ?? null;
  const currentPoint = revealedPath ? revealedPath[revealedPath.length - 1] : null;
  const previousPoint = revealedPath && revealedPath.length > 1 ? revealedPath[revealedPath.length - 2] : null;
  const tickDirection = currentPoint && previousPoint ? (currentPoint.value >= previousPoint.value ? "good" : "bad") : null;

  const finalPoint = path ? path[path.length - 1] : null;
  const finalPortfolioValue = finalPoint ? shares * finalPoint.value : 0;
  const finalGain = finalPortfolioValue - capitalNum;
  const finalReturnPct = capitalNum > 0 ? (finalGain / capitalNum) * 100 : 0;
  const isAnimating = !!path && revealedCount < path.length;

  return (
    <div className="calculator-page">
      <div className="calculator-card simulator-card">
        <h2>Market Simulator</h2>
        <p className="calculator-subtitle">
          Watch a randomly generated "what if" price path for a real stock, built from its own
          historical volatility -- press "Run New Simulation" for a different possible outcome
          every time.
        </p>
        <p className="page-disclaimer">
          This is a randomly generated simulation, not a prediction -- it uses the picked stock's
          own past volatility to generate a hypothetical future price path, but every run produces
          a different result and none of them are a forecast of what will actually happen. Stackly
          holds no liability for any financial decisions made using this simulation. Not investment
          advice.
        </p>

        <div className="calculator-stock-picker">
          <div className="calculator-field-header">
            <span>Pick the stock you want to simulate</span>
            {quota && <QuotaCounter quota={quota} />}
          </div>
          {pickedStock ? (
            <div className="calculator-stock-chip">
              <span>
                {pickedStock.name} <span className="calculator-stock-chip-ticker">{pickedStock.ticker}</span>
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
                aria-label="Search a stock to simulate"
              />
              <button type="submit" disabled={stockLoading || !stockQuery.trim()}>
                {stockLoading ? "Loading..." : "Use"}
              </button>
            </form>
          )}
          {stockError && <div className="calculator-stock-error">{stockError}</div>}
        </div>

        {!pickedStock && <div className="calculator-empty-hint">Pick a stock above to start simulating.</div>}

        {pickedStock && (
          <>
            <div className="calculator-form">
              <label className="calculator-field">
                <span>Starting capital</span>
                <div className="calculator-input-wrap">
                  <span className="calculator-input-prefix">₹</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="1000"
                    value={capital}
                    onChange={(e) => setCapital(e.target.value)}
                    aria-label="Starting capital in rupees"
                  />
                </div>
              </label>

              <div className="calculator-field">
                <div className="calculator-field-header">
                  <span>Simulation horizon</span>
                </div>
                <div className="calculator-mode-toggle" role="group" aria-label="Simulation horizon">
                  {HORIZON_OPTIONS.map((opt) => (
                    <button
                      key={opt.weeks}
                      type="button"
                      className={horizon === opt.weeks ? "active" : ""}
                      onClick={() => setHorizon(opt.weeks)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              type="button"
              className="search-button simulator-run-button"
              onClick={() => runSimulation(pickedStock, horizon)}
            >
              {/* A die, not a generic arrow/refresh glyph -- reinforces this
                  page's actual identity (chance-driven, a different result
                  every click) rather than reading as just another "submit"
                  button that happens to say "Simulation." */}
              <svg
                className="simulator-run-icon"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <rect x="3.5" y="3.5" width="17" height="17" rx="4" stroke="currentColor" strokeWidth="1.8" />
                <circle cx="8.2" cy="8.2" r="1.4" fill="currentColor" />
                <circle cx="15.8" cy="8.2" r="1.4" fill="currentColor" />
                <circle cx="12" cy="12" r="1.4" fill="currentColor" />
                <circle cx="8.2" cy="15.8" r="1.4" fill="currentColor" />
                <circle cx="15.8" cy="15.8" r="1.4" fill="currentColor" />
              </svg>
              {path ? "Run New Simulation" : "Run Simulation"}
            </button>

            {!path && (
              <div className="calculator-field-note">
                Not enough price history for {pickedStock.ticker} to run a simulation.
              </div>
            )}

            {path && (
              <>
                <div className="price-chart-card simulator-chart-card">
                  <div className="price-chart-header">
                    <h3>{pickedStock.ticker} -- simulated path</h3>
                    {currentPoint && (
                      <span className={`price-chart-change ${tickDirection ?? ""}`}>
                        {formatINR(currentPoint.value)}
                        {isAnimating ? " (simulating...)" : ""}
                      </span>
                    )}
                  </div>
                  <SimulatorChart points={path} revealedCount={revealedCount} theme={theme} />
                </div>

                <div className="calculator-field-header">
                  <span>Simulated outcome after {HORIZON_OPTIONS.find((o) => o.weeks === pathHorizon)?.label}</span>
                </div>
                <div className="calculator-results">
                  <div className="calculator-result-tile">
                    <div className="label">Portfolio value</div>
                    <div className="value">{formatINR(finalPortfolioValue)}</div>
                  </div>
                  <div className="calculator-result-tile">
                    <div className="label">Total gain</div>
                    <div className={`value ${finalGain >= 0 ? "good" : "bad"}`}>{formatINR(finalGain)}</div>
                  </div>
                  <div className="calculator-result-tile">
                    <div className="label">Total return</div>
                    <div className={`value ${finalReturnPct >= 0 ? "good" : "bad"}`}>
                      {finalReturnPct >= 0 ? "+" : ""}
                      {finalReturnPct.toFixed(1)}%
                    </div>
                  </div>
                </div>
                <div className="calculator-field-note">
                  Simulated using {pickedStock.ticker}'s own historical week-to-week volatility -- a
                  different random path every time this is run, not a real prediction of{" "}
                  {pickedStock.ticker}'s actual future price.
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

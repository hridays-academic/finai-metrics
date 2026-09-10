import { FormEvent, useEffect, useMemo, useState } from "react";
import { fetchCompany, fetchPriceHistory, ApiError } from "../lib/api";
import { formatINR } from "../lib/format";
import QuotaCounter from "./QuotaCounter";
import GrowthChart from "./GrowthChart";
import type { MetricGroup, MetricStatus, PricePoint, QuotaStatus } from "../lib/types";
import type { Theme } from "../hooks/useTheme";

type PeriodUnit = "day" | "month" | "year" | "decade";

const UNIT_TO_YEARS: Record<PeriodUnit, number> = {
  day: 1 / 365.25,
  month: 1 / 12,
  year: 1,
  decade: 10,
};

// Lowercase, always-plural -- matches the <select>'s own always-plural
// option labels ("Days", "Months", ...) rather than adding singular/plural
// grammar logic for a label that's purely informational.
const PERIOD_UNIT_LABEL: Record<PeriodUnit, string> = {
  day: "days",
  month: "months",
  year: "years",
  decade: "decades",
};

type InvestmentMode = "amount" | "shares";

interface AnalystTargets {
  low: number;
  mean: number;
  high: number;
  period: string | null;
  // "YYYY-MM-DD" -- lets computeForecastRate turn the mean target into an
  // annualized rate (needs to know how far out the target actually is).
  targetDate: string | null;
}

interface PickedStock {
  name: string;
  ticker: string;
  points: PricePoint[];
  currentPrice: number | null;
  // Real third-party analyst price target (Tapetide), same Low/Mean/High
  // figures PriceForecastChart plots on the main search page -- null if
  // this stock has no analyst coverage. Never fabricated: if Tapetide
  // doesn't have a target for this stock, this stays null and the scenario
  // section below just doesn't render, same "no data unavailable" principle
  // as everywhere else in the app.
  analystTargets: AnalystTargets | null;
  // Same computed ratios (debt_to_equity, current_ratio, roe, ...) that
  // power the main search page's metric cards + Health Snapshot -- reused
  // for the Risk Profile section below rather than re-deriving our own
  // numbers, so it's the exact same trusted computation, not a duplicate.
  metricGroups: MetricGroup[];
}

interface ProjectionRate {
  // TRUE compound-annual rate (CAGR) -- always a real per-year figure, never
  // floored/faked. This is what the Time Period compounding math
  // (`p * (1+ratePct/100)^periodInYears`) actually uses, so an arbitrary
  // Time Period selection always compounds coherently -- see the comment on
  // computeForecastRate for why a non-true-annual rate broke that.
  ratePct: number;
  // The real, NON-annualized return actually observed/implied over
  // `spanYears` -- i.e. what you'd literally see if you looked at the two
  // endpoints with no extrapolation. Equal to ratePct when spanYears is
  // exactly 1; smaller than ratePct whenever spanYears < 1, since ratePct
  // is then an extrapolated full-year pace of a shorter real move. Shown
  // alongside ratePct specifically so a sub-1yr analyst target's headline
  // annualized number is never presented without the real figure it was
  // stretched from.
  rawPct: number;
  spanYears: number;
  // The calendar year this rate reflects (e.g. 2025) -- only set when
  // source is "historical"; see computeHistoricalRate for why the rate is
  // now a fixed Jan-Dec window instead of a rolling trailing-365-days one.
  year?: number;
  // "historical": the stock's own actual price return during the most
  // recently fully completed calendar year -- the default and primary
  // basis (see computeProjectionRate). "forecast": annualized from the
  // analyst consensus mean target -- fallback only, used when a stock
  // doesn't have enough price history to compute a historical rate (e.g. a
  // very recent listing). The two are never blended.
  source: "forecast" | "historical";
}

// Finds the price point closest to `targetDate`, clamping to the oldest
// point if the requested lookback goes further back than the data covers
// (Tapetide/yfinance give ~5yr weekly + ~6-7mo daily, never a full decade+).
function closestPoint(series: PricePoint[], targetTime: number): PricePoint {
  let closest = series[0];
  let minDiff = Infinity;
  for (const p of series) {
    const diff = Math.abs(new Date(p.date).getTime() - targetTime);
    if (diff < minDiff) {
      minDiff = diff;
      closest = p;
    }
  }
  return closest;
}

// Fallback rate source, used only when a stock doesn't have enough price
// history for computeHistoricalRate below to compute a completed-calendar-
// year return from (a very recently listed stock). Annualizes the analyst
// consensus mean target from today to the target date -- forward-looking,
// same direction as the "Analyst price target scenario" section below,
// which uses the same mean target. NOT the primary source anymore -- see
// computeProjectionRate for why real historical performance is preferred
// (annualizing a sub-1yr analyst horizon, even honestly, kept producing
// numbers that read as too high relative to what the stock has actually
// done -- a real, repeated, user-reported problem).
function computeForecastRate(stock: PickedStock): ProjectionRate | null {
  const targets = stock.analystTargets;
  const basePrice = stock.currentPrice;
  if (!targets || !targets.targetDate || !basePrice || basePrice <= 0 || targets.mean <= 0) return null;

  const targetTime = new Date(targets.targetDate).getTime();
  const spanYears = (targetTime - Date.now()) / (365.25 * 86_400_000);
  if (spanYears <= 0) return null; // a target date that's already passed -- don't divide by ~0

  // True CAGR -- see the ProjectionRate.ratePct comment for why this must
  // stay a real per-year figure (a floored/capped version broke the Time
  // Period compounding math for any period other than ~this exact span, a
  // real, confirmed bug: RELIANCE's ~27% raw upside to its ~0.64yr-out
  // target, compounded over a 1.5yr Time Period at a FLOORED rate, produced
  // a nonsensical ~45% total return that didn't match the rate shown OR the
  // real target move). rawPct is the real, non-extrapolated move to the
  // actual target date -- shown alongside ratePct in the UI so the
  // annualized figure is never presented without the number it was
  // stretched from.
  const rawPct = (targets.mean / basePrice - 1) * 100;
  const ratePct = (Math.pow(targets.mean / basePrice, 1 / spanYears) - 1) * 100;
  return { ratePct, rawPct, spanYears, source: "forecast" };
}

// Primary rate source for the main projection tiles: the stock's ACTUAL
// price return during the most recently fully completed calendar year
// (Jan 1 -- Dec 31), not a rolling trailing-365-days-from-today window.
// Switched from a rolling window (2026-08) after a real, confirmed user
// report: RELIANCE's rolling trailing-12-months figure was -6.84% (matches
// Tapetide's own live public "1Y" chart) at the same time its 2025 calendar
// year alone was a real, Google-confirmed +29% -- the stock rallied hard
// through 2025 and gave a lot of it back in a 2026 pullback, so BOTH
// figures are simultaneously true; they just answer different questions.
// A rolling window's answer silently changes depending on what day you
// happen to look, which reads as "wrong" the moment it lands right after a
// pullback -- a fixed Jan-Dec window is unambiguous and doesn't have that
// problem. (Still preferred over the analyst-forecast rate below for the
// original reason that landed here first: annualizing a sub-1yr analyst
// target kept producing headline numbers implausibly high next to a
// stock's real performance.)
function computeHistoricalRate(stock: PickedStock): ProjectionRate | null {
  const series = stock.points;
  if (series.length < 1) return null;

  const completedYear = new Date().getFullYear() - 1;
  const startTarget = new Date(completedYear, 0, 1).getTime();
  const endTarget = new Date(completedYear, 11, 31).getTime();

  // If the series doesn't reach back to the start of that year at all (a
  // recently-listed stock), don't compute a misleading partial-year
  // "calendar year return" -- fall back to the analyst-forecast rate
  // instead (see computeProjectionRate).
  const earliestTime = new Date(series[0].date).getTime();
  if (startTarget < earliestTime) return null;

  const startPoint = closestPoint(series, startTarget);
  const endPoint = closestPoint(series, endTarget);
  const startTime = new Date(startPoint.date).getTime();
  const endTime = new Date(endPoint.date).getTime();

  const spanYears = (endTime - startTime) / (365.25 * 86_400_000);
  if (spanYears <= 0 || startPoint.close <= 0) return null;

  // True CAGR -- see ProjectionRate.ratePct. rawPct is the real move over
  // the actual matched window (always very close to a full year here,
  // since both endpoints are pinned to real calendar-year boundaries).
  const rawPct = (endPoint.close / startPoint.close - 1) * 100;
  const ratePct = (Math.pow(endPoint.close / startPoint.close, 1 / spanYears) - 1) * 100;
  return { ratePct, rawPct, spanYears, year: completedYear, source: "historical" };
}

// Trailing historical performance first -- see computeHistoricalRate for
// why this is now the default. Only falls back to the analyst-forecast
// rate when a stock genuinely doesn't have enough price history yet (a
// very recent listing).
function computeProjectionRate(stock: PickedStock): ProjectionRate | null {
  return computeHistoricalRate(stock) ?? computeForecastRate(stock);
}

function toNumber(raw: string): number {
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function findMetric(groups: MetricGroup[], key: string) {
  for (const g of groups) {
    const m = g.metrics.find((metric) => metric.key === key);
    if (m) return m;
  }
  return undefined;
}

interface RiskFactor {
  key: string;
  label: string;
  tone: MetricStatus;
  tier: string;
  valueText: string;
  note: string;
}

// Per-factor tier wording -- "High leverage"/"High volatility" read
// naturally, but "High liquidity risk" doesn't, so each factor gets its own
// good/warning/bad -> word mapping instead of one shared risk-tier label.
const TIER_LABELS: Record<string, Record<MetricStatus, string>> = {
  leverage: { good: "Low", warning: "Moderate", bad: "High", neutral: "N/A" },
  volatility: { good: "Low", warning: "Moderate", bad: "High", neutral: "N/A" },
  liquidity: { good: "Strong", warning: "Moderate", bad: "Weak", neutral: "N/A" },
  profitability: { good: "Strong", warning: "Moderate", bad: "Weak", neutral: "N/A" },
};

function fromMetric(factorKey: keyof typeof TIER_LABELS, label: string, groups: MetricGroup[], metricKey: string): RiskFactor {
  const metric = findMetric(groups, metricKey);
  const status: MetricStatus = metric?.status ?? "neutral";
  const valueText =
    metric?.value !== null && metric?.value !== undefined
      ? `${metric.label}: ${metric.value.toFixed(2)}${metric.unit}`
      : `${label}: data unavailable`;
  return {
    key: factorKey,
    label,
    tone: status,
    tier: TIER_LABELS[factorKey][status],
    valueText,
    note: metric?.assessment || "",
  };
}

interface Volatility {
  annualizedPct: number;
  years: number;
  tone: MetricStatus;
}

// Annualized standard deviation of weekly returns -- a standard, widely-used
// volatility measure, computed purely from the same price history already
// fetched for the historical-rate calculation above. Thresholds (20%/35%)
// are a rough, commonly-cited convention for "low/moderate/high" equity
// volatility, not a precise scientific cutoff -- the real number is always
// shown alongside the label so it's never an unexplained qualitative claim.
function computeVolatility(points: PricePoint[]): Volatility | null {
  if (points.length < 10) return null;
  const returns: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].close;
    if (prev > 0) returns.push((points[i].close - prev) / prev);
  }
  if (returns.length < 8) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  const annualizedPct = Math.sqrt(variance) * Math.sqrt(52) * 100;
  const years = (new Date(points[points.length - 1].date).getTime() - new Date(points[0].date).getTime()) / (365.25 * 86_400_000);
  const tone: MetricStatus = annualizedPct < 20 ? "good" : annualizedPct < 35 ? "warning" : "bad";
  return { annualizedPct, years, tone };
}

interface ReturnCalculatorProps {
  // Same QuotaStatus/refresh function App.tsx feeds CompanySearch -- one
  // shared source of truth (via QuotaCounter, the same component both pages
  // render) so the two pages' counters can never drift out of sync with
  // each other or with the real count.
  quota: QuotaStatus | null;
  onQuotaSpent: () => void;
  theme: Theme;
}

export default function ReturnCalculator({ quota, onQuotaSpent, theme }: ReturnCalculatorProps) {
  const [principal, setPrincipal] = useState("100000");
  const [shares, setShares] = useState("100");
  const [investmentMode, setInvestmentMode] = useState<InvestmentMode>("amount");
  const [rate, setRate] = useState("12");
  const [periodValue, setPeriodValue] = useState("10");
  const [periodUnit, setPeriodUnit] = useState<PeriodUnit>("year");

  const [stockQuery, setStockQuery] = useState("");
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);
  const [pickedStock, setPickedStock] = useState<PickedStock | null>(null);
  const [projectionRate, setProjectionRate] = useState<ProjectionRate | null>(null);

  // "Shares" mode only makes sense once we know a real share price to
  // convert against -- falls back to "amount" automatically if there's no
  // stock (or the stock somehow has no current price) rather than showing a
  // dead/meaningless input.
  const sharesModeAvailable = !!pickedStock?.currentPrice;
  const effectiveMode: InvestmentMode = investmentMode === "shares" && sharesModeAvailable ? "shares" : "amount";

  const p =
    effectiveMode === "shares"
      ? Math.max(0, toNumber(shares)) * (pickedStock!.currentPrice as number)
      : Math.max(0, toNumber(principal));
  const r = toNumber(rate);
  const periodInYears = Math.max(0, toNumber(periodValue)) * UNIT_TO_YEARS[periodUnit];

  // Re-derive the picked stock's projection rate whenever the picked stock
  // changes, and feed it straight into the rate field -- this is the ONLY
  // thing that sets `rate` now (the field is read-only, see below), so a
  // null result must reset it to "0" rather than silently leaving behind a
  // stale number computed for a different stock. Deliberately NOT
  // re-derived when the time period changes (see computeHistoricalRate's
  // comment) -- whichever source is used, it's a fixed annualized figure,
  // independent of how far forward the user is projecting.
  useEffect(() => {
    if (!pickedStock) {
      setProjectionRate(null);
      return;
    }
    const result = computeProjectionRate(pickedStock);
    setProjectionRate(result);
    setRate(result ? result.ratePct.toFixed(1) : "0");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedStock]);

  async function handlePickStock(e: FormEvent) {
    e.preventDefault();
    const query = stockQuery.trim();
    if (!query) return;
    setStockLoading(true);
    setStockError(null);
    try {
      const company = await fetchCompany(query);
      const history = await fetchPriceHistory(company.info.resolved_symbol);
      const consensus = company.analyst_consensus;
      const analystTargets: AnalystTargets | null =
        consensus && consensus.target_low !== null && consensus.target_mean !== null && consensus.target_high !== null
          ? {
              low: consensus.target_low,
              mean: consensus.target_mean,
              high: consensus.target_high,
              period: consensus.target_period,
              targetDate: consensus.target_date,
            }
          : null;
      setPickedStock({
        name: company.info.company_name,
        ticker: company.info.resolved_symbol,
        points: history.points,
        currentPrice: company.raw.current_price,
        analystTargets,
        metricGroups: company.metric_groups,
      });
      setStockQuery("");
    } catch (err) {
      setPickedStock(null);
      setStockError(err instanceof ApiError ? err.message : "Couldn't load that stock's price history.");
    } finally {
      setStockLoading(false);
      // Both fetchCompany and fetchPriceHistory spend real Tapetide quota
      // (see CLAUDE.md's "Hybrid sourcing") -- refresh even on failure,
      // since a quota-exceeded response still means calls were attempted.
      onQuotaSpent();
    }
  }

  function clearStock() {
    setPickedStock(null);
    setProjectionRate(null);
    setStockError(null);
    setInvestmentMode("amount");
  }

  const futureValue = p * Math.pow(1 + r / 100, periodInYears);
  const gain = futureValue - p;
  const returnPct = p > 0 ? (gain / p) * 100 : 0;

  // The actual p*(1+r)^t curve, sampled at real calendar dates from today
  // to the projected end date -- the same rate/period the tiles above
  // already compute from, just shown as a curve instead of only the two
  // endpoints. Capped at 60 samples regardless of how long the period is
  // (a multi-decade projection doesn't need daily resolution to read as a
  // smooth curve, and lightweight-charts' time axis only needs enough
  // points to draw one).
  const growthPoints = useMemo(() => {
    if (p <= 0 || periodInYears <= 0) return [];
    const steps = Math.min(60, Math.max(12, Math.round(periodInYears * 12)));
    const today = new Date();
    const points: { time: string; value: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      const tYears = (periodInYears * i) / steps;
      const d = new Date(today);
      d.setDate(d.getDate() + Math.round(tYears * 365.25));
      points.push({ time: d.toISOString().slice(0, 10), value: p * Math.pow(1 + r / 100, tYears) });
    }
    return points;
  }, [p, r, periodInYears]);

  // Still read for the projection-rate note's "(FY2027 ...)" aside below
  // (see computeForecastRate/computeHistoricalRate) even though the
  // standalone "Analyst price target scenario" section that used to read
  // low/mean/high off this was removed at the user's request -- it read as
  // a useless, disconnected estimate sitting below the real projection.
  const targets = pickedStock?.analystTargets;

  // Deliberately 4 independent factors, not one combined "overall risk"
  // score -- each is real, separately-sourced data (3 already-computed
  // ratios reused from the main search page, 1 volatility stat computed
  // from real price history), and honestly mixed results (some good, some
  // bad) are the point, not something to average away into a single verdict.
  const volatility = pickedStock ? computeVolatility(pickedStock.points) : null;
  const riskFactors: RiskFactor[] | null = pickedStock
    ? [
        fromMetric("leverage", "Leverage", pickedStock.metricGroups, "debt_to_equity"),
        fromMetric("liquidity", "Liquidity", pickedStock.metricGroups, "current_ratio"),
        fromMetric("profitability", "Profitability", pickedStock.metricGroups, "roe"),
        volatility
          ? {
              key: "volatility",
              label: "Price Volatility",
              tone: volatility.tone,
              tier: TIER_LABELS.volatility[volatility.tone],
              valueText: `${volatility.annualizedPct.toFixed(1)}% annualized (${volatility.years.toFixed(1)}yr history)`,
              note:
                volatility.tone === "good"
                  ? "Price has moved relatively steadily over its available history."
                  : volatility.tone === "warning"
                    ? "Price has swung by a moderate amount over its available history."
                    : "Price has swung sharply over its available history.",
            }
          : {
              key: "volatility",
              label: "Price Volatility",
              tone: "neutral",
              tier: "N/A",
              valueText: "Price Volatility: not enough price history",
              note: "",
            },
      ]
    : null;

  return (
    <div className="calculator-page">
      <div className="calculator-card">
        <h2>Return Calculator</h2>
        <p className="calculator-subtitle">
          Estimate how a lump-sum investment could grow, based on a real stock's analyst
          price target (or its own historical return, if it has no analyst coverage).
        </p>
        <p className="page-disclaimer">
          Stackly provides financial data and educational information only. Any financial decisions
          you make using data from this site are your own responsibility -- the site and its
          owner(s) accept no liability for outcomes resulting from its use.
        </p>

        <div className="calculator-stock-picker">
          <div className="calculator-field-header">
            <span>Pick the stock you want to calculate</span>
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
                aria-label="Search a stock to personalize this calculator"
              />
              <button type="submit" disabled={stockLoading || !stockQuery.trim()}>
                {stockLoading ? "Loading..." : "Use"}
              </button>
            </form>
          )}
          {stockError && <div className="calculator-stock-error">{stockError}</div>}
        </div>

        {!pickedStock && <div className="calculator-empty-hint">Pick a stock above to start calculating.</div>}

        {pickedStock && (
          <>
            <div className="calculator-form">
              {/* Not a <label> (unlike the other fields below) since it wraps
                  two controls -- the mode toggle and the amount/shares input --
                  rather than one, which is what <label> click-forwarding assumes. */}
              <div className="calculator-field">
                <div className="calculator-field-header">
                  <span>Investment</span>
                  <div className="calculator-mode-toggle" role="group" aria-label="Enter investment as">
                    <button
                      type="button"
                      className={effectiveMode === "amount" ? "active" : ""}
                      onClick={() => setInvestmentMode("amount")}
                    >
                      Amount
                    </button>
                    <button
                      type="button"
                      className={effectiveMode === "shares" ? "active" : ""}
                      onClick={() => setInvestmentMode("shares")}
                      disabled={!sharesModeAvailable}
                      title={sharesModeAvailable ? undefined : "Price data unavailable for this stock"}
                    >
                      Shares
                    </button>
                  </div>
                </div>
                {effectiveMode === "amount" ? (
                  <div className="calculator-input-wrap">
                    <span className="calculator-input-prefix">₹</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="1000"
                      value={principal}
                      onChange={(e) => setPrincipal(e.target.value)}
                      aria-label="Investment amount in rupees"
                    />
                  </div>
                ) : (
                  <div className="calculator-input-wrap">
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="1"
                      value={shares}
                      onChange={(e) => setShares(e.target.value)}
                      aria-label="Number of shares"
                    />
                    <span className="calculator-input-suffix">shares</span>
                  </div>
                )}
                {effectiveMode === "shares" && pickedStock.currentPrice && (
                  <span className="calculator-field-note">
                    {Math.max(0, toNumber(shares)).toLocaleString("en-IN")} shares &times; {pickedStock.ticker}'s
                    current price ({formatINR(pickedStock.currentPrice)}/share) = {formatINR(p)}
                  </span>
                )}
              </div>

              <label className="calculator-field">
                <span>
                  {pickedStock.ticker}'s annual return
                  {projectionRate?.source === "historical"
                    ? ` (${projectionRate.year} calendar-year performance)`
                    : " (analyst-implied)"}
                </span>
                <div
                  className="calculator-input-wrap locked"
                  title={
                    projectionRate?.source === "historical"
                      ? "Computed from the stock's real, completed calendar-year price performance -- not editable"
                      : "Computed from the analyst consensus price target -- not editable"
                  }
                >
                  <input type="number" value={rate} readOnly tabIndex={-1} />
                  <span className="calculator-input-suffix">%</span>
                  <svg
                    className="calculator-lock-icon"
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true"
                  >
                    <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M8 11V7.5a4 4 0 1 1 8 0V11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </div>
                {projectionRate ? (
                  <span className="calculator-field-note">
                    {projectionRate.source === "historical" ? (
                      <>
                        This rate is {pickedStock.ticker}'s actual price return during {projectionRate.year} (Jan 1
                        -- Dec 31) -- not an analyst forecast, not a rolling trailing-12-months figure, and not a
                        prediction of future performance.
                      </>
                    ) : (
                      <>
                        Not enough price history yet for {pickedStock.ticker} to calculate a trailing return --
                        using analysts' mean price target for {pickedStock.ticker}
                        {targets?.period ? ` (${targets.period})` : ""} instead, annualized to a full year.
                        {projectionRate.spanYears < 1 && (
                          <>
                            {" "}
                            The target itself is only {Math.round(projectionRate.spanYears * 365)} days away and
                            implies a {projectionRate.rawPct >= 0 ? "+" : ""}
                            {projectionRate.rawPct.toFixed(1)}% move by then -- the rate above is that pace
                            stretched to a full year, not a claim it continues at that speed.
                          </>
                        )}
                      </>
                    )}
                  </span>
                ) : (
                  <span className="calculator-field-note">
                    Not enough data for {pickedStock.ticker} to compute this.
                  </span>
                )}
              </label>

              <label className="calculator-field">
                <span>Time period</span>
                <div className="calculator-input-wrap">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="1"
                    value={periodValue}
                    onChange={(e) => setPeriodValue(e.target.value)}
                  />
                  {/* Looks like plain text until hover/focus, then reveals it's a
                      real dropdown (background + border + chevron fade in) --
                      Day/Month/Year/Decade all convert to a fractional-year
                      exponent for the same compound-growth formula. */}
                  <div className="calculator-period-unit">
                    <select
                      value={periodUnit}
                      onChange={(e) => setPeriodUnit(e.target.value as PeriodUnit)}
                      aria-label="Time period unit"
                    >
                      <option value="day">Days</option>
                      <option value="month">Months</option>
                      <option value="year">Years</option>
                      <option value="decade">Decades</option>
                    </select>
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                      <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>
              </label>
            </div>

            {/* Labeled with its own horizon for the same reason the
                scenario section below labels "for FY2027..." -- this
                section projects the rate above (now forecast-derived
                when available, see computeProjectionRate) over whatever
                "Time period" was typed here, while the scenario section
                below always shows the actual, non-extrapolated analyst
                target at its own real (fixed) target date. Making both
                horizons visible side by side is what makes the two
                sections' numbers comparable at a glance, instead of
                silently using different timeframes. */}
            <div className="calculator-field-header growth-chart-header">
              <span>
                Projected over {Math.max(0, toNumber(periodValue)).toLocaleString("en-IN")}{" "}
                {PERIOD_UNIT_LABEL[periodUnit]}
              </span>
            </div>
            {growthPoints.length > 1 && (
              <div className="growth-chart-card">
                <GrowthChart points={growthPoints} theme={theme} />
              </div>
            )}
            <div className="calculator-results">
              <div className="calculator-result-tile">
                <div className="label">Future value</div>
                <div className="value">{formatINR(futureValue)}</div>
              </div>
              <div className="calculator-result-tile">
                <div className="label">Total gain</div>
                <div className={`value ${gain >= 0 ? "good" : "bad"}`}>{formatINR(gain)}</div>
              </div>
              <div className="calculator-result-tile">
                <div className="label">Total return</div>
                <div className={`value ${returnPct >= 0 ? "good" : "bad"}`}>
                  {returnPct >= 0 ? "+" : ""}
                  {returnPct.toFixed(1)}%
                </div>
              </div>
            </div>

            {riskFactors && (
              <div className="calculator-risk-section">
                <div className="calculator-field-header">
                  <span>Risk profile</span>
                </div>
                <div className="calculator-risk-rows">
                  {riskFactors.map((f) => (
                    <div className={`calculator-risk-row ${f.tone}`} key={f.key}>
                      <div className="calculator-risk-row-top">
                        <span className="calculator-risk-row-label">{f.label}</span>
                        <span className="calculator-risk-row-tier">{f.tier}</span>
                      </div>
                      <div className="calculator-risk-row-value">{f.valueText}</div>
                      {f.note && <p className="calculator-risk-row-note">{f.note}</p>}
                    </div>
                  ))}
                </div>
                <div className="calculator-field-note">
                  Based on {pickedStock.ticker}'s fundamental ratios and historical price volatility only --
                  intentionally not all positive when the underlying numbers aren't. Not a recommendation to
                  buy, sell, or hold, and not a prediction of future risk or return.
                </div>
              </div>
            )}

            <div className="calculator-disclaimer">
              {projectionRate?.source === "forecast" ? (
                <>
                  The rate above is implied by third-party analysts' price target for {pickedStock.ticker}, not
                  Stackly's own view -- analyst targets are estimates and frequently don't play out. Not
                  investment advice.
                </>
              ) : (
                <>
                  The rate above is computed from {pickedStock.ticker}'s actual past prices, but past performance
                  never guarantees future returns. Not investment advice.
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

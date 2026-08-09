import { FormEvent, useEffect, useState } from "react";
import { fetchCompany, fetchPriceHistory, ApiError } from "../lib/api";
import { formatINR } from "../lib/format";
import QuotaCounter from "./QuotaCounter";
import type { MetricGroup, MetricStatus, PricePoint, QuotaStatus } from "../lib/types";

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
  ratePct: number;
  spanYears: number;
  clamped: boolean; // true if we didn't have enough history and used the oldest point available
  // False when spanYears < 1 and the exponent below was floored at 1yr
  // instead of the real (shorter) span -- see the comment on
  // computeForecastRate for why. When false, `ratePct` is the real,
  // un-extrapolated return over `spanYears`, not a true annual rate.
  annualized: boolean;
  // "forecast": annualized from the analyst consensus mean target (what
  // sell-side analysts expect going forward). "historical": annualized
  // from the stock's own trailing 1yr price history -- only used as a
  // fallback when a stock has no analyst coverage to derive a forecast
  // rate from. The two are never blended -- see computeProjectionRate.
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

// Preferred rate source for the main projection tiles: the analyst
// consensus mean target, annualized from today to the target date. This is
// forward-looking, same direction as the "Analyst price target scenario"
// section below (which uses the same mean target) -- so the main tiles and
// that section can no longer point in opposite directions the way a
// trailing *historical* rate could (a stock can easily have had a down
// year while analysts expect a recovery, which produced exactly that
// "why is my gain negative when the forecast is positive" confusion in
// practice). Only used when a target date + mean target both exist; falls
// back to computeHistoricalRate otherwise (some stocks have no analyst
// coverage at all -- see AnalystTargets).
function computeForecastRate(stock: PickedStock): ProjectionRate | null {
  const targets = stock.analystTargets;
  const basePrice = stock.currentPrice;
  if (!targets || !targets.targetDate || !basePrice || basePrice <= 0 || targets.mean <= 0) return null;

  const targetTime = new Date(targets.targetDate).getTime();
  const spanYears = (targetTime - Date.now()) / (365.25 * 86_400_000);
  if (spanYears <= 0) return null; // a target date that's already passed -- don't divide by ~0

  // Analyst target dates are typically well under a year out (Tapetide's
  // target_period is usually ~7-10 months away, see CLAUDE.md) -- compounding
  // that partial-year move up to a full-year pace massively overstates it,
  // the exact same "short window -> inflated CAGR" distortion
  // computeHistoricalRate below already guards against (a real, confirmed
  // case: RELIANCE's ~28% raw upside to its ~0.64yr-out target compounded to
  // a headline ~47% "annual return"). Flooring the exponent's denominator at
  // 1 year means a sub-1yr target's real, un-extrapolated return is used
  // as-is instead of being stretched into a fictitious annual pace; spans of
  // a year or more are unaffected and still get real annualization.
  const annualized = spanYears >= 1;
  const ratePct = (Math.pow(targets.mean / basePrice, 1 / Math.max(spanYears, 1)) - 1) * 100;
  return { ratePct, spanYears, clamped: false, annualized, source: "forecast" };
}

// Fallback rate source, used only when a stock has no analyst coverage to
// derive computeForecastRate from. Fixed ~1-year lookback, deliberately
// NOT tied to whatever "Time period" the user is projecting forward with
// -- it used to be (targetDays = periodInYears * 365.25), which was a real
// bug: picking a short projection period like "1 Month" made this
// annualize a mere 30-day price window, and CAGR math massively amplifies
// short-term noise over a short window (a perfectly real ~7% move over 30
// days compounds to a headline "133% annual return"). A trailing 1-year
// window is what "annual return" conventionally means for a stock, and
// keeps this number stable regardless of how short a forward period
// someone types.
const HISTORICAL_RATE_LOOKBACK_DAYS = 365.25;

function computeHistoricalRate(stock: PickedStock): ProjectionRate | null {
  const series = stock.points;
  if (series.length < 2) return null;

  const latest = series[series.length - 1];
  const latestTime = new Date(latest.date).getTime();
  const targetTime = latestTime - HISTORICAL_RATE_LOOKBACK_DAYS * 86_400_000;
  const past = closestPoint(series, targetTime);
  const pastTime = new Date(past.date).getTime();

  const spanYears = (latestTime - pastTime) / (365.25 * 86_400_000);
  if (spanYears <= 0 || past.close <= 0) return null;

  // Same floor as computeForecastRate above, for the same reason: a
  // recently-listed stock with under a year of trading history clamps
  // `past` to the earliest available point (see `clamped` below), which can
  // leave `spanYears` well under 1 -- annualizing that short a real window
  // would reintroduce the exact short-window CAGR amplification this
  // lookback was already changed to a fixed ~1yr window to avoid.
  const annualized = spanYears >= 1;
  const ratePct = (Math.pow(latest.close / past.close, 1 / Math.max(spanYears, 1)) - 1) * 100;
  // Clamped means the 1-year lookback ran off the start of the series
  // (a recently-listed stock with under a year of history) -- NOT just
  // "the nearest weekly-spaced point wasn't exactly on the target date,"
  // which is normal and expected for weekly-resolution data.
  const earliestTime = new Date(series[0].date).getTime();
  return { ratePct, spanYears, clamped: targetTime < earliestTime, annualized, source: "historical" };
}

function computeProjectionRate(stock: PickedStock): ProjectionRate | null {
  return computeForecastRate(stock) ?? computeHistoricalRate(stock);
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
}

export default function ReturnCalculator({ quota, onQuotaSpent }: ReturnCalculatorProps) {
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

  // Real Low/Mean/High analyst price target, not a synthetic spread around
  // the single historical rate above -- deliberately a separate figure with
  // its own (fixed, analyst-set) horizon rather than the user's adjustable
  // Time period, same "don't blend two different kinds of projections"
  // principle as PriceForecastChart being its own card on the main page.
  const targets = pickedStock?.analystTargets;
  const basePrice = pickedStock?.currentPrice;
  const scenarios =
    targets && basePrice
      ? (
          [
            { key: "low", label: "Worst case", tone: "bad", targetPrice: targets.low },
            { key: "mean", label: "Likely case", tone: "warning", targetPrice: targets.mean },
            { key: "high", label: "Best case", tone: "good", targetPrice: targets.high },
          ] as const
        ).map((s) => {
          const scenarioFutureValue = p * (s.targetPrice / basePrice);
          return { ...s, futureValue: scenarioFutureValue, gain: scenarioFutureValue - p };
        })
      : null;

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
                  {pickedStock.ticker}'s {projectionRate?.source === "historical" ? "historical" : "analyst-implied"}{" "}
                  {projectionRate && !projectionRate.annualized ? "expected return" : "annual return"}
                </span>
                <div
                  className="calculator-input-wrap locked"
                  title={
                    projectionRate?.source === "historical"
                      ? "Computed from real price history -- not editable"
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
                    {projectionRate.source === "forecast" ? (
                      <>
                        Implied by analysts' mean price target for {pickedStock.ticker}
                        {targets?.period ? ` (${targets.period})` : ""}
                        {projectionRate.annualized ? (
                          ", annualized."
                        ) : (
                          <>
                            {" "}
                            -- the target date is under a year away, so this is the real, un-extrapolated return to
                            that date, not stretched into a full year's pace.
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        No analyst coverage for {pickedStock.ticker} -- using its own actual return over the last{" "}
                        {projectionRate.spanYears >= 1
                          ? `${projectionRate.spanYears.toFixed(1)} years`
                          : `${Math.round(projectionRate.spanYears * 365)} days`}
                        {projectionRate.clamped ? " (all the price history available)" : ""}
                        {!projectionRate.annualized ? ", shown as-is rather than annualized" : ""} instead.
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
            <div className="calculator-field-header">
              <span>
                Projected over {Math.max(0, toNumber(periodValue)).toLocaleString("en-IN")}{" "}
                {PERIOD_UNIT_LABEL[periodUnit]}
              </span>
            </div>
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

            {scenarios && (
              <div className="calculator-scenario-section">
                <div className="calculator-field-header">
                  <span>
                    Analyst price target scenario{targets!.period ? ` for ${targets!.period}` : ""}
                  </span>
                </div>
                <div className="calculator-scenario-grid">
                  {scenarios.map((s) => (
                    <div className={`calculator-scenario-tile ${s.tone}`} key={s.key}>
                      <div className="calculator-scenario-label">{s.label}</div>
                      <div className="calculator-scenario-value">{formatINR(s.futureValue)}</div>
                      <div className="calculator-scenario-gain">
                        {s.gain >= 0 ? "+" : ""}
                        {formatINR(s.gain)}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="calculator-field-note">
                  Based on Tapetide's third-party analyst consensus price target for {pickedStock.ticker} -- not
                  Stackly's own view, and not investment advice.
                </div>
              </div>
            )}

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

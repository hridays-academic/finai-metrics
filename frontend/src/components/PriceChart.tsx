import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import type { PriceHistoryResponse, PricePoint } from "../lib/types";
import { ApiError, fetchPriceHistory } from "../lib/api";
import type { Theme } from "../hooks/useTheme";

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// The line/fill color reflects whether the *currently displayed period*
// (not just today's daily move) is up or down -- same good/bad split the
// "+X% over this period" text next to it already uses (see changePct
// below). Previously always --accent regardless of direction, which made
// --accent read as "the chart's color" rather than "the primary action
// color" everywhere else it's used (search button, active nav, etc.) --
// a real green-means-everything problem, not just a chart-specific one.
// null (no data yet) falls back to --accent as a neutral default.
function seriesColorsFor(changePct: number | null): { lineColor: string; topColor: string; bottomColor: string } {
  const token = changePct === null ? "--accent" : changePct >= 0 ? "--status-good" : "--status-bad";
  const color = cssVar(token);
  return { lineColor: color, topColor: `${color}66`, bottomColor: `${color}00` };
}

type Period = "1D" | "5D" | "1Y" | "3Y" | "5Y";
const PERIODS: { key: Period; label: string }[] = [
  { key: "1D", label: "1D" },
  { key: "5D", label: "5D" },
  { key: "1Y", label: "1Y" },
  { key: "3Y", label: "3Y" },
  { key: "5Y", label: "5Y (Max)" },
];

// The weekly "points" series and the daily "recent_points" series are
// fetched independently (see tapetide_provider.py) and don't always land on
// the same real-world last date -- confirmed live, not hypothetical: a
// genuine cached response had "points" ending 4 days before "recent_points"
// did. Left alone, switching from 1D/5D (daily) to 1Y/3Y/5Y (weekly) made
// the header's displayed "latest price"/date jump backwards, reading as
// inaccurate/broken even though both numbers were real. Appending
// recent_points' own true latest point onto the end of a weekly slice (only
// when it's genuinely newer) fixes that without fabricating any data --
// every period now ends on the same real, most-recent point.
function withLatestDailyPoint(weeklyPoints: PricePoint[], recentPoints: PricePoint[]): PricePoint[] {
  const lastWeekly = weeklyPoints[weeklyPoints.length - 1];
  const lastDaily = recentPoints[recentPoints.length - 1];
  if (!lastWeekly || !lastDaily || lastDaily.date <= lastWeekly.date) return weeklyPoints;
  return [...weeklyPoints, lastDaily];
}

// 1D/5D use the daily "recent_points" series (~6-7mo of history); everything
// else uses the ~5yr weekly "points" series, too sparse for a short zoom.
function sliceForPeriod(data: PriceHistoryResponse | null, period: Period): PricePoint[] {
  if (!data) return [];
  if (period === "1D") return data.recent_points.slice(-2);
  if (period === "5D") return data.recent_points.slice(-5);
  if (period === "1Y") return withLatestDailyPoint(data.points.slice(-52), data.recent_points);
  if (period === "3Y") return withLatestDailyPoint(data.points.slice(-156), data.recent_points);
  return withLatestDailyPoint(data.points, data.recent_points); // 5Y / Max
}

interface HoverPoint {
  date: string;
  price: number;
}

interface PriceChartProps {
  symbol: string;
  currency: string;
  theme: Theme;
  onTapetideResetAtChange?: (resetAt: string | null) => void;
}

export default function PriceChart({ symbol, currency, theme, onTapetideResetAtChange }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  const [data, setData] = useState<PriceHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverPoint | null>(null);
  const [period, setPeriod] = useState<Period>("5Y");

  // Fetch price history whenever the loaded company changes. `cancelled`
  // only needs to suppress a stale response's state update (e.g. if
  // `symbol` changes again before the first request returns) -- the
  // deeper problem of this firing twice per mount under React StrictMode's
  // dev-mode double-invoke is solved one layer down, in fetchPriceHistory
  // itself (see api.ts), by deduping concurrent same-symbol requests into
  // one real network call rather than trying to race an abort against it.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHover(null);
    setPeriod("5Y");
    fetchPriceHistory(symbol)
      .then((res) => {
        if (!cancelled) {
          setData(res);
          onTapetideResetAtChange?.(res.tapetide_reset_at);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setData(null);
          setError(err instanceof ApiError ? err.message : "Failed to load price history.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  // Create the chart once. Zoom (mouse wheel), pinch, and drag-to-pan are
  // built into lightweight-charts by default -- no extra wiring needed.
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      autoSize: false,
      height: 280,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: cssVar("--text-secondary"),
        fontFamily: "Inter, sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: cssVar("--border-subtle") },
      },
      rightPriceScale: { borderColor: cssVar("--border-subtle") },
      // fixLeftEdge/fixRightEdge stop the time scale's visible range from
      // ever extending past the actual data -- without them, scrolling or
      // pinch-zooming out past "5Y (Max)" doesn't error, it just shows a
      // mostly-empty chart with the real line squeezed into one corner and
      // dead space filling the rest, which reads as broken/glitched rather
      // than "you've reached the edge of the data."
      timeScale: { borderColor: cssVar("--border-subtle"), fixLeftEdge: true, fixRightEdge: true },
      crosshair: {
        vertLine: { color: cssVar("--border-strong"), labelBackgroundColor: cssVar("--bg-elevated") },
        horzLine: { color: cssVar("--border-strong"), labelBackgroundColor: cssVar("--bg-elevated") },
      },
    });

    const series = chart.addSeries(AreaSeries, {
      ...seriesColorsFor(null),
      lineWidth: 2,
      priceLineVisible: false,
    });

    chart.subscribeCrosshairMove((param) => {
      const point = param.time ? param.seriesData.get(series) : undefined;
      const value = point && "value" in point ? (point.value as number) : undefined;
      if (value !== undefined) {
        setHover({ date: String(param.time), price: value });
      } else {
        setHover(null);
      }
    });

    chartRef.current = chart;
    seriesRef.current = series;

    // Tracks both dimensions, not just width -- the wrap's height is now
    // flexible (flex: 1 in app.css, stretched to match Price History's
    // height in .charts-row) rather than a fixed 280px, so the chart needs
    // to actually redraw taller when it's given more room, not just wider.
    const resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) chart.applyOptions({ width: rect.width, height: rect.height });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const displayedPoints = useMemo(() => sliceForPeriod(data, period), [data, period]);

  const latest = displayedPoints[displayedPoints.length - 1];
  const first = displayedPoints[0];
  const changePct = latest && first && first.close !== 0 ? ((latest.close - first.close) / first.close) * 100 : null;
  // Effects below need the latest changePct without re-running on every
  // change of it themselves (the theme effect only cares about [theme]) --
  // a ref sidesteps that without an eslint-disable-driven stale closure.
  const changePctRef = useRef<number | null>(null);
  changePctRef.current = changePct;

  // Re-theme the chart in place (no re-create) when dark/light mode toggles.
  useEffect(() => {
    if (!chartRef.current || !seriesRef.current) return;
    chartRef.current.applyOptions({
      layout: { textColor: cssVar("--text-secondary") },
      grid: { horzLines: { color: cssVar("--border-subtle") } },
      rightPriceScale: { borderColor: cssVar("--border-subtle") },
      timeScale: { borderColor: cssVar("--border-subtle") },
      crosshair: {
        vertLine: { color: cssVar("--border-strong"), labelBackgroundColor: cssVar("--bg-elevated") },
        horzLine: { color: cssVar("--border-strong"), labelBackgroundColor: cssVar("--bg-elevated") },
      },
    });
    seriesRef.current.applyOptions(seriesColorsFor(changePctRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.setData(displayedPoints.map((p) => ({ time: p.date as Time, value: p.close })));
    seriesRef.current.applyOptions(seriesColorsFor(changePct));
    chartRef.current?.timeScale().fitContent();
  }, [displayedPoints, changePct]);
  const displayed = hover ?? (latest ? { date: latest.date, price: latest.close } : null);
  const symbolPrefix = currency === "INR" ? "₹" : "";

  return (
    <div className="price-chart-card">
      <div className="price-chart-header">
        <h3>Price History</h3>
        {displayed && (
          <div className="price-chart-readout">
            <span className="price-chart-price">
              {symbolPrefix}
              {displayed.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
            </span>
            {changePct !== null && !hover && (
              <span className={`price-chart-change ${changePct >= 0 ? "good" : "bad"}`}>
                {changePct >= 0 ? "+" : ""}
                {changePct.toFixed(2)}% over this period
              </span>
            )}
            <span className="price-chart-date">{displayed.date}</span>
          </div>
        )}
      </div>

      <div className="price-chart-canvas-wrap">
        <div className="price-chart-canvas" ref={containerRef} />
        {loading && (
          <div className="price-chart-skeleton" aria-label="Loading price history">
            <svg viewBox="0 0 400 120" preserveAspectRatio="none" className="price-chart-skeleton-line">
              <path
                d="M0,90 L30,85 L60,95 L90,70 L120,75 L150,55 L180,60 L210,40 L240,45 L270,25 L300,35 L330,20 L360,30 L400,15"
                fill="none"
              />
            </svg>
          </div>
        )}
        {error && <div className="price-chart-overlay error">{error}</div>}
      </div>

      {!loading && !error && (
        <div className="price-chart-period-row">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`price-chart-period-btn ${period === p.key ? "active" : ""}`}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {!loading && !error && (
        <div className="price-chart-footer">
          <button
            type="button"
            className="price-chart-reset"
            onClick={() => chartRef.current?.timeScale().fitContent()}
          >
            Reset zoom
          </button>
          <span className="price-chart-hint">Scroll or pinch to zoom, drag to pan</span>
        </div>
      )}
    </div>
  );
}

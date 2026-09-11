import { useEffect, useRef, useState } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Time,
} from "lightweight-charts";
import type { TradingRange } from "../lib/types";
import type { Theme } from "../hooks/useTheme";
import { ApiError, fetchTradingHistory } from "../lib/api";

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

type SeriesType = "candle" | "line";

const RANGES: { key: TradingRange; label: string }[] = [
  { key: "1D", label: "1D" },
  { key: "1W", label: "1W" },
  { key: "1M", label: "1M" },
  { key: "3M", label: "3M" },
  { key: "1Y", label: "1Y" },
  { key: "5Y", label: "5Y" },
];

// Backend sends "YYYY-MM-DD" for daily/weekly bars and "YYYY-MM-DDTHH:MM:SS"
// for intraday ones (see YFinanceProvider.get_intraday_history) -- both
// parse correctly via `Date`, and converting to a UNIX timestamp (seconds)
// sidesteps lightweight-charts' stricter "BusinessDay" string format
// entirely, which only accepts bare dates, never a date+time.
function toChartTime(dateStr: string): Time {
  return (new Date(dateStr).getTime() / 1000) as Time;
}

// 1D re-fetches periodically to pick up new intraday bars as the (delayed)
// trading day progresses -- every other range is a fixed historical window
// that doesn't meaningfully change minute to minute, so re-fetching it on
// the same cadence would just be wasted requests against yfinance's own
// rate limit (see useLiveQuotes.ts).
const ONE_DAY_REFRESH_MS = 60_000;

interface TradingChartProps {
  symbol: string;
  theme: Theme;
}

export default function TradingChart({ symbol, theme }: TradingChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | ISeriesApi<"Area"> | null>(null);

  const [range, setRange] = useState<TradingRange>("1D");
  const [seriesType, setSeriesType] = useState<SeriesType>("candle");
  const [data, setData] = useState<{ time: Time; open: number; high: number; low: number; close: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create the chart shell once (independent of series type/data).
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: false,
      height: 320,
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
      timeScale: { borderColor: cssVar("--border-subtle"), timeVisible: true, secondsVisible: false },
      crosshair: {
        vertLine: { color: cssVar("--border-strong"), labelBackgroundColor: cssVar("--bg-elevated") },
        horzLine: { color: cssVar("--border-strong"), labelBackgroundColor: cssVar("--bg-elevated") },
      },
    });
    chartRef.current = chart;

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
  }, []);

  // (Re)create the series whenever its TYPE changes -- lightweight-charts
  // series can't be converted in place (candlestick <-> area), only removed
  // and re-added, unlike a chart's own options which apply() in place.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (seriesRef.current) {
      chart.removeSeries(seriesRef.current);
      seriesRef.current = null;
    }
    if (seriesType === "candle") {
      seriesRef.current = chart.addSeries(CandlestickSeries, {
        upColor: cssVar("--status-good"),
        downColor: cssVar("--status-bad"),
        borderVisible: false,
        wickUpColor: cssVar("--status-good"),
        wickDownColor: cssVar("--status-bad"),
      });
    } else {
      seriesRef.current = chart.addSeries(AreaSeries, {
        lineColor: cssVar("--accent"),
        topColor: `${cssVar("--accent")}66`,
        bottomColor: `${cssVar("--accent")}00`,
        lineWidth: 2,
        priceLineVisible: false,
      });
    }
    // Re-apply already-loaded data to the freshly (re)created series.
    if (data.length > 0) {
      if (seriesType === "candle") {
        (seriesRef.current as ISeriesApi<"Candlestick">).setData(data as CandlestickData[]);
      } else {
        (seriesRef.current as ISeriesApi<"Area">).setData(
          data.map((d) => ({ time: d.time, value: d.close })) as LineData[]
        );
      }
      chart.timeScale().fitContent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesType]);

  // Re-theme in place on dark/light toggle.
  useEffect(() => {
    if (!chartRef.current) return;
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
    if (seriesRef.current) {
      if (seriesType === "candle") {
        (seriesRef.current as ISeriesApi<"Candlestick">).applyOptions({
          upColor: cssVar("--status-good"),
          downColor: cssVar("--status-bad"),
          wickUpColor: cssVar("--status-good"),
          wickDownColor: cssVar("--status-bad"),
        });
      } else {
        const accent = cssVar("--accent");
        (seriesRef.current as ISeriesApi<"Area">).applyOptions({
          lineColor: accent,
          topColor: `${accent}66`,
          bottomColor: `${accent}00`,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // Fetch history on symbol/range change, plus a periodic refresh for "1D"
  // (see ONE_DAY_REFRESH_MS) to pick up new bars as the day progresses.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchTradingHistory(symbol, range);
        if (cancelled) return;
        const points = res.points.map((p) => ({
          time: toChartTime(p.date),
          open: p.open,
          high: p.high,
          low: p.low,
          close: p.close,
        }));
        setData(points);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Failed to load chart data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const id = range === "1D" ? setInterval(load, ONE_DAY_REFRESH_MS) : null;
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [symbol, range]);

  // Push fetched data into whichever series is currently mounted.
  useEffect(() => {
    if (!seriesRef.current || data.length === 0) return;
    if (seriesType === "candle") {
      (seriesRef.current as ISeriesApi<"Candlestick">).setData(data as CandlestickData[]);
    } else {
      (seriesRef.current as ISeriesApi<"Area">).setData(
        data.map((d) => ({ time: d.time, value: d.close })) as LineData[]
      );
    }
    chartRef.current?.timeScale().fitContent();
  }, [data, seriesType]);

  return (
    <div className="price-chart-card trading-chart-card">
      <div className="price-chart-header">
        <h3>{symbol.replace(/\.(NS|BO)$/, "")}</h3>
        <span
          className="trading-delayed-badge"
          title="Sourced via yfinance -- not a real-time tick feed. ~15 min is an industry-typical figure for free data, not one yfinance itself guarantees."
        >
          Delayed ~15 min
        </span>
      </div>

      <div className="trading-chart-controls">
        <div className="price-chart-period-row">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              className={`price-chart-period-btn ${range === r.key ? "active" : ""}`}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="trading-series-toggle" role="group" aria-label="Chart type">
          <button
            type="button"
            className={seriesType === "candle" ? "active" : ""}
            onClick={() => setSeriesType("candle")}
          >
            Candles
          </button>
          <button type="button" className={seriesType === "line" ? "active" : ""} onClick={() => setSeriesType("line")}>
            Line
          </button>
        </div>
      </div>

      <div className="price-chart-canvas-wrap">
        <div className="price-chart-canvas" ref={containerRef} />
        {loading && data.length === 0 && (
          <div className="price-chart-overlay">Loading chart...</div>
        )}
        {error && <div className="price-chart-overlay error">{error}</div>}
      </div>
    </div>
  );
}

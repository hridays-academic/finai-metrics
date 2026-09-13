import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Time,
} from "lightweight-charts";
import type { Transaction } from "../lib/portfolio";
import type { PricePoint } from "../lib/types";
import { fetchTradingHistory } from "../lib/api";
import { buildPortfolioValueSeries, pickHistoryRange } from "../lib/portfolioHistory";
import type { Theme } from "../hooks/useTheme";

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

interface PortfolioValueChartProps {
  transactions: Transaction[];
  startingBalance: number;
  // The live-computed total value right now (cash + holdings at current
  // quotes) -- plotted as the chart's final point so its right edge always
  // matches the summary tiles above it exactly, even between the
  // reconstructed series' own last real historical data point (which can
  // be up to a trading day stale for daily-granularity ranges).
  currentValue: number;
  theme: Theme;
}

// Real reconstructed history (see lib/portfolioHistory.ts), colored
// --accent like every other real-data chart in the app (PriceChart,
// TradingChart) -- unlike SimulatorChart.tsx's synthetic random path,
// which deliberately uses --status-warning instead. This one earns the
// "real" color: every point is built from actual past prices and the
// actual transaction log, not a randomly generated walk.
export default function PortfolioValueChart({
  transactions,
  startingBalance,
  currentValue,
  theme,
}: PortfolioValueChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  const [priceSeries, setPriceSeries] = useState<Record<string, PricePoint[]>>({});
  const [loading, setLoading] = useState(transactions.length > 0);
  const [error, setError] = useState<string | null>(null);

  const symbols = useMemo(
    () => Array.from(new Set(transactions.map((t) => t.symbol))).sort(),
    [transactions]
  );
  const symbolsKey = symbols.join(",");

  const firstTradeMs = useMemo(() => {
    if (transactions.length === 0) return null;
    return Math.min(...transactions.map((t) => new Date(t.timestamp).getTime()));
  }, [transactions]);

  // Create the chart shell once.
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: false,
      height: 260,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: cssVar("--text-secondary"),
        fontFamily: "Inter, sans-serif",
        fontSize: 11,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: cssVar("--border-subtle") } },
      rightPriceScale: { borderColor: cssVar("--border-subtle") },
      timeScale: { borderColor: cssVar("--border-subtle"), timeVisible: true, secondsVisible: false },
      crosshair: {
        vertLine: { color: cssVar("--border-strong"), labelBackgroundColor: cssVar("--bg-elevated") },
        horzLine: { color: cssVar("--border-strong"), labelBackgroundColor: cssVar("--bg-elevated") },
      },
    });
    chartRef.current = chart;
    seriesRef.current = chart.addSeries(AreaSeries, {
      lineColor: cssVar("--accent"),
      topColor: `${cssVar("--accent")}66`,
      bottomColor: `${cssVar("--accent")}00`,
      lineWidth: 2,
      priceLineVisible: false,
    });

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

  // Re-theme in place on dark/light or green/blue toggle.
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
      const accent = cssVar("--accent");
      seriesRef.current.applyOptions({ lineColor: accent, topColor: `${accent}66`, bottomColor: `${accent}00` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // Fetch every ever-traded symbol's real price history, once per distinct
  // symbol set / first-trade time (not on every render, and not on every
  // live-quote tick -- this chart's own data only needs to change when the
  // set of symbols traded changes, never on a 20s poll).
  useEffect(() => {
    if (symbols.length === 0 || firstTradeMs === null) {
      setPriceSeries({});
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      const daysSince = (Date.now() - (firstTradeMs as number)) / 86_400_000;
      const range = pickHistoryRange(daysSince);
      const results = await Promise.allSettled(symbols.map((s) => fetchTradingHistory(s, range)));
      if (cancelled) return;
      const next: Record<string, PricePoint[]> = {};
      let anyFailed = false;
      results.forEach((r, i) => {
        if (r.status === "fulfilled") next[symbols[i]] = r.value.points;
        else anyFailed = true;
      });
      setPriceSeries(next);
      setError(
        anyFailed
          ? "Some stocks' price history couldn't be loaded -- their contribution below uses an approximation instead."
          : null
      );
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolsKey, firstTradeMs]);

  const data = useMemo<{ time: Time; value: number }[]>(() => {
    if (transactions.length === 0) return [];
    const points = buildPortfolioValueSeries(transactions, startingBalance, priceSeries);
    const mapped: { time: Time; value: number }[] = points.map((p) => ({ time: p.time as Time, value: p.value }));
    const nowSec = Math.floor(Date.now() / 1000) as Time;
    const last = mapped[mapped.length - 1];
    if (!last || (last.time as number) < (nowSec as number)) {
      mapped.push({ time: nowSec, value: currentValue });
    } else {
      mapped[mapped.length - 1] = { time: nowSec, value: currentValue };
    }
    return mapped;
  }, [transactions, startingBalance, priceSeries, currentValue]);

  useEffect(() => {
    if (!seriesRef.current || data.length === 0) return;
    seriesRef.current.setData(data as LineData[]);
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  if (transactions.length === 0) {
    return (
      <div className="calculator-empty-hint">
        Make your first trade to start building a portfolio value history here.
      </div>
    );
  }

  return (
    <div className="price-chart-card trading-chart-card portfolio-value-chart-card">
      <div className="price-chart-canvas-wrap">
        <div className="price-chart-canvas" ref={containerRef} />
        {loading && data.length === 0 && (
          <div className="price-chart-overlay">Reconstructing portfolio history...</div>
        )}
      </div>
      {error && <div className="calculator-field-note">{error}</div>}
    </div>
  );
}

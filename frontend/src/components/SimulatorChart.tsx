import { useEffect, useRef } from "react";
import {
  AreaSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
} from "lightweight-charts";
import type { Theme } from "../hooks/useTheme";

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export interface SimPoint {
  time: string; // "YYYY-MM-DD"
  value: number;
}

interface SimulatorChartProps {
  // Only the first `revealedCount` points of `points` are actually drawn --
  // StockMarketSimulator.tsx ticks this up over ~2s after a new path is
  // generated, so the line visibly draws itself left to right like a live
  // ticker rather than appearing all at once.
  points: SimPoint[];
  revealedCount: number;
  theme: Theme;
}

// Deliberately its own small chart, same reasoning as PriceForecastChart.tsx
// being separate from the main 5yr PriceChart: a simulated path has nothing
// in common with real price history except sharing an axis, and plotting it
// on the real chart would misleadingly suggest it's real data. Colored with
// --status-warning (this app's existing "uncertain/caution" token, see
// theme.css) rather than --accent (used for the real price chart) -- a
// deliberate visual cue that this line is synthetic/hypothetical, not
// observed.
export default function SimulatorChart({ points, revealedCount, theme }: SimulatorChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

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
      timeScale: { borderColor: cssVar("--border-subtle") },
      handleScroll: false,
      handleScale: false,
    });

    const series = chart.addSeries(AreaSeries, {
      lineWidth: 2,
      lineColor: cssVar("--status-warning"),
      topColor: `${cssVar("--status-warning")}55`,
      bottomColor: `${cssVar("--status-warning")}00`,
      priceLineVisible: true,
      lastValueVisible: true,
    });

    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = createSeriesMarkers(series, []);

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
      markersRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.applyOptions({
      layout: { textColor: cssVar("--text-secondary") },
      grid: { horzLines: { color: cssVar("--border-subtle") } },
      rightPriceScale: { borderColor: cssVar("--border-subtle") },
      timeScale: { borderColor: cssVar("--border-subtle") },
    });
    seriesRef.current?.applyOptions({
      lineColor: cssVar("--status-warning"),
      topColor: `${cssVar("--status-warning")}55`,
      bottomColor: `${cssVar("--status-warning")}00`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;
    const visible = points.slice(0, Math.max(1, revealedCount)) as { time: Time; value: number }[];
    seriesRef.current.setData(visible);
    markersRef.current?.setMarkers(
      points.length
        ? [
            {
              time: points[0].time as Time,
              position: "belowBar",
              color: cssVar("--text-tertiary"),
              shape: "circle",
              text: "Start",
              size: 0.8,
            },
          ]
        : [],
    );
    chartRef.current.timeScale().fitContent();
  }, [points, revealedCount]);

  return (
    <div className="price-chart-canvas-wrap">
      <div className="price-chart-canvas" ref={containerRef} />
    </div>
  );
}

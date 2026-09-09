import { useEffect, useRef } from "react";
import { AreaSeries, ColorType, createChart, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import type { Theme } from "../hooks/useTheme";
import { formatINR } from "../lib/format";

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

interface GrowthChartProps {
  // The actual compound-growth curve p*(1+r)^t, sampled at even steps from
  // today (t=0) to periodInYears -- a real, deterministic calculation from
  // the same rate/period the tiles above already show, not a separate
  // estimate. Colored --accent (this app's real/deterministic-data color,
  // same as the main Price History chart) -- deliberately NOT
  // --status-warning, the color SimulatorChart.tsx uses one page over for
  // its randomly-generated path, so the two pages' charts read as visually
  // different KINDS of line at a glance, not just different data.
  points: { time: string; value: number }[];
  theme: Theme;
}

export default function GrowthChart({ points, theme }: GrowthChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      autoSize: false,
      height: 220,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: cssVar("--text-secondary"),
        fontFamily: "Inter, sans-serif",
        fontSize: 11,
      },
      // Rupee/lakh/crore formatting on the price axis and crosshair label --
      // without this, lightweight-charts shows raw numbers ("1250000.00"),
      // the one place in this app that would've broken from the Indian
      // number formatting used everywhere else.
      localization: { priceFormatter: (price: number) => formatINR(price) },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: cssVar("--border-subtle") },
      },
      rightPriceScale: { borderColor: cssVar("--border-subtle") },
      timeScale: { borderColor: cssVar("--border-subtle"), fixLeftEdge: true, fixRightEdge: true },
      handleScroll: false,
      handleScale: false,
    });

    const series = chart.addSeries(AreaSeries, {
      lineWidth: 2,
      lineColor: cssVar("--accent"),
      topColor: `${cssVar("--accent")}55`,
      bottomColor: `${cssVar("--accent")}00`,
      priceLineVisible: false,
      lastValueVisible: true,
    });

    chartRef.current = chart;
    seriesRef.current = series;

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

  useEffect(() => {
    if (!chartRef.current || !seriesRef.current) return;
    chartRef.current.applyOptions({
      layout: { textColor: cssVar("--text-secondary") },
      grid: { horzLines: { color: cssVar("--border-subtle") } },
      rightPriceScale: { borderColor: cssVar("--border-subtle") },
      timeScale: { borderColor: cssVar("--border-subtle") },
    });
    seriesRef.current.applyOptions({
      lineColor: cssVar("--accent"),
      topColor: `${cssVar("--accent")}55`,
      bottomColor: `${cssVar("--accent")}00`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;
    seriesRef.current.setData(points.map((p) => ({ time: p.time as Time, value: p.value })));
    chartRef.current.timeScale().fitContent();
  }, [points]);

  return (
    <div className="growth-chart-canvas-wrap">
      <div className="price-chart-canvas" ref={containerRef} />
    </div>
  );
}

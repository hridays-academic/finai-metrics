import { useEffect, useRef } from "react";
import {
  ColorType,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import type { AnalystConsensus } from "../lib/types";
import type { Theme } from "../hooks/useTheme";

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function formatPrice(value: number, symbolPrefix: string): string {
  return `${symbolPrefix}${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

interface PriceForecastChartProps {
  currentPrice: number;
  currency: string;
  forecast: AnalystConsensus;
  theme: Theme;
}

// A dedicated, standalone chart -- deliberately NOT overlaid on the main
// price history chart, where a ~9-month-out forecast fan was an
// imperceptible sliver against 5 years of history. This chart's whole time
// axis is just "today" -> the target date, so the fan fills the frame.
export default function PriceForecastChart({ currentPrice, currency, forecast, theme }: PriceForecastChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const highSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const meanSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const lowSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const highMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const meanMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const lowMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  // Create the chart once.
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
      grid: {
        vertLines: { visible: false },
        horzLines: { color: cssVar("--border-subtle") },
      },
      rightPriceScale: { borderColor: cssVar("--border-subtle") },
      timeScale: { borderColor: cssVar("--border-subtle") },
      // Only 3 legs from one origin -- zoom/pan add nothing here and just
      // invite users to lose the fan off-screen.
      handleScroll: false,
      handleScale: false,
    });

    const dashedLineBase = {
      lineWidth: 2 as const,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    };
    const highSeries = chart.addSeries(LineSeries, { ...dashedLineBase, color: cssVar("--status-good") });
    const meanSeries = chart.addSeries(LineSeries, { ...dashedLineBase, color: cssVar("--status-neutral") });
    const lowSeries = chart.addSeries(LineSeries, { ...dashedLineBase, color: cssVar("--status-bad") });

    chartRef.current = chart;
    highSeriesRef.current = highSeries;
    meanSeriesRef.current = meanSeries;
    lowSeriesRef.current = lowSeries;
    highMarkersRef.current = createSeriesMarkers(highSeries, []);
    // zOrder "top" -- the "Today" marker lives here, and all three lines'
    // dashed strokes pass through that exact point (shared origin), so
    // without this the strokes render over the dot instead of under it.
    meanMarkersRef.current = createSeriesMarkers(meanSeries, [], { zOrder: "top" });
    lowMarkersRef.current = createSeriesMarkers(lowSeries, []);

    // Tracks both dimensions, not just width -- this card stretches to match
    // Price History's height in .charts-row (see app.css), so the fan
    // should actually redraw taller to fill that space rather than sitting
    // at a fixed 220px with dead space around it.
    const resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) chart.applyOptions({ width: rect.width, height: rect.height });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      highSeriesRef.current = null;
      meanSeriesRef.current = null;
      lowSeriesRef.current = null;
      highMarkersRef.current = null;
      meanMarkersRef.current = null;
      lowMarkersRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-theme in place (no re-create) on dark/light toggle.
  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.applyOptions({
      layout: { textColor: cssVar("--text-secondary") },
      grid: { horzLines: { color: cssVar("--border-subtle") } },
      rightPriceScale: { borderColor: cssVar("--border-subtle") },
      timeScale: { borderColor: cssVar("--border-subtle") },
    });
    highSeriesRef.current?.applyOptions({ color: cssVar("--status-good") });
    meanSeriesRef.current?.applyOptions({ color: cssVar("--status-neutral") });
    lowSeriesRef.current?.applyOptions({ color: cssVar("--status-bad") });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // Draw the fan: today's price -> target date, one leg per High/Mean/Low,
  // each ending in a small plain colored dot. The % figure is NOT drawn as
  // an on-chart text marker -- when High and Mean are close in price (common),
  // their labels collide/clip each other above the dots. Shown in the
  // legend below instead, where there's no such risk. A single small
  // "Today" marker on the mean leg's start anchors the fan's origin, since
  // otherwise the chart never states outright what point the fan grows from.
  useEffect(() => {
    if (!chartRef.current) return;
    const today = new Date().toISOString().slice(0, 10);
    const origin = { time: today as Time, value: currentPrice };
    const targetTime = forecast.target_date as Time;

    const legs: [
      React.MutableRefObject<ISeriesApi<"Line"> | null>,
      React.MutableRefObject<ISeriesMarkersPluginApi<Time> | null>,
      number,
      string,
      boolean,
    ][] = [
      [highSeriesRef, highMarkersRef, forecast.target_high!, cssVar("--status-good"), false],
      [meanSeriesRef, meanMarkersRef, forecast.target_mean!, cssVar("--status-neutral"), true],
      [lowSeriesRef, lowMarkersRef, forecast.target_low!, cssVar("--status-bad"), false],
    ];
    for (const [seriesRefItem, markersRefItem, targetValue, color, isOriginLeg] of legs) {
      seriesRefItem.current?.setData([origin, { time: targetTime, value: targetValue }]);
      const targetMarker: SeriesMarker<Time> = {
        time: targetTime,
        position: "inBar",
        color,
        shape: "circle",
        size: 0.6,
      };
      const markers = isOriginLeg
        ? [
            {
              time: today as Time,
              // "inBar" (not "belowBar") -- centers the dot exactly on the
              // shared origin value all three lines actually start from,
              // instead of floating it just below that point.
              position: "inBar" as const,
              color: cssVar("--text-tertiary"),
              shape: "circle" as const,
              text: "Today",
              size: 0.8,
            },
            targetMarker,
          ]
        : [targetMarker];
      markersRefItem.current?.setMarkers(markers);
    }
    chartRef.current.timeScale().fitContent();
  }, [currentPrice, forecast]);

  const symbolPrefix = currency === "INR" ? "₹" : "";
  const pct = (target: number) => ((target - currentPrice) / currentPrice) * 100;
  const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

  return (
    <div className="price-chart-card">
      <div className="price-chart-header">
        <h3>Share Price Forecast</h3>
        <span className="price-chart-date">
          {forecast.target_period ?? `Target: ${forecast.target_date}`}
        </span>
      </div>

      <div className="price-chart-canvas-wrap price-forecast-canvas-wrap">
        <div className="price-chart-canvas price-forecast-canvas" ref={containerRef} />
      </div>

      <div className="price-chart-forecast-legend">
        <span>From today&apos;s price ({formatPrice(currentPrice, symbolPrefix)}):</span>
        <span className="price-chart-forecast-item good">
          <span className="dot" /> High {formatPrice(forecast.target_high!, symbolPrefix)} (
          {fmtPct(pct(forecast.target_high!))})
        </span>
        <span className="price-chart-forecast-item neutral">
          <span className="dot" /> Mean {formatPrice(forecast.target_mean!, symbolPrefix)} (
          {fmtPct(pct(forecast.target_mean!))})
        </span>
        <span className="price-chart-forecast-item bad">
          <span className="dot" /> Low {formatPrice(forecast.target_low!, symbolPrefix)} (
          {fmtPct(pct(forecast.target_low!))})
        </span>
        <span className="price-chart-forecast-note">(% = expected return from today's price)</span>
      </div>
    </div>
  );
}

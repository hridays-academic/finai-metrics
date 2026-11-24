import type { CSSProperties } from "react";
import type { Metric } from "../lib/types";
import { formatMetricValue } from "../lib/format";
import { useTooltip } from "./Tooltip";

const STATUS_WORD: Record<string, string> = { good: "Healthy", warning: "Watch", bad: "Weak" };
const STATUS_TONE: Record<string, string> = { good: "positive", warning: "caution", bad: "negative" };

// One ratio as a row of its group's list (2026-11-16 redesign; was a tile).
// Its explanation opens in the shared glass tooltip (portalled to <body>).
// Status is a dot plus a word, never colour alone. `bar` (0..1) draws a thin
// bar beside the value, sized against the group's other ratios in the same
// unit, only for comparing at a glance: the number stays the source of truth.
export default function MetricCard({ metric, bar }: { metric: Metric; bar?: number | null }) {
  const na = metric.value === null || metric.value === undefined;
  const { triggerProps, tooltip } = useTooltip<HTMLLIElement>(
    <>
      <div className="tooltip-title">{metric.label}</div>
      {metric.definition && <p className="tooltip-text">{metric.definition}</p>}
      {metric.assessment && <p className="tooltip-text tooltip-emphasis">{metric.assessment}</p>}
      {metric.formula && <div className="tooltip-formula">{metric.formula}</div>}
    </>
  );
  const negative = typeof metric.value === "number" && metric.value < 0;

  return (
    <li {...triggerProps} className={`ratio-row ${metric.status}`} aria-label={`${metric.label}: ${formatMetricValue(metric)}`}>
      <span className="ratio-label">
        {metric.label}
        {metric.note && <span className="ratio-note">{metric.note}</span>}
        {metric.parts && (
          <span className="metric-parts">
            {metric.parts.map((p, i) => (
              <span key={p.label}>
                {i > 0 && <span className="metric-parts-times"> × </span>}
                <span title={p.label}>{formatMetricValue({ ...metric, value: p.value, unit: p.unit })}</span>
              </span>
            ))}
            <span className="metric-parts-legend">{metric.parts.map((p) => p.label.toLowerCase()).join(" × ")}</span>
          </span>
        )}
      </span>
      <span className="ratio-bar-track" aria-hidden="true">
        {bar !== null && bar !== undefined && (
          <span className={`value-bar ${negative ? "is-negative" : ""}`} style={{ "--w": bar.toFixed(3) } as CSSProperties} />
        )}
      </span>
      <span className={`ratio-value ${na ? "na" : ""}`}>{formatMetricValue(metric)}</span>
      {/* Every row has a status in the same spot, so the column lines up:
          metrics with no conventional benchmark (P/E, EPS...) say so. */}
      <span className={`status-text ${STATUS_TONE[metric.status] ?? "neutral"}`}>
        {STATUS_WORD[metric.status] ?? (na ? "No data" : "No benchmark")}
      </span>
      {tooltip}
    </li>
  );
}

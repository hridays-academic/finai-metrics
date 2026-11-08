import type { Metric } from "../lib/types";
import { formatMetricValue } from "../lib/format";
import { useTooltip } from "./Tooltip";

const STATUS_WORD: Record<string, string> = { good: "Healthy", warning: "Watch", bad: "Weak" };
const STATUS_TONE: Record<string, string> = { good: "positive", warning: "caution", bad: "negative" };

// A ratio tile. Its explanation opens in the shared glass tooltip (portalled
// to <body>, so it can never render underneath the next panel, which is what
// the old in-tile popover did). Status is a dot plus a word, never colour alone.
export default function MetricCard({ metric }: { metric: Metric }) {
  const na = metric.value === null || metric.value === undefined;
  const { triggerProps, tooltip } = useTooltip<HTMLDivElement>(
    <>
      <div className="tooltip-title">{metric.label}</div>
      {metric.definition && <p className="tooltip-text">{metric.definition}</p>}
      {metric.assessment && <p className="tooltip-text tooltip-emphasis">{metric.assessment}</p>}
      {metric.formula && <div className="tooltip-formula">{metric.formula}</div>}
    </>
  );

  return (
    <div {...triggerProps} className={`metric-card tile ${metric.status}`} aria-label={`${metric.label}: ${formatMetricValue(metric)}`}>
      <div className="metric-label">{metric.label}</div>
      <div className={`metric-value ${na ? "na" : ""}`}>{formatMetricValue(metric)}</div>
      {metric.parts && (
        <div className="metric-parts">
          {metric.parts.map((p, i) => (
            <span key={p.label}>
              {i > 0 && <span className="metric-parts-times"> × </span>}
              <span title={p.label}>{formatMetricValue({ ...metric, value: p.value, unit: p.unit })}</span>
            </span>
          ))}
          <div className="metric-parts-legend">{metric.parts.map((p) => p.label.toLowerCase()).join(" × ")}</div>
        </div>
      )}
      {/* Every tile has a status line in the same spot, so tiles line up:
          metrics with no conventional benchmark (P/E, EPS...) say so. */}
      <span className={`status-text ${STATUS_TONE[metric.status] ?? "neutral"}`}>
        {STATUS_WORD[metric.status] ?? (na ? "No data" : "No benchmark")}
      </span>
      {tooltip}
    </div>
  );
}

import { useState } from "react";
import type { Metric } from "../lib/types";
import { formatMetricValue } from "../lib/format";

export default function MetricCard({ metric }: { metric: Metric }) {
  const [open, setOpen] = useState(false);
  const na = metric.value === null || metric.value === undefined;

  return (
    <div
      className="metric-card"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen((v) => !v)}
    >
      <div className="metric-card-top">
        <span className="metric-label">{metric.label}</span>
        <span className={`status-dot ${metric.status}`} />
      </div>
      <div className={`metric-value ${na ? "na" : ""}`}>{formatMetricValue(metric)}</div>
      {metric.status !== "neutral" && !na && (
        <span className={`metric-badge ${metric.status}`}>{metric.status}</span>
      )}

      {open && (
        <div className="metric-popover" role="tooltip">
          <div className="metric-popover-title">{metric.label}</div>
          {metric.definition && <p className="metric-popover-definition">{metric.definition}</p>}
          {metric.assessment && (
            <p className={`metric-popover-assessment ${metric.status}`}>{metric.assessment}</p>
          )}
          {metric.formula && <div className="metric-popover-formula">{metric.formula}</div>}
        </div>
      )}
    </div>
  );
}

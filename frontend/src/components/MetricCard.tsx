import { useRef, useState } from "react";
import type { Metric } from "../lib/types";
import { formatMetricValue } from "../lib/format";

// Popovers run roughly 150-220px tall depending on how much text a metric
// has (definition + assessment + formula). This threshold is deliberately
// larger than that (~one more card-row's worth of height, ~130px, added on
// top) so that the second-to-last row flips consistently with the actual
// last row rather than only the very last row doing it -- a page scrolled
// to the bottom otherwise has just enough space below the second-to-last
// row to *not* trigger the flip, which reads as inconsistent/broken next
// to the row right below it that does flip.
const POPOVER_APPROX_HEIGHT = 360;

export default function MetricCard({ metric }: { metric: Metric }) {
  const [open, setOpen] = useState(false);
  const [openAbove, setOpenAbove] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const na = metric.value === null || metric.value === undefined;

  function handleOpen() {
    const rect = cardRef.current?.getBoundingClientRect();
    if (rect) {
      setOpenAbove(window.innerHeight - rect.bottom < POPOVER_APPROX_HEIGHT);
    }
    setOpen(true);
  }

  return (
    <div
      ref={cardRef}
      className="metric-card"
      onMouseEnter={handleOpen}
      onMouseLeave={() => setOpen(false)}
      onClick={() => (open ? setOpen(false) : handleOpen())}
    >
      <div className="metric-card-top">
        <span className="metric-label">{metric.label}</span>
        <span className={`status-dot ${metric.status}`} />
      </div>
      {/* No separate status badge -- it repeated the dot's own color as
          text on every card, which added up to a lot of redundant noise
          across 20-30 cards. The dot + popover already carry that. */}
      <div className={`metric-value ${na ? "na" : ""}`}>{formatMetricValue(metric)}</div>

      {open && (
        <div className={`metric-popover ${openAbove ? "above" : ""}`} role="tooltip">
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

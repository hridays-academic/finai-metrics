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
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      // Only flip above when doing so actually helps -- i.e. there's more
      // room above than below -- not just whenever below falls short of
      // POPOVER_APPROX_HEIGHT. A card near the top of the scrolled viewport
      // has little room in EITHER direction; blindly flipping there just
      // trades a bottom clip for a top clip (confirmed live: a popover
      // opening "above" a second-row card ran clean off the top of the
      // screen instead of the bottom, since above had even less room).
      setOpenAbove(spaceBelow < POPOVER_APPROX_HEIGHT && spaceAbove > spaceBelow);
    }
    setOpen(true);
  }

  return (
    <div
      ref={cardRef}
      // Status color lives on a left-edge ribbon (border-left, see
      // .metric-card in app.css) rather than the small dot this used to
      // carry -- a 6px dot was hard to register at a glance across a dense
      // 20-30-card grid; a full-height colored edge on every card reads
      // immediately, and matches the same left-border convention already
      // used for .calculator-scenario-tile/.calculator-risk-row elsewhere
      // in the app.
      className={`metric-card ${metric.status}`}
      onMouseEnter={handleOpen}
      onMouseLeave={() => setOpen(false)}
      onClick={() => (open ? setOpen(false) : handleOpen())}
    >
      <div className="metric-card-top">
        <span className="metric-label">{metric.label}</span>
      </div>
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

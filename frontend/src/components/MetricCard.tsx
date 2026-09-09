import { useRef, useState } from "react";
import type { Metric } from "../lib/types";
import { formatMetricValue } from "../lib/format";

// Popovers run roughly 150-220px tall depending on how much text a metric
// has (definition + assessment + formula). Was padded all the way to 360
// (~one more card-row's height on top of the real max) so a second-to-last
// row would flip consistently alongside the actual last row -- but that
// padding turned out to cause a worse, more visible inconsistency than the
// one it was preventing: confirmed live, Profitability's cards (which just
// sit lower on the page than Liquidity's, nothing to do with being
// near the actual bottom of the list) were flipping "above" purely because
// this threshold was so much larger than any real popover ever gets,
// while Liquidity's own cards -- genuinely no different in popover size --
// never did. 260 stays a real margin over the true ~150-220px range
// (enough to still catch a genuinely-last-row, near-the-bottom case)
// without falsely triggering for every card that merely isn't right at
// the very top of the page.
const POPOVER_APPROX_HEIGHT = 260;

export default function MetricCard({ metric }: { metric: Metric }) {
  const [open, setOpen] = useState(false);
  const [openAbove, setOpenAbove] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const na = metric.value === null || metric.value === undefined;

  function handleOpen() {
    const rect = cardRef.current?.getBoundingClientRect();
    if (rect) {
      const spaceBelow = window.innerHeight - rect.bottom;
      // The nearest ancestor that actually clips content (.expanded-details,
      // required for the "Show more" collapse/expand height animation --
      // see app.css) can cut off a flipped-above popover well before it
      // reaches the top of the *viewport*. Confirmed live: the Liquidity
      // group's cards sit right at the top of that container, and a
      // flipped popover there had its title/definition silently clipped
      // even though there was plainly empty viewport space above it --
      // the clip was against this container's own top edge, not the
      // screen's. Space above is measured to whichever boundary is
      // closer: the true viewport top, or this container's top.
      const clipAncestor = cardRef.current?.closest(".expanded-details");
      const clipTop = clipAncestor ? clipAncestor.getBoundingClientRect().top : 0;
      const spaceAbove = rect.top - Math.max(0, clipTop);
      // Only flip above when doing so actually helps -- i.e. there's more
      // room above than below -- not just whenever below falls short of
      // POPOVER_APPROX_HEIGHT. A card near the top has little room in
      // EITHER direction; blindly flipping there just trades one clip for
      // another.
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

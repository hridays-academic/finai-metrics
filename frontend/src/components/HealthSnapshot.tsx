import type { HealthSnapshot as HealthSnapshotType } from "../lib/types";
import { healthVerdictTone } from "../lib/tone";

interface HealthSnapshotProps {
  snapshot: HealthSnapshotType;
  // Smaller type/padding, no top margin -- used inline in the summary row
  // instead of as a standalone full-width card. Same content either way.
  compact?: boolean;
  fullWidth?: boolean;
}

export default function HealthSnapshot({ snapshot, compact, fullWidth }: HealthSnapshotProps) {
  const tone = healthVerdictTone(snapshot.verdict);

  return (
    <div
      className={`health-snapshot ${tone} ${compact ? "compact" : ""} ${fullWidth ? "full-width" : ""}`}
    >
      <div className="health-snapshot-main">
        <span className={`status-dot ${tone}`} />
        <div>
          <div className="health-snapshot-verdict">{snapshot.verdict}</div>
          <div className="health-snapshot-explanation">{snapshot.explanation}</div>
        </div>
      </div>
      {snapshot.total_count > 0 && (
        <div className="health-snapshot-breakdown">
          <span className="good">{snapshot.good_count} healthy</span>
          <span className="warning">{snapshot.warning_count} moderate</span>
          <span className="bad">{snapshot.bad_count} weak</span>
        </div>
      )}
      <div className="health-snapshot-disclaimer">
        Based on fundamental ratios only -- not a recommendation to buy, sell, or hold.
      </div>
    </div>
  );
}

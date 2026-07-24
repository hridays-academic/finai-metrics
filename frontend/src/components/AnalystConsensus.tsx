import type { AnalystConsensus as AnalystConsensusType } from "../lib/types";
import { consensusTone } from "../lib/tone";

interface AnalystConsensusProps {
  consensus: AnalystConsensusType;
  currentPrice: number | null;
  currency: string;
  // Smaller type/padding, no top margin -- used inline in the summary row
  // instead of as a standalone full-width card. Same content either way
  // (mirrors HealthSnapshot's `compact` prop).
  compact?: boolean;
}

function fmtPrice(value: number, currency: string): string {
  const prefix = currency === "INR" ? "₹" : "";
  return `${prefix}${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export default function AnalystConsensus({ consensus, currentPrice, currency, compact }: AnalystConsensusProps) {
  const { total, buy_pct, hold_pct, sell_pct, consensus_label } = consensus;
  const hasTarget = consensus.target_low !== null && consensus.target_high !== null;
  const badgeTone = consensusTone(consensus_label);

  // Position markers along a single axis spanning [low, high] (padded so the
  // current-price marker never sits exactly on the track's edge).
  let lowPct = 0;
  let meanPct = 50;
  let highPct = 100;
  let currentPct: number | null = null;
  if (hasTarget) {
    const low = consensus.target_low!;
    const high = consensus.target_high!;
    const mean = consensus.target_mean ?? (low + high) / 2;
    const values = [low, high, mean, ...(currentPrice !== null ? [currentPrice] : [])];
    const domainMin = Math.min(...values);
    const domainMax = Math.max(...values);
    const pad = (domainMax - domainMin) * 0.1 || 1;
    const min = domainMin - pad;
    const max = domainMax + pad;
    const toPct = (v: number) => ((v - min) / (max - min)) * 100;
    lowPct = toPct(low);
    meanPct = toPct(mean);
    highPct = toPct(high);
    currentPct = currentPrice !== null ? toPct(currentPrice) : null;
  }

  const upsidePct =
    hasTarget && currentPrice
      ? ((consensus.target_mean ?? (consensus.target_low! + consensus.target_high!) / 2) - currentPrice) /
        currentPrice *
        100
      : null;

  return (
    <div className={`analyst-card ${compact ? "compact" : ""}`}>
      <div className="analyst-header">
        <h3>Analyst Consensus</h3>
        <span className={`analyst-badge ${badgeTone}`}>{consensus_label}</span>
      </div>

      {total > 0 ? (
        <div className="analyst-rating-block">
          <div className="analyst-bar">
            {buy_pct > 0 && <div className="analyst-bar-segment good" style={{ width: `${buy_pct}%` }} />}
            {hold_pct > 0 && <div className="analyst-bar-segment neutral" style={{ width: `${hold_pct}%` }} />}
            {sell_pct > 0 && <div className="analyst-bar-segment bad" style={{ width: `${sell_pct}%` }} />}
          </div>
          <div className="analyst-legend">
            <span className="good">Buy {buy_pct}%</span>
            <span className="neutral">Hold {hold_pct}%</span>
            <span className="bad">Sell {sell_pct}%</span>
          </div>
          <div className="analyst-count">Based on {total} analyst{total === 1 ? "" : "s"}</div>
        </div>
      ) : (
        <div className="analyst-count">No analyst rating coverage for this company.</div>
      )}

      {hasTarget && (
        <div className="analyst-target-block">
          <div className="analyst-target-header">
            <span>Price Target{consensus.target_period ? ` — ${consensus.target_period}` : ""}</span>
            {upsidePct !== null && (
              <span className={`analyst-target-upside ${upsidePct >= 0 ? "good" : "bad"}`}>
                Consensus target implies {upsidePct >= 0 ? "+" : ""}
                {upsidePct.toFixed(1)}% from current price
              </span>
            )}
          </div>
          <div className="analyst-target-track">
            <div className="analyst-target-range" style={{ left: `${lowPct}%`, width: `${highPct - lowPct}%` }} />
            <div className="analyst-target-marker mean" style={{ left: `${meanPct}%` }} title="Mean target" />
            {currentPct !== null && (
              <div className="analyst-target-marker current" style={{ left: `${currentPct}%` }} title="Current price" />
            )}
          </div>
          <div className="analyst-target-labels">
            <div className="analyst-target-label">
              <span className="dot low" />
              Low {fmtPrice(consensus.target_low!, currency)}
            </div>
            <div className="analyst-target-label">
              <span className="dot mean" />
              Mean {fmtPrice(consensus.target_mean ?? (consensus.target_low! + consensus.target_high!) / 2, currency)}
            </div>
            <div className="analyst-target-label">
              <span className="dot high" />
              High {fmtPrice(consensus.target_high!, currency)}
            </div>
            {currentPrice !== null && (
              <div className="analyst-target-label">
                <span className="dot current" />
                Current {fmtPrice(currentPrice, currency)}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="analyst-disclaimer">
        Aggregated third-party sell-side analyst opinion (via Tapetide) -- not FinAI Metrics'
        own view, and not investment advice.
      </div>
    </div>
  );
}

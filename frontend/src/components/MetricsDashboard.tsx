import { useRef, useState } from "react";
import type { CompanyFinancialsResponse } from "../lib/types";
import { formatRawValue } from "../lib/format";
import MetricCard from "./MetricCard";
import HealthSnapshot from "./HealthSnapshot";
import PriceChart from "./PriceChart";
import PriceForecastChart from "./PriceForecastChart";
import AnalystConsensus from "./AnalystConsensus";
import type { Theme } from "../hooks/useTheme";

// One small glyph per metric-group category -- purely for faster visual
// scanning of a dense, 5-group page (matches the sidebar/header icon
// family: 1.6-1.8 stroke, currentColor, no fill). Falls back to no icon
// for a group key this map doesn't recognize, rather than guessing.
const GROUP_ICONS: Record<string, JSX.Element> = {
  liquidity: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 3C12 3 6 10.5 6 15a6 6 0 0 0 12 0c0-4.5-6-12-6-12z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  ),
  profitability: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 19h16M7 19V10M12 19V5M17 19v7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  leverage: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 3v18M6 7l6-4 6 4M4 7h4l-2 6a2 2 0 0 1-4 0l2-6zM16 7h4l-2 6a2 2 0 0 1-4 0l2-6z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  efficiency: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  ),
  valuation: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 7.5v9M9.5 9.8c0-1 1-1.8 2.5-1.8s2.5.7 2.5 1.7c0 2.3-5 1.3-5 3.6 0 1 1 1.7 2.5 1.7s2.5-.8 2.5-1.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
};

// Reused above (top of the collapsed section) and below (end of the
// expanded section) -- so collapsing back doesn't require scrolling all
// the way back up past every metric group first.
function ShowMoreToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <div className="show-more-row">
      <button type="button" className="show-more-pill" onClick={onToggle} aria-expanded={expanded}>
        {expanded ? "Show less" : "Show more"}
        <svg
          className={`show-more-arrow ${expanded ? "open" : ""}`}
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}

interface MetricsDashboardProps {
  data: CompanyFinancialsResponse;
  theme: Theme;
  onTapetideResetAtChange?: (resetAt: string | null) => void;
}

export default function MetricsDashboard({ data, theme, onTapetideResetAtChange }: MetricsDashboardProps) {
  const { info, raw, metric_groups, health_snapshot, analyst_consensus } = data;
  // Collapsed by default -- the two charts + the summary row below are the
  // whole story most of the time; every grouped ratio card (and the raw
  // revenue/assets/etc. figures) are a deliberate "more detail" step behind
  // one click, not the first thing on screen.
  const [expanded, setExpanded] = useState(false);

  const highlights: [string, number | null][] = [
    ["Revenue", raw.revenue],
    ["Net Income", raw.net_income],
    ["Total Assets", raw.total_assets],
    ["Total Liabilities", raw.total_liabilities],
    ["Total Equity", raw.total_equity],
  ];

  const hasForecast =
    !!analyst_consensus &&
    analyst_consensus.target_date !== null &&
    analyst_consensus.target_low !== null &&
    analyst_consensus.target_mean !== null &&
    analyst_consensus.target_high !== null &&
    raw.current_price !== null;

  const hasConsensus = !!analyst_consensus;

  // Refs per group, keyed by group.key, so the quick-jump nav can
  // smooth-scroll .metrics-pane to a specific group without hiding any of
  // the others behind a tab -- every group stays visible and scannable at
  // once, this is purely a faster way to get to one, not a replacement for
  // scrolling.
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});

  function jumpToGroup(key: string) {
    const el = groupRefs.current[key];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div>
      <div className="company-header">
        <div className="company-title">
          <h1>{info.company_name}</h1>
          <span className="company-ticker">
            {info.resolved_symbol} · {info.exchange}
          </span>
        </div>
        {info.sector && (
          <div className="company-meta">
            {info.sector}
            {info.industry ? ` · ${info.industry}` : ""}
          </div>
        )}

        {/* Side by side (was two full-width stacked cards) -- isolated to this
            wrapper + the .charts-row rule in app.css, so reverting to the old
            stacked layout is just deleting this div's tag and that one CSS
            rule, nothing else touched. */}
        <div className="charts-row">
          <PriceChart
            symbol={info.resolved_symbol}
            currency={raw.currency}
            theme={theme}
            onTapetideResetAtChange={onTapetideResetAtChange}
          />

          {hasForecast && (
            <PriceForecastChart
              currentPrice={raw.current_price!}
              currency={raw.currency}
              forecast={analyst_consensus!}
              theme={theme}
            />
          )}
        </div>

        <div className="summary-row">
          <HealthSnapshot snapshot={health_snapshot} compact fullWidth={!hasConsensus} />
          {hasConsensus && (
            <AnalystConsensus
              consensus={analyst_consensus!}
              currentPrice={raw.current_price}
              currency={raw.currency}
              compact
            />
          )}
        </div>
      </div>

      <ShowMoreToggle expanded={expanded} onToggle={() => setExpanded((v) => !v)} />

      {/* Always mounted (never conditionally removed) -- a smooth open/close
          height animation needs the content present throughout, not popped
          in/out at the two extremes. The grid-template-rows 0fr/1fr trick
          animates to the content's real (variable) height without any JS
          measurement, and collapses cleanly regardless of how tall the
          expanded content happens to be for a given company. */}
      <div className={`expanded-details-wrapper ${expanded ? "expanded" : ""}`}>
        <div className="expanded-details">
          {/* Jumps to a group via scrollIntoView -- every group stays fully
              visible and expanded at all times (see the ref comment above),
              this is just a faster way to reach one on a long page, never a
              tab that hides the rest. Sits above the raw-figures row (not
              below it) so it's the first thing seen on expanding, not
              something you have to scroll past a whole row of numbers to
              find. */}
          <div className="group-jump-nav">
            {metric_groups.map((group) => (
              <button
                type="button"
                className="group-jump-pill"
                key={group.key}
                onClick={() => jumpToGroup(group.key)}
              >
                {GROUP_ICONS[group.key]}
                {group.label}
              </button>
            ))}
          </div>

          <div className="highlights-row">
            {highlights.map(([label, value]) => (
              <div className="highlight-tile" key={label}>
                <div className="label">{label}</div>
                <div className="value">{formatRawValue(value, raw.currency)}</div>
              </div>
            ))}
          </div>

          <div className="metric-groups-grid">
            {metric_groups.map((group) => (
              <div
                className="metric-group"
                key={group.key}
                ref={(el) => {
                  groupRefs.current[group.key] = el;
                }}
              >
                <h3>
                  {GROUP_ICONS[group.key]}
                  {group.label}
                </h3>
                <div className="metric-cards">
                  {group.metrics.map((metric) => (
                    <MetricCard metric={metric} key={metric.key} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <ShowMoreToggle expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
        </div>
      </div>
    </div>
  );
}

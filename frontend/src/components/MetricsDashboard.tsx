import { useState } from "react";
import type { CompanyFinancialsResponse } from "../lib/types";
import { formatRawValue } from "../lib/format";
import MetricCard from "./MetricCard";
import HealthSnapshot from "./HealthSnapshot";
import PriceChart from "./PriceChart";
import PriceForecastChart from "./PriceForecastChart";
import AnalystConsensus from "./AnalystConsensus";
import type { Theme } from "../hooks/useTheme";

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
          <div className="highlights-row">
            {highlights.map(([label, value]) => (
              <div className="highlight-tile" key={label}>
                <div className="label">{label}</div>
                <div className="value">{formatRawValue(value, raw.currency)}</div>
              </div>
            ))}
          </div>

          {metric_groups.map((group) => (
            <div className="metric-group" key={group.key}>
              <h3>{group.label}</h3>
              <div className="metric-cards">
                {group.metrics.map((metric) => (
                  <MetricCard metric={metric} key={metric.key} />
                ))}
              </div>
            </div>
          ))}

          <ShowMoreToggle expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
        </div>
      </div>
    </div>
  );
}

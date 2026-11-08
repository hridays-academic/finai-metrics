import { useRef, useState } from "react";
import type { CompanyFinancialsResponse } from "../lib/types";
import { formatRawValue } from "../lib/format";
import { formatDay } from "../lib/leagueFormat";
import MetricCard from "./MetricCard";
import TileGrid from "./TileGrid";
import PriceChart from "./PriceChart";
import FinancialHistory from "./FinancialHistory";
import type { Theme } from "../hooks/useTheme";

// Reused above (top of the collapsed section) and below (end of the
// expanded section) -- so collapsing back doesn't require scrolling all
// the way back up past every metric group first.
function ShowMoreToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <div className="show-more-row">
      <button type="button" className="btn btn-secondary show-more-pill" onClick={onToggle} aria-expanded={expanded}>
        {expanded ? "Hide ratios" : "Show all ratios"}
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
}

export default function MetricsDashboard({ data, theme }: MetricsDashboardProps) {
  const { info, raw, metric_groups } = data;
  const fetched = formatDay(data.fundamentals_as_of ?? new Date().toISOString(), true);
  const period = data.ratios_period_end
    ? data.ratios_period_end.slice(5, 7) === "03"
      ? `FY${data.ratios_period_end.slice(2, 4)} (year to ${formatDay(data.ratios_period_end, true)})`
      : `the year to ${formatDay(data.ratios_period_end, true)}`
    : "the latest year Yahoo has";
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

  // (2026-09) Analyst consensus and price targets are deliberately not
  // shown anywhere: Stackly is a forecast-the-business game and must never
  // display buy/sell/hold calls or share-price targets. AnalystConsensus.tsx
  // and PriceForecastChart.tsx are kept (unrendered) in case that decision
  // is revisited; see CLAUDE.md's Results League decisions.

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
      <div className="company-header glass panel">
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
          />

        </div>

      </div>

      {data.history && <FinancialHistory history={data.history} fetchedAt={data.fundamentals_as_of} currency={raw.currency} />}

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
                {group.label}
              </button>
            ))}
          </div>

          <div className="highlights-row glass panel">
            <TileGrid>
              {highlights.map(([label, value]) => (
                <div className="highlight-tile tile" key={label}>
                  <div className="label">{label}</div>
                  <div className="value">{formatRawValue(value, raw.currency)}</div>
                </div>
              ))}
            </TileGrid>
          </div>

          <div className="metric-groups-grid">
            {metric_groups.map((group) => (
              <div
                className="metric-group glass panel"
                key={group.key}
                ref={(el) => {
                  groupRefs.current[group.key] = el;
                }}
              >
                <h3>
                    {group.label}
                </h3>
                {group.key === "valuation" && (
                  <p className="price-lag-note">
                    {data.price_as_of
                      ? `Uses the share price on ${formatDay(data.price_as_of, true)}. Prices on Stackly are at least 30 days old.`
                      : "No share price at least 30 days old is available, so the price-based figures show N/A."}
                  </p>
                )}
                <TileGrid className="metric-cards">
                  {group.metrics.map((metric) => (
                    <MetricCard metric={metric} key={metric.key} />
                  ))}
                </TileGrid>
                <p className="footnote">
                  {group.key === "growth"
                    ? `Compares ${period} with earlier years.`
                    : `From ${period}.`}{" "}
                  Yahoo Finance, fetched {fetched}. Hover or tap a tile for its formula.
                </p>
              </div>
            ))}
          </div>

          <ShowMoreToggle expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
        </div>
      </div>
    </div>
  );
}

import type { CompanyFinancialsResponse, MetricGroup } from "../lib/types";
import { formatRawValue } from "../lib/format";
import { formatDay } from "../lib/leagueFormat";
import MetricCard from "./MetricCard";
import PriceChart from "./PriceChart";
import FinancialHistory from "./FinancialHistory";
import CompanyNewsPanel from "./news/CompanyNewsPanel";
import CompanyProfilePanel from "./CompanyProfilePanel";
import PeersPanel, { usePeers } from "./PeersPanel";
import AnalysisPanel from "./AnalysisPanel";
import ResearchCard from "./ResearchCard";
import ResearchSectionNav, { type ResearchSection } from "./ResearchSectionNav";
import { useOnceVisible } from "../hooks/useOnceVisible";
import { useLeagueSector } from "../lib/leagueSector";
import { colourClass, DIFFICULTY_LABEL, difficultyOf, fromProviderRows, type DifficultyRow } from "../lib/difficulty";
import { fetchResearchHistory } from "../lib/api";
import { useEffect, useState } from "react";
import type { PeerSummary } from "../lib/types";
import type { Theme } from "../hooks/useTheme";
import FinePrint from "./FinePrint";

// Bars beside the ratios compare values that share a unit within a group
// (a margin with a margin, days with days); a ratio alone in its unit, or
// N/A, gets none.
export function barsFor(group: MetricGroup): Record<string, number | null> {
  const byUnit = new Map<string, number[]>();
  for (const m of group.metrics) {
    if (typeof m.value !== "number") continue;
    const unit = m.unit ?? "";
    byUnit.set(unit, [...(byUnit.get(unit) ?? []), Math.abs(m.value)]);
  }
  return Object.fromEntries(
    group.metrics.map((m) => {
      const peers = byUnit.get(m.unit ?? "") ?? [];
      if (typeof m.value !== "number" || peers.length < 2) return [m.key, null];
      const max = Math.max(...peers);
      return [m.key, max > 0 ? Math.abs(m.value) / max : 0];
    })
  );
}

// One ratio group: a glass panel with its ratios as a list. The bars grow
// once, the first time the list is on screen.
function RatioGroup({ group, period, fetched, priceAsOf }: { group: MetricGroup; period: string; fetched: string; priceAsOf: string | null | undefined }) {
  const [ref, shown] = useOnceVisible<HTMLUListElement>(0.2);
  const bars = barsFor(group);
  return (
    <section className="glass panel ratio-group" aria-labelledby={`ratios-${group.key}`}>
      <h3 className="panel-title" id={`ratios-${group.key}`}>
        {group.label}
      </h3>
      {group.key === "valuation" && (
        <p className="price-lag-note">
          {priceAsOf
            ? `Uses the share price on ${formatDay(priceAsOf, true)}. Prices on Stackly are at least 30 days old.`
            : "No share price at least 30 days old is available, so the price-based figures show N/A."}
        </p>
      )}
      <ul className={`grouped-list ratio-list ${shown ? "bars-shown" : "bars-pending"}`} ref={ref}>
        {group.metrics.map((metric) => (
          <MetricCard metric={metric} bar={bars[metric.key]} key={metric.key} />
        ))}
      </ul>
      <FinePrint>
        {group.key === "growth" ? `Compares ${period} with earlier years.` : `From ${period}.`} Yahoo Finance, fetched{" "}
        {fetched}. Hover or tap a ratio for its formula.
      </FinePrint>
    </section>
  );
}

// This company's row for the peers table, from the ratios already loaded.
export function selfSummary(data: CompanyFinancialsResponse): PeerSummary {
  const m = Object.fromEntries(data.metric_groups.flatMap((g) => g.metrics).map((x) => [x.key, x.value]));
  const quarters = data.history?.quarterly ?? [];
  const latest = quarters.find((q) => q.revenue !== null)?.period_end_date ?? null;
  return {
    symbol: data.info.resolved_symbol,
    name: data.info.company_name,
    revenue_growth: m.revenue_growth ?? null,
    ebitda_margin: m.ebitda_margin ?? null,
    net_margin: m.net_margin ?? null,
    roe: m.roe ?? null,
    roce: m.roce ?? null,
    debt_to_equity: m.debt_to_equity ?? null,
    pe_ratio: m.pe_ratio ?? null,
    ev_to_ebitda: m.ev_to_ebitda ?? null,
    latest_quarter: latest,
    reported_latest_quarter: latest !== null && latest === quarters[0]?.period_end_date,
    fundamentals_as_of: data.fundamentals_as_of ?? null,
  };
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
  const peerSymbols = data.profile?.peers ?? [];
  const peerRows = usePeers(peerSymbols);
  const league = useLeagueSector(info.resolved_symbol);

  // The company's colour says how hard it is to forecast (lib/difficulty):
  // a league company is measured on the league's history, as on Home and its
  // company page, so the colour matches everywhere; any other company on the
  // quarterly figures shown here.
  const [leagueRows, setLeagueRows] = useState<DifficultyRow[] | null>(null);
  useEffect(() => {
    setLeagueRows(null);
    if (league.companyId === null) return;
    let cancelled = false;
    fetchResearchHistory(league.companyId)
      .then((h) => !cancelled && setLeagueRows(fromProviderRows(h.provider_rows)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [league.companyId]);
  const ownRows: DifficultyRow[] = (data.history?.quarterly ?? []).map((q) => ({
    period_end_date: q.period_end_date,
    revenue: q.revenue,
    margin: q.ebitda_margin_pct,
  }));
  const level = difficultyOf(league.companyId !== null ? leagueRows ?? [] : ownRows);
  const colour = colourClass(level);

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

  const revenues = [...(data.history?.quarterly ?? [])].reverse().map((q) => q.revenue);
  const nextResults = data.profile?.next_results_date;

  const sections: ResearchSection[] = [
    ...(data.profile ? [{ id: "research-profile", label: "Profile" }] : []),
    ...(data.history ? [{ id: "research-history", label: "History" }] : []),
    ...(peerSymbols.length > 0 ? [{ id: "research-peers", label: "Peers" }] : []),
    ...(data.analysis ? [{ id: "research-analysis", label: "Analysis" }] : []),
    { id: "research-news", label: "News" },
    { id: "research-ratios", label: "Ratios" },
  ];

  return (
    <div className={`research-company company-colour ${colour}`}>
      <header className="glass panel research-hero">
        <div className="research-hero-top">
          <div className="research-hero-text">
            {info.sector && (
              <p className="research-hero-meta">
                {info.sector}
                {info.industry ? ` · ${info.industry}` : ""}
              </p>
            )}
            <h1 className="research-hero-title">{info.company_name}</h1>
            <p className="research-hero-ticker">
              {info.resolved_symbol} · {info.exchange}
            </p>
          </div>
          <ResearchCard
            key={info.resolved_symbol}
            name={info.company_name}
            ticker={info.resolved_symbol}
            colour={colour}
            difficulty={level ? DIFFICULTY_LABEL[level] : null}
            sectorLabel={league.label ?? info.sector}
            revenues={revenues}
            foot={nextResults ? `Results ${formatDay(nextResults)}` : info.exchange}
          />
        </div>
        <dl className="research-figures">
          {highlights.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{formatRawValue(value, raw.currency)}</dd>
            </div>
          ))}
        </dl>
        <FinePrint>
          From {period}. Yahoo Finance, fetched {fetched}.
        </FinePrint>
        <div className="research-price">
          <PriceChart symbol={info.resolved_symbol} currency={raw.currency} theme={theme} />
        </div>
      </header>

      <ResearchSectionNav sections={sections} />

      {data.profile && (
        <div id="research-profile" className="research-anchor">
          <CompanyProfilePanel profile={data.profile} name={info.company_name} />
        </div>
      )}

      {data.history && (
        <div id="research-history" className="research-anchor">
          <FinancialHistory history={data.history} fetchedAt={data.fundamentals_as_of} currency={raw.currency} />
        </div>
      )}

      {peerSymbols.length > 0 && (
        <div id="research-peers" className="research-anchor">
          <PeersPanel self={selfSummary(data)} peers={peerSymbols} rows={peerRows} />
        </div>
      )}

      {data.analysis && (
        <div id="research-analysis" className="research-anchor">
          <AnalysisPanel analysis={data.analysis} peers={peerRows} fetchedAt={data.fundamentals_as_of} />
        </div>
      )}

      <div id="research-news" className="research-anchor">
        <CompanyNewsPanel symbol={info.resolved_symbol} name={info.company_name} />
      </div>

      <section id="research-ratios" className="research-anchor research-ratios" aria-labelledby="ratios-title">
        <h2 className="section-title" id="ratios-title">
          Ratios
        </h2>
        <div className="ratio-groups">
          {metric_groups.map((group) => (
            <RatioGroup key={group.key} group={group} period={period} fetched={fetched} priceAsOf={data.price_as_of} />
          ))}
        </div>
      </section>
    </div>
  );
}

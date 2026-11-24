import { formatDay } from "../../lib/leagueFormat";
import type { EventSummary, OutcomeMetric } from "../../lib/types";

// How a scored company turned out, for everyone (2026-11-12, wording approved
// by Hriday). Shared by the results page (no forecast or signed out), the
// company page after scoring and Home's "Recent results".

export const LEAGUE_FOOTNOTE =
  "These are Stackly's league numbers, worked out from the company's own filing using the league's definitions. " +
  "They can differ from Yahoo Finance figures on the Research page.";

export const NO_FORECAST_LINE = "You didn't forecast this company, so there's no score for you here.";

// Growth metrics read as changes ("+13.0%"); the margin is a level ("18.2%").
export function formatOutcome(value: number | null, metricKey: string, unit: string): string {
  if (value === null) return "N/A";
  const sign = metricKey !== "operating_margin" && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}${unit === "%" ? "%" : ` ${unit}`}`;
}

// Each sector's KPI in a few words, for the one-line summary on Home.
const KPI_SHORT: Record<string, string> = {
  cement: "volume growth",
  fmcg: "volume growth",
  autos: "units sold growth",
  it: "constant-currency growth",
};

const SHORT: Record<string, string> = { revenue_growth_yoy: "revenue growth", operating_margin: "margin" };

// "Revenue growth", "Margin", "Volume growth": the label over Home's small lines.
export function metricShortName(m: OutcomeMetric, sector: string): string {
  const name = SHORT[m.metric_key] ?? KPI_SHORT[sector] ?? m.label.replace(/\s*\(YoY\)$/, "").toLowerCase();
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// "Revenue growth +13.0%, margin 18.2%, volume growth +10.0%"
export function outcomeSummary(metrics: OutcomeMetric[], sector: string): string {
  const text = metrics
    .filter((m) => m.actual !== null)
    .map((m) => {
      const name = SHORT[m.metric_key] ?? KPI_SHORT[sector] ?? m.label.replace(/\s*\(YoY\)$/, "").toLowerCase();
      return `${name} ${formatOutcome(m.actual, m.metric_key, m.unit)}`;
    })
    .join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// T23 (master plan, DRAFT wording): IT companies earn mostly in dollars, so
// when reported growth and constant-currency growth differ by more than 2
// points, say it was the rupee and give the gap. Null otherwise.
export function rupeeNote(metrics: { metric_key: string; actual: number | null }[], sector: string): string | null {
  if (sector !== "it") return null;
  const reported = metrics.find((m) => m.metric_key === "revenue_growth_yoy")?.actual ?? null;
  const cc = metrics.find((m) => m.metric_key === "sector_kpi")?.actual ?? null;
  if (reported === null || cc === null) return null;
  const gap = Math.round(Math.abs(reported - cc) * 10) / 10;
  if (gap <= 2) return null;
  const r = formatOutcome(reported, "revenue_growth_yoy", "%");
  const c = formatOutcome(cc, "sector_kpi", "%");
  return reported > cc
    ? `Revenue grew ${r} in rupees but ${c} in constant currency. Most of the ${gap.toFixed(1)}-point gap is the rupee: it was weaker against the dollar, so each dollar earned was worth more rupees.`
    : `Revenue grew ${r} in rupees but ${c} in constant currency. Most of the ${gap.toFixed(1)}-point gap is the rupee: it was stronger against the dollar, so each dollar earned was worth fewer rupees.`;
}

export function OutcomeList({ metrics, sector = "" }: { metrics: OutcomeMetric[]; sector?: string }) {
  const rupee = rupeeNote(metrics, sector);
  return (
    <>
      <ul className="group outcome-list">
      {metrics.map((m, i) => (
        <li key={m.metric_key} className="outcome-metric" data-scrub="row" data-i={i}>
          <div className="outcome-head">
            <h3 className="outcome-label">{m.label}</h3>
            <span className="outcome-value">{formatOutcome(m.actual, m.metric_key, m.unit)}</span>
          </div>
          <div className="outcome-facts">
            <span>
              Last year (the lazy guess): <strong>{formatOutcome(m.lazy, m.metric_key, m.unit)}</strong>
            </span>
            {m.crowd_median !== null && (
              <span>
                Crowd median: <strong>{formatOutcome(m.crowd_median, m.metric_key, m.unit)}</strong>
              </span>
            )}
          </div>
          {m.note && <p className="outcome-note">{m.note}</p>}
          {m.source_url && (
            <p className="outcome-source">
              Source:{" "}
              <a href={m.source_url} target="_blank" rel="noopener noreferrer">
                {hostOf(m.source_url)}
              </a>
            </p>
          )}
        </li>
      ))}
      </ul>
      {/* Hriday 2026-11-24: one full-width line under the cards, not inside one. */}
      {rupee && <p className="outcome-note outcome-rupee">{rupee}</p>}
    </>
  );
}

export function resultsDateLine(event: EventSummary): string {
  return `${event.season_label} results, announced ${formatDay(event.results_date, true)}.`;
}

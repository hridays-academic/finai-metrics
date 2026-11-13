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

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function OutcomeList({ metrics }: { metrics: OutcomeMetric[] }) {
  return (
    <ul className="group outcome-list">
      {metrics.map((m) => (
        <li key={m.metric_key} className="outcome-metric reveal-row">
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
  );
}

// "Yahoo Finance puts the operating margin at 16.6%; the league's figure is
// 18.2%. ..." Only when Yahoo's latest quarter IS the event's quarter (else
// the two describe different quarters) and the two differ once rounded.
export function yahooLeagueNote(
  yahooMargin: number | null | undefined,
  yahooQuarterEnd: string | undefined,
  event: Pick<EventSummary, "period_end_date">,
  metrics: OutcomeMetric[] | null
): string | null {
  const league = metrics?.find((m) => m.metric_key === "operating_margin")?.actual;
  if (yahooMargin === null || yahooMargin === undefined || league === null || league === undefined) return null;
  if (!yahooQuarterEnd || yahooQuarterEnd.slice(0, 10) !== event.period_end_date.slice(0, 10)) return null;
  const y = yahooMargin.toFixed(1);
  const l = league.toFixed(1);
  if (y === l) return null;
  return (
    `Yahoo Finance puts the operating margin at ${y}%; the league's figure is ${l}%. ` +
    "The league uses its own definition, worked out from the company's filing."
  );
}

export function resultsDateLine(event: EventSummary): string {
  return `${event.season_label} results, announced ${formatDay(event.results_date, true)}.`;
}

import type { Theme } from "../../hooks/useTheme";
import type { ActualRow, EventDetail, ResearchHistory } from "../../lib/types";
import PriceChart from "../PriceChart";
import QuarterSparkline from "./QuarterSparkline";
import { crorePlain, formatCrore, previousQuarterEnds, quarterLabel } from "../../lib/leagueFormat";
import FinePrint from "../FinePrint";

interface ResearchPanelProps {
  event: EventDetail;
  theme: Theme;
  history: ResearchHistory | null;
  historyError: string | null;
  // Opens the Research page with this company loaded (App.tsx).
  onOpenInResearch: (symbol: string) => void;
}

const NA = <span className="cell-na">N/A</span>;

function pct(value: number | null | undefined) {
  return value === null || value === undefined ? NA : `${value.toFixed(1)}%`;
}

function ActualCell({ actual }: { actual: ActualRow | undefined }) {
  if (!actual) return NA;
  // Practice's Mystery mode has no source links (they'd name the company).
  if (!actual.source_url) return <>{actual.value.toFixed(1)}%</>;
  return (
    <a href={actual.source_url} target="_blank" rel="noopener noreferrer">
      {actual.value.toFixed(1)}%<span className="visually-hidden"> (opens the source filing)</span>
    </a>
  );
}


// Practice (2026-11-18): quarter names on Mystery mode's relative calendar,
// and revenue as an index instead of rupees.
export interface PracticeTableOptions {
  quarterName: (end: string) => string;
}

// The eight quarters before the event: Yahoo figures and league figures side by side.
export function QuartersTable({
  event,
  history,
  historyError,
  practice,
}: {
  event: EventDetail;
  history: ResearchHistory | null;
  historyError: string | null;
  practice?: PracticeTableOptions;
}) {
  const quarterName = practice?.quarterName ?? quarterLabel;
  const revenueLabel = practice ? "Revenue index*" : "Revenue*";
  const revenueCell = (v: number | null) => (v === null ? NA : practice ? v.toFixed(0) : formatCrore(v));
  const quarters = previousQuarterEnds(event.period_end_date, 8);
  const byEnd = new Map(history?.provider_rows.map((r) => [r.period_end_date, r]));
  const actual = (end: string, key: string) =>
    history?.actuals.find((a) => a.period_end_date === end && a.metric_key === key);
  const kpiLabel = event.metrics.find((m) => m.key === "sector_kpi")?.label;
  const oldestFirst = [...quarters].reverse();
  // Practice hides quarters with nothing in any column (2026-11-18, Hriday).
  const hasAny = (end: string) => {
    const row = byEnd.get(end);
    return (
      (row?.revenue ?? null) !== null ||
      (row?.operating_margin_pct ?? null) !== null ||
      ["revenue_growth_yoy", "operating_margin", ...(kpiLabel ? ["sector_kpi"] : [])].some((k) => actual(end, k))
    );
  };
  const shownQuarters = practice ? quarters.filter(hasAny) : quarters;
  const shortLabels = oldestFirst.map(quarterName);

  return (
    <>
      <h3 className="subsection-title">Last 8 quarters</h3>
      {historyError && <div className="form-error">{historyError}</div>}
      {!history && !historyError && <p className="empty-note">Loading...</p>}
      {history && (
        <>
          <div className="quarters-layout">
            <div className="quarters-trends">
              <QuarterSparkline
                label={revenueLabel}
                values={oldestFirst.map((end) => byEnd.get(end)?.revenue ?? null)}
                quarterLabels={shortLabels}
                format={practice ? (v) => v.toFixed(0) : crorePlain}
              />
              <QuarterSparkline
                label="Op. margin*"
                values={oldestFirst.map((end) => byEnd.get(end)?.operating_margin_pct ?? null)}
                quarterLabels={shortLabels}
                format={(v) => `${v.toFixed(1)}%`}
              />
            </div>
            <div className="table-wrap">
              <table className="data-table league-history-table">
                <thead>
                  <tr>
                    <th>Quarter</th>
                    <th>{revenueLabel}</th>
                    <th>Op. margin*</th>
                    <th>Revenue growth YoY†</th>
                    <th>Op. margin†</th>
                    {kpiLabel && <th>{kpiLabel}†</th>}
                  </tr>
                </thead>
                <tbody>
                  {shownQuarters.map((end) => {
                    const row = byEnd.get(end);
                    return (
                      <tr key={end}>
                        <td>{quarterName(end)}</td>
                        <td>{revenueCell(row?.revenue ?? null)}</td>
                        <td>{pct(row?.operating_margin_pct)}</td>
                        <td>
                          <ActualCell actual={actual(end, "revenue_growth_yoy")} />
                        </td>
                        <td>
                          <ActualCell actual={actual(end, "operating_margin")} />
                        </td>
                        {kpiLabel && (
                          <td>
                            <ActualCell actual={actual(end, "sector_kpi")} />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {practice ? (
            // One "Sources and notes" in practice, holding both notes.
            <FinePrint>
              <span className="fine-print-line">
                * {history.provider_source}. {history.provider_definition} Revenue is shown as an index: the oldest
                quarter here = 100.
              </span>
              <span className="fine-print-line">
                † From the company's filings under this league's definitions
                {history.actuals.some((x) => x.source_url) ? " (links open the source)" : ""}. These are the same
                definitions your forecast is scored on.
              </span>
            </FinePrint>
          ) : (
            <FinePrint>
              * {history.provider_source}.{" "}
              {history.provider_as_of
                ? `Fetched ${new Date(history.provider_as_of).toLocaleDateString("en-IN")}. `
                : "Not available for this company. "}
              {history.provider_definition}
            </FinePrint>
          )}
          {!practice && (
            <FinePrint>
              † From the company's filings under this league's definitions (links open the source). These are the same
              definitions your forecast is scored on.
            </FinePrint>
          )}
        </>
      )}
    </>
  );
}

// The company page keeps only what a forecaster needs; the full ratio
// analysis lives on the Research page, one click away.
export default function ResearchPanel({ event, theme, history, historyError, onOpenInResearch }: ResearchPanelProps) {
  const symbol = event.company.provider_symbol;

  return (
    <div className="league-research">
      {event.research_notes && (
        <aside className="research-tip" aria-label="Tip from Stackly">
          <div className="research-tip-label">Tip</div>
          <p>{event.research_notes}</p>
        </aside>
      )}

      <QuartersTable event={event} history={history} historyError={historyError} />

      {symbol && (
        <>
          <h3 className="subsection-title">Share price</h3>
          <div className="league-price-chart">
            <PriceChart symbol={symbol} currency={event.company.currency} theme={theme} />
          </div>
          <aside className="research-more" aria-label="Full analysis on the Research page">
            <p>
              Want the full picture? See all ratios, charts and details for {event.company.name} on the Research page.
            </p>
            <button type="button" className="btn btn-secondary" onClick={() => onOpenInResearch(symbol)}>
              Open in Research
            </button>
          </aside>
        </>
      )}
    </div>
  );
}

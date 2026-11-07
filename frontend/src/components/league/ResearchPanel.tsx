import { useEffect, useState } from "react";
import { ApiError, fetchCompany } from "../../lib/api";
import type { Theme } from "../../hooks/useTheme";
import type { ActualRow, CompanyFinancialsResponse, EventDetail, ResearchHistory } from "../../lib/types";
import MetricsDashboard from "../MetricsDashboard";
import QuarterSparkline from "./QuarterSparkline";

interface ResearchPanelProps {
  event: EventDetail;
  theme: Theme;
  history: ResearchHistory | null;
  historyError: string | null;
}

const QUARTER_ENDS = ["03-31", "06-30", "09-30", "12-31"];

// The eight quarter-end dates before the event's own period, newest first.
// Generated rather than taken from the data, so a missing quarter shows as
// N/A instead of silently disappearing (yfinance often skips one).
function previousQuarterEnds(periodEnd: string, count: number): string[] {
  let year = Number(periodEnd.slice(0, 4));
  let idx = QUARTER_ENDS.indexOf(periodEnd.slice(5));
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    idx -= 1;
    if (idx < 0) {
      idx = 3;
      year -= 1;
    }
    out.push(`${year}-${QUARTER_ENDS[idx]}`);
  }
  return out;
}

function quarterLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

const NA = <span className="cell-na">N/A</span>;

function crore(value: number | null) {
  return value === null ? NA : `₹${(value / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 0 })} cr`;
}

function pct(value: number | null | undefined) {
  return value === null || value === undefined ? NA : `${value.toFixed(1)}%`;
}

function ActualCell({ actual }: { actual: ActualRow | undefined }) {
  if (!actual) return NA;
  return (
    <a href={actual.source_url} target="_blank" rel="noopener noreferrer">
      {actual.value.toFixed(1)}%<span className="visually-hidden"> (opens the source filing)</span>
    </a>
  );
}

function crorePlain(value: number): string {
  return `₹${(value / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 0 })} cr`;
}

export default function ResearchPanel({ event, theme, history, historyError }: ResearchPanelProps) {
  const [analysis, setAnalysis] = useState<CompanyFinancialsResponse | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const symbol = event.company.provider_symbol;

  useEffect(() => {
    let cancelled = false;
    if (symbol) {
      fetchCompany(symbol)
        .then((a) => !cancelled && setAnalysis(a))
        .catch((err) => !cancelled && setAnalysisError(err instanceof ApiError ? err.message : "Couldn't load analysis."));
    }
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const quarters = previousQuarterEnds(event.period_end_date, 8);
  const byEnd = new Map(history?.provider_rows.map((r) => [r.period_end_date, r]));
  const actual = (end: string, key: string) =>
    history?.actuals.find((a) => a.period_end_date === end && a.metric_key === key);
  const kpiLabel = event.metrics.find((m) => m.key === "sector_kpi")?.label;
  const oldestFirst = [...quarters].reverse();
  const shortLabels = oldestFirst.map(quarterLabel);

  return (
    <div className="league-research">
      {event.research_notes && (
        <aside className="callout callout-tip reveal-item" aria-label="Tip from Stackly">
          <svg className="explainer-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div>
            <div className="callout-label">Tip</div>
            <p>{event.research_notes}</p>
          </div>
        </aside>
      )}

      <h3 className="subsection-title">Last 8 quarters</h3>
      {historyError && <div className="form-error">{historyError}</div>}
      {!history && !historyError && <p className="empty-note">Loading...</p>}
      {history && (
        <>
          <div className="quarters-layout">
            <div className="quarters-trends">
              <QuarterSparkline
                label="Revenue*"
                values={oldestFirst.map((end) => byEnd.get(end)?.revenue ?? null)}
                quarterLabels={shortLabels}
                format={crorePlain}
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
                    <th>Revenue*</th>
                    <th>Op. margin*</th>
                    <th>Revenue growth YoY†</th>
                    <th>Op. margin†</th>
                    {kpiLabel && <th>{kpiLabel}†</th>}
                  </tr>
                </thead>
                <tbody>
                  {quarters.map((end) => {
                    const row = byEnd.get(end);
                    return (
                      <tr key={end}>
                        <td>{quarterLabel(end)}</td>
                        <td>{crore(row?.revenue ?? null)}</td>
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
          <p className="footnote">
            * {history.provider_source}.{" "}
            {history.provider_as_of
              ? `Fetched ${new Date(history.provider_as_of).toLocaleDateString("en-IN")}. `
              : "Not available for this company. "}
            {history.provider_definition}
          </p>
          <p className="footnote">
            † From the company's filings under this league's definitions (links open the source). These are the same
            definitions your forecast is scored on.
          </p>
        </>
      )}

      {symbol && (
        <>
          <h3 className="subsection-title">Company analysis</h3>
          {analysisError && <div className="form-error">{analysisError}</div>}
          {!analysis && !analysisError && <p className="empty-note">Loading...</p>}
          {analysis && <MetricsDashboard data={analysis} theme={theme} />}
        </>
      )}
    </div>
  );
}

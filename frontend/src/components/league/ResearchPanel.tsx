import { useEffect, useState } from "react";
import { ApiError, fetchCompany, fetchResearchHistory } from "../../lib/api";
import type { Theme } from "../../hooks/useTheme";
import type { ActualRow, CompanyFinancialsResponse, EventDetail, ResearchHistory } from "../../lib/types";
import MetricsDashboard from "../MetricsDashboard";

interface ResearchPanelProps {
  event: EventDetail;
  theme: Theme;
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

const NA = <span className="metric-value na">N/A</span>;

function crore(value: number | null) {
  return value === null ? NA : `₹${(value / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 0 })} cr`;
}

function pct(value: number | null | undefined) {
  return value === null || value === undefined ? NA : `${value.toFixed(1)}%`;
}

function ActualCell({ actual }: { actual: ActualRow | undefined }) {
  if (!actual) return NA;
  return (
    <a href={actual.source_url} target="_blank" rel="noopener noreferrer" title={`Source: ${actual.source_url}`}>
      {actual.value.toFixed(1)}%
    </a>
  );
}

export default function ResearchPanel({ event, theme }: ResearchPanelProps) {
  const [history, setHistory] = useState<ResearchHistory | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<CompanyFinancialsResponse | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const symbol = event.company.provider_symbol;

  useEffect(() => {
    let cancelled = false;
    fetchResearchHistory(event.company.id)
      .then((h) => !cancelled && setHistory(h))
      .catch((err) => !cancelled && setHistoryError(err instanceof ApiError ? err.message : "Couldn't load history."));
    if (symbol) {
      fetchCompany(symbol)
        .then((a) => !cancelled && setAnalysis(a))
        .catch((err) => !cancelled && setAnalysisError(err instanceof ApiError ? err.message : "Couldn't load analysis."));
    }
    return () => {
      cancelled = true;
    };
  }, [event.company.id, symbol]);

  const quarters = previousQuarterEnds(event.period_end_date, 8);
  const byEnd = new Map(history?.provider_rows.map((r) => [r.period_end_date, r]));
  const actual = (end: string, key: string) =>
    history?.actuals.find((a) => a.period_end_date === end && a.metric_key === key);
  const kpiLabel = event.metrics.find((m) => m.key === "sector_kpi")?.label;

  return (
    <div className="league-research">
      {event.research_notes && (
        <div className="league-notes">
          <div className="trading-section-header">Research notes</div>
          <p>{event.research_notes}</p>
        </div>
      )}

      <div className="trading-section-header">Last eight quarters</div>
      {historyError && <div className="search-error">{historyError}</div>}
      {!history && !historyError && <div className="calculator-empty-hint">Loading...</div>}
      {history && (
        <>
          <div className="trading-table-wrap">
            <table className="trading-holdings-table league-history-table">
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
          <p className="calculator-field-note">
            * {history.provider_source}.{" "}
            {history.provider_as_of
              ? `Fetched ${new Date(history.provider_as_of).toLocaleDateString("en-IN")}. `
              : "Not available for this company. "}
            {history.provider_definition}
          </p>
          <p className="calculator-field-note">
            † From the company's filings under this league's definitions (links open the source). These are the same
            definitions your forecast is scored on.
          </p>
        </>
      )}

      {symbol && (
        <>
          <div className="trading-section-header">Company analysis</div>
          {analysisError && <div className="search-error">{analysisError}</div>}
          {!analysis && !analysisError && <div className="calculator-empty-hint">Loading...</div>}
          {analysis && <MetricsDashboard data={analysis} theme={theme} />}
        </>
      )}
    </div>
  );
}

import { FormEvent, useEffect, useState } from "react";
import { adminCompanyActuals, adminCreatePeriod, adminListEvents, adminPutActuals, ApiError, fetchLeagueConfig } from "../../lib/api";
import type { ActualRow, AdminEventRow, LeagueConfig, LeagueMetric } from "../../lib/types";
import { periodEnd } from "./AdminEvents";

type Entry = { value: string; source_url: string };

// Enter reported results for any company period -- the year-ago quarter
// (which yfinance usually lacks) or the new results after announcement.
// Values must be computed exactly per the definition shown; a source link
// to the filing is required for every value.
export default function AdminActuals() {
  const [config, setConfig] = useState<LeagueConfig | null>(null);
  const [events, setEvents] = useState<AdminEventRow[]>([]);
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [fy, setFy] = useState("FY26");
  const [quarter, setQuarter] = useState("2");
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [existing, setExisting] = useState<ActualRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchLeagueConfig().then(setConfig).catch(() => {});
    adminListEvents().then(setEvents).catch((e) => setError(e.message));
  }, []);

  const companies = [...new Map(events.map((e) => [e.company_id, e])).values()];
  const company = companies.find((c) => c.company_id === companyId);
  const loadExisting = (id: number) => adminCompanyActuals(id).then(setExisting).catch((e) => setError(e.message));

  useEffect(() => {
    if (companyId) loadExisting(companyId);
    setEntries({});
  }, [companyId]);

  const metrics: LeagueMetric[] = config
    ? [
        ...config.core_metrics,
        ...config.kpi_templates.filter((t) => t.sector === company?.sector).map((t) => t.metric),
      ]
    : [];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!companyId) return;
    setError(null);
    setMessage(null);
    const items = metrics
      .filter((m) => entries[m.key]?.value)
      .map((m) => ({
        metric_key: m.key,
        definition_key: m.definition_key,
        value: Number(entries[m.key].value),
        source_url: entries[m.key].source_url.trim(),
      }));
    if (items.length === 0) return setError("Enter at least one value.");
    try {
      const period = await adminCreatePeriod({
        company_id: companyId,
        fiscal_year_label: fy,
        fiscal_quarter: Number(quarter),
        period_end_date: periodEnd(fy, Number(quarter), 3),
      });
      await adminPutActuals(period.id, items);
      setMessage(`Saved ${items.length} value(s) for ${fy} Q${quarter}.`);
      setEntries({});
      loadExisting(companyId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save.");
    }
  }

  return (
    <div>
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="trading-section-header">Enter reported results</div>
        <div className="admin-grid">
          <label className="auth-field">
            <span>Company</span>
            <select value={companyId ?? ""} onChange={(e) => setCompanyId(Number(e.target.value) || null)} required>
              <option value="">Choose...</option>
              {companies.map((c) => (
                <option key={c.company_id} value={c.company_id}>
                  {c.company_name} ({c.ticker})
                </option>
              ))}
            </select>
          </label>
          <label className="auth-field">
            <span>Fiscal year</span>
            <input value={fy} onChange={(e) => setFy(e.target.value.toUpperCase())} required />
          </label>
          <label className="auth-field">
            <span>Quarter</span>
            <select value={quarter} onChange={(e) => setQuarter(e.target.value)}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  Q{n}
                </option>
              ))}
            </select>
          </label>
        </div>
        {company && (
          <div className="calculator-field-note">Quarter ending {periodEnd(fy, Number(quarter), 3) || "?"}</div>
        )}

        {company &&
          metrics.map((m) => (
            <div className="calculator-field" key={m.key}>
              <div className="calculator-field-header">
                <span>
                  {m.label} ({m.unit})
                </span>
              </div>
              <details className="league-definition">
                <summary>Definition ({m.definition_key})</summary>
                {m.definition}
              </details>
              <div className="admin-grid">
                <input
                  type="number"
                  step="0.01"
                  placeholder="Value"
                  aria-label={`${m.label} value`}
                  value={entries[m.key]?.value ?? ""}
                  onChange={(e) => setEntries((s) => ({ ...s, [m.key]: { ...s[m.key], value: e.target.value, source_url: s[m.key]?.source_url ?? "" } }))}
                />
                <input
                  type="url"
                  placeholder="https:// link to the filing"
                  aria-label={`${m.label} source link`}
                  required={!!entries[m.key]?.value}
                  value={entries[m.key]?.source_url ?? ""}
                  onChange={(e) => setEntries((s) => ({ ...s, [m.key]: { value: s[m.key]?.value ?? "", source_url: e.target.value } }))}
                />
              </div>
            </div>
          ))}

        {error && <div className="search-error">{error}</div>}
        {message && <div className="calculator-field-note">{message}</div>}
        <button type="submit" className="search-button" disabled={!company}>
          Save results
        </button>
      </form>

      {company && (
        <>
          <div className="trading-section-header">Stored results for {company.company_name}</div>
          {existing.length === 0 ? (
            <div className="calculator-empty-hint">None yet.</div>
          ) : (
            <div className="trading-table-wrap">
              <table className="trading-holdings-table">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Metric</th>
                    <th>Value</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {existing.map((a) => (
                    <tr key={`${a.period_id}-${a.metric_key}`}>
                      <td>
                        {a.fiscal_year_label} Q{a.fiscal_quarter}
                      </td>
                      <td>{a.definition_key}</td>
                      <td>{a.value}</td>
                      <td>
                        <a href={a.source_url} target="_blank" rel="noopener noreferrer">
                          link
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

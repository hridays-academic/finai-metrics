import { FormEvent, useEffect, useState } from "react";
import { adminGetProposal, adminPutResults, ApiError, type ActualInput } from "../../lib/api";
import { formatDay } from "../../lib/leagueFormat";
import type { AdminBoardRow, ProposalMetric, ResultProposal } from "../../lib/types";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const fmt = (v: number | null, unit: string) => (v === null ? "Not saved" : `${v}${unit === "%" ? "%" : ` ${unit}`}`);

// Reviewing committed proposed results (backend/data/proposed_results) before
// they're saved. Approving goes through the normal results endpoint and its
// checks; it never scores. Values can be changed first, and the backend logs
// any change against the proposal.
export default function ReviewResultsPanel({ row, onDone, onCancel }: {
  row: AdminBoardRow;
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const [proposal, setProposal] = useState<ResultProposal | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    adminGetProposal(row.id)
      .then((p) => {
        setProposal(p);
        setValues(Object.fromEntries(p.metrics.map((m) => [m.metric_key, String(m.value)])));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load the proposal."));
  }, [row.id]);

  const edited = (m: ProposalMetric) => values[m.metric_key] !== "" && Number(values[m.metric_key]) !== m.value;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!proposal) return;
    setError(null);
    const blank = proposal.metrics.find((m) => !values[m.metric_key]?.trim() || !Number.isFinite(Number(values[m.metric_key])));
    if (blank) return setError(`Enter a number for ${blank.label}.`);
    const items: ActualInput[] = proposal.metrics.map((m) => ({
      metric_key: m.metric_key,
      definition_key: m.definition_key,
      value: Number(values[m.metric_key]),
      source_url: m.source_url,
    }));
    const changed = proposal.metrics.filter(edited).length;
    setSaving(true);
    try {
      await adminPutResults(row.id, items, true);
      onDone(
        `Saved ${row.company_name}'s results${changed ? ` (${changed} changed from the proposal)` : ""}. Press Score when you're ready.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="admin-panel review-panel" onSubmit={handleSubmit} aria-label={`Review results for ${row.company_name}`}>
      <div className="field-hint">
        Proposed results: {row.fiscal_year_label} Q{row.fiscal_quarter} (quarter ending {formatDay(row.period_end_date, true)}).
        Check each number against its source. You can change any number before approving. Approving saves the results; it
        doesn't score.
      </div>
      {!proposal && !error && <div className="empty-note">Loading...</div>}
      {proposal && (
        <ul className="review-list">
          {proposal.metrics.map((m) => (
            <li key={m.metric_key} className="review-metric">
              <div className="review-head">
                <label className="review-label" htmlFor={`review-${row.id}-${m.metric_key}`}>
                  {m.label} ({m.unit})
                </label>
                {m.flag && (
                  <span className="review-flag" role="note">
                    <svg className="review-flag-icon" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M8 1.5 15 14H1z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                      <path d="M8 6v3.5M8 11.6v.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    Check: {m.flag}
                  </span>
                )}
              </div>
              <div className="review-values">
                <input
                  id={`review-${row.id}-${m.metric_key}`}
                  className="input review-input"
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={values[m.metric_key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [m.metric_key]: e.target.value }))}
                />
                <span className="review-last-year">
                  Last year ({row.year_ago_label} Q{row.fiscal_quarter}): <strong>{fmt(m.last_year_value, m.unit)}</strong>
                </span>
                {edited(m) && <span className="review-edited">Changed. Proposed {fmt(m.value, m.unit)}</span>}
              </div>
              {m.note && <div className="field-hint">{m.note}</div>}
              <div className="review-source">
                Source:{" "}
                <a href={m.source_url} target="_blank" rel="noopener noreferrer">
                  {hostOf(m.source_url)}
                </a>
                , {m.page}
              </div>
              <div className="review-working">
                <span className="review-working-label">Working</span> {m.working}
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <div className="form-error">{error}</div>}
      <div className="admin-inline-actions">
        <button type="submit" className="btn btn-primary" disabled={!proposal || saving} aria-busy={saving}>
          Approve and save
        </button>
        <button type="button" className="btn btn-tertiary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

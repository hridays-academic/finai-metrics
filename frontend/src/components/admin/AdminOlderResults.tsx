import { FormEvent, useEffect, useState } from "react";
import { adminApproveOlderResults, adminListOlderResults, ApiError } from "../../lib/api";
import { formatDay } from "../../lib/leagueFormat";
import type { OlderCompany, OlderMetric, OlderQuarter } from "../../lib/types";

// Older quarters for Practice (Hriday at Stop 2, 25 Nov 2026): Claude's
// proposals in backend/data/proposed_results, approved a company at a time.
// Every number is shown with its source, page and working, and can be
// changed before approving. Approving saves the numbers (and, for a practice
// quarter, a practice-only event); nothing is scored and no league page
// shows them. Admin-only wording.

const key = (q: OlderQuarter, m: OlderMetric) => `${q.fiscal_year_label}-${q.fiscal_quarter}-${m.metric_key}`;
const fmt = (v: number | null, unit: string) => (v === null ? "Not saved" : `${v}${unit === "%" ? "%" : ` ${unit}`}`);
const STATUS: Record<OlderQuarter["status"], string> = { new: "New", saved: "Saved", differs: "Differs from Stackly" };

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function CompanyReview({ company, onSaved }: { company: OlderCompany; onSaved: (msg: string) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(company.quarters.flatMap((q) => q.metrics.map((m) => [key(q, m), String(m.value)])))
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const flags = company.quarters.reduce((n, q) => n + q.metrics.filter((m) => m.flag).length, 0);
  const pending = company.quarters.filter((q) => q.status !== "saved").length;

  async function approve(e: FormEvent) {
    e.preventDefault();
    setError(null);
    for (const q of company.quarters)
      for (const m of q.metrics) {
        const v = values[key(q, m)];
        if (!v?.trim() || !Number.isFinite(Number(v)))
          return setError(`Enter a number for ${m.label}, ${q.fiscal_year_label} Q${q.fiscal_quarter}.`);
      }
    setSaving(true);
    try {
      const res = await adminApproveOlderResults(company.ticker, {
        quarters: company.quarters.map((q) => ({
          fiscal_year_label: q.fiscal_year_label,
          fiscal_quarter: q.fiscal_quarter,
          metrics: q.metrics.map((m) => ({ metric_key: m.metric_key, definition_key: m.definition_key, value: Number(values[key(q, m)]) })),
        })),
      });
      onSaved(
        `Saved ${res.quarters_saved} quarters for ${company.company}` +
          (res.archive_events_created ? `; ${res.archive_events_created} added to Practice.` : ".")
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="older-company">
      <summary>
        <strong>{company.company}</strong> ({company.ticker}): {company.quarters.length} quarters
        {pending ? `, ${pending} to approve` : ", all saved"}
        {flags ? `, ${flags} to check` : ""}
      </summary>
      <form className="admin-panel review-panel" onSubmit={approve} aria-label={`Older results for ${company.company}`}>
        {!company.in_stackly && <div className="form-error">This company isn't in Stackly yet. Add its league event first.</div>}
        {company.quarters.map((q) => (
          <fieldset key={`${q.fiscal_year_label}-${q.fiscal_quarter}`} className="older-quarter">
            <legend>
              {q.fiscal_year_label} Q{q.fiscal_quarter}: {q.use === "practice" ? "for Practice" : "last year's figures only"}
              {q.results_date ? `, results ${formatDay(q.results_date, true)}` : ""} · {STATUS[q.status]}
            </legend>
            <ul className="review-list">
              {q.metrics.map((m) => {
                const id = `older-${company.ticker}-${key(q, m)}`;
                const changed = values[key(q, m)] !== "" && Number(values[key(q, m)]) !== m.value;
                return (
                  <li key={m.metric_key} className="review-metric">
                    <div className="review-head">
                      <label className="review-label" htmlFor={id}>
                        {m.label} ({m.unit})
                      </label>
                      {m.flag && (
                        <span className="review-flag" role="note">
                          Check: {m.flag}
                        </span>
                      )}
                    </div>
                    <div className="review-values">
                      <input
                        id={id}
                        className="input review-input"
                        type="number"
                        step="0.01"
                        inputMode="decimal"
                        value={values[key(q, m)] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [key(q, m)]: e.target.value }))}
                      />
                      <span className="review-last-year">
                        In Stackly now: <strong>{fmt(m.saved, m.unit)}</strong>
                      </span>
                      {changed && <span className="review-edited">Changed. Proposed {fmt(m.value, m.unit)}</span>}
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
                );
              })}
            </ul>
          </fieldset>
        ))}
        {error && <div className="form-error">{error}</div>}
        <div className="admin-inline-actions">
          <button type="submit" className="btn btn-primary" disabled={saving || !company.in_stackly} aria-busy={saving}>
            Approve all {company.quarters.length} quarters for {company.company}
          </button>
        </div>
      </form>
    </details>
  );
}

export default function AdminOlderResults() {
  const [companies, setCompanies] = useState<OlderCompany[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = () =>
    adminListOlderResults()
      .then(setCompanies)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load the proposals."));
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="admin-section">
      <p className="field-hint">
        Past quarters researched from each company's filings. Check each number against its source, change any you need to,
        then approve a company. Practice quarters are added to Practice and quick rounds; last year's figures only fill in the
        lazy guess. Nothing is scored, and league pages don't show these quarters.
      </p>
      {message && (
        <div className="form-success" role="status">
          {message}
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
      {!companies && !error && <div className="empty-note">Loading...</div>}
      {companies?.length === 0 && <div className="empty-note">No older quarters are waiting.</div>}
      {companies?.map((c) => (
        <CompanyReview
          key={`${c.ticker}-${c.quarters.map((q) => q.status).join("")}`}
          company={c}
          onSaved={(msg) => {
            setMessage(msg);
            load();
          }}
        />
      ))}
    </div>
  );
}

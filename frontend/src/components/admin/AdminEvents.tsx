import { FormEvent, useEffect, useState } from "react";
import { adminListEvents, adminPatchEvent, adminQuickEvent, ApiError, fetchLeagueConfig } from "../../lib/api";
import type { AdminEventRow, LeagueConfig } from "../../lib/types";
import { formatIst } from "../league/LockCountdown";

// Last day of fiscal quarter `q` of fiscal year FY`yy` for a company whose
// year ends in month `fyeMonth` (India: 3 = March, so FY27 Q2 = 30 Sep 2026).
export function periodEnd(fyLabel: string, q: number, fyeMonth: number): string {
  const yy = Number(fyLabel.replace(/\D/g, ""));
  if (!yy || q < 1 || q > 4) return "";
  const fy = yy < 100 ? 2000 + yy : yy;
  const d = new Date(Date.UTC(fy - 1, fyeMonth + 3 * q, 0));
  return d.toISOString().slice(0, 10);
}

// datetime-local value (no zone) interpreted as India time.
function istToIso(local: string): string | null {
  return local ? `${local}:00+05:30` : null;
}

const EMPTY = {
  exchange: "NSE",
  ticker: "",
  company_name: "",
  sector: "",
  provider_symbol: "",
  fiscal_year_label: "FY27",
  fiscal_quarter: "2",
  results_date: "",
  lock_local: "",
  include_kpi: true,
  research_notes: "",
  open_now: true,
};

export default function AdminEvents() {
  const [config, setConfig] = useState<LeagueConfig | null>(null);
  const [events, setEvents] = useState<AdminEventRow[] | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = () => adminListEvents().then(setEvents).catch((e) => setError(e.message));
  useEffect(() => {
    fetchLeagueConfig().then(setConfig).catch(() => {});
    reload();
  }, []);

  const q = Number(form.fiscal_quarter);
  const end = periodEnd(form.fiscal_year_label, q, 3);
  const season = `Q${q} ${form.fiscal_year_label.toUpperCase()}`;
  const hasKpiTemplate = !!config?.kpi_templates.find((t) => t.sector === form.sector);
  const set = (k: keyof typeof EMPTY, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await adminQuickEvent({
        exchange: form.exchange,
        ticker: form.ticker,
        company_name: form.company_name,
        sector: form.sector,
        provider_symbol: form.provider_symbol || `${form.ticker.toUpperCase()}.${form.exchange === "BSE" ? "BO" : "NS"}`,
        fiscal_year_label: form.fiscal_year_label,
        fiscal_quarter: q,
        period_end_date: end,
        results_date: form.results_date,
        lock_at: istToIso(form.lock_local),
        include_kpi: form.include_kpi && hasKpiTemplate,
        research_notes: form.research_notes || null,
        season_label: season,
        open_now: form.open_now,
      });
      setMessage(`Created event #${res.id}.`);
      setForm({ ...EMPTY, fiscal_year_label: form.fiscal_year_label, fiscal_quarter: form.fiscal_quarter });
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the event.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="trading-section-header">Quick setup: one event</div>
        <div className="admin-grid">
          <label className="auth-field">
            <span>Company name</span>
            <input value={form.company_name} onChange={(e) => set("company_name", e.target.value)} required />
          </label>
          <label className="auth-field">
            <span>Ticker</span>
            <input value={form.ticker} onChange={(e) => set("ticker", e.target.value.toUpperCase())} required />
          </label>
          <label className="auth-field">
            <span>Exchange</span>
            <select value={form.exchange} onChange={(e) => set("exchange", e.target.value)}>
              <option>NSE</option>
              <option>BSE</option>
            </select>
          </label>
          <label className="auth-field">
            <span>Sector</span>
            <select value={form.sector} onChange={(e) => set("sector", e.target.value)} required>
              <option value="">Choose...</option>
              {config?.kpi_templates.map((t) => (
                <option key={t.sector} value={t.sector}>
                  {t.sector}
                </option>
              ))}
              <option value="other">other (no KPI)</option>
            </select>
          </label>
          <label className="auth-field">
            <span>Fiscal year</span>
            <input value={form.fiscal_year_label} onChange={(e) => set("fiscal_year_label", e.target.value)} required />
          </label>
          <label className="auth-field">
            <span>Quarter</span>
            <select value={form.fiscal_quarter} onChange={(e) => set("fiscal_quarter", e.target.value)}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  Q{n}
                </option>
              ))}
            </select>
          </label>
          <label className="auth-field">
            <span>Results date</span>
            <input type="date" value={form.results_date} onChange={(e) => set("results_date", e.target.value)} required />
          </label>
          <label className="auth-field">
            <span>Lock time (IST, optional)</span>
            <input type="datetime-local" value={form.lock_local} onChange={(e) => set("lock_local", e.target.value)} />
            <span className="auth-field-hint">Default: 11:59 pm the day before results</span>
          </label>
        </div>
        <div className="calculator-field-note">
          {season}, quarter ending {end || "?"} · yfinance symbol{" "}
          {form.provider_symbol || (form.ticker ? `${form.ticker}.${form.exchange === "BSE" ? "BO" : "NS"}` : "?")}
        </div>
        {hasKpiTemplate && (
          <label className="league-radio">
            <input type="checkbox" checked={form.include_kpi} onChange={(e) => set("include_kpi", e.target.checked)} />
            Include the {form.sector} KPI (only if this company reports it every quarter)
          </label>
        )}
        <label className="auth-field">
          <span>Research notes (shown to forecasters)</span>
          <textarea rows={2} value={form.research_notes} onChange={(e) => set("research_notes", e.target.value)} />
        </label>
        <label className="league-radio">
          <input type="checkbox" checked={form.open_now} onChange={(e) => set("open_now", e.target.checked)} />
          Open for forecasts now (otherwise saved as a draft)
        </label>
        {error && <div className="search-error">{error}</div>}
        {message && <div className="calculator-field-note">{message}</div>}
        <button type="submit" className="search-button" disabled={saving}>
          {saving ? "Creating..." : "Create event"}
        </button>
      </form>

      <div className="trading-section-header">Events</div>
      {events && events.length === 0 && <div className="calculator-empty-hint">No events yet.</div>}
      {events && events.length > 0 && (
        <div className="trading-table-wrap">
          <table className="trading-holdings-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Company</th>
                <th>Status</th>
                <th>Lock (IST)</th>
                <th>Results</th>
                <th>Forecasts</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <EventRow key={ev.id} ev={ev} onChanged={reload} onError={setError} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EventRow({ ev, onChanged, onError }: { ev: AdminEventRow; onChanged: () => void; onError: (m: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [lockLocal, setLockLocal] = useState("");
  const [notes, setNotes] = useState("");

  async function patch(body: Record<string, unknown>) {
    try {
      await adminPatchEvent(ev.id, body);
      setEditing(false);
      onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Couldn't update the event.");
    }
  }

  return (
    <>
      <tr>
        <td>{ev.id}</td>
        <td>
          <div className="trading-table-stock-name">{ev.company_name}</div>
          <div className="trading-table-stock-ticker">
            {ev.ticker} · {ev.season_label} · {ev.sector}
          </div>
        </td>
        <td>{ev.status === "open" && ev.lock_passed ? "locked" : ev.status}</td>
        <td>{formatIst(ev.lock_at)}</td>
        <td>{ev.results_date}</td>
        <td>{ev.forecasts}</td>
        <td>
          {ev.status !== "scored" && (
            <button type="button" className="settings-row-action" onClick={() => setEditing((v) => !v)}>
              Edit
            </button>
          )}
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={7}>
            <div className="admin-inline-edit">
              {!ev.lock_passed && (
                <label className="auth-field">
                  <span>New lock time (IST)</span>
                  <input type="datetime-local" value={lockLocal} onChange={(e) => setLockLocal(e.target.value)} />
                </label>
              )}
              <label className="auth-field">
                <span>Research notes (replaces the current notes)</span>
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>
              <div className="admin-inline-actions">
                {lockLocal && (
                  <button type="button" className="settings-row-action" onClick={() => patch({ lock_at: istToIso(lockLocal) })}>
                    Save lock time
                  </button>
                )}
                <button type="button" className="settings-row-action" onClick={() => patch({ research_notes: notes })}>
                  Save notes
                </button>
                <button
                  type="button"
                  className="settings-row-action"
                  onClick={() => patch({ status: ev.status === "open" ? "draft" : "open" })}
                >
                  {ev.status === "open" ? "Move to draft" : "Open for forecasts"}
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

import { FormEvent, useEffect, useState } from "react";
import {
  adminListEvents,
  adminPatchEvent,
  adminPutLastYear,
  adminPutResults,
  adminQuickEvent,
  adminScoreEvent,
  ApiError,
  fetchLeagueConfig,
  type ActualInput,
} from "../../lib/api";
import { formatDay } from "../../lib/leagueFormat";
import type { AdminBoardRow, BoardStatus, LeagueConfig } from "../../lib/types";
import { formatIst } from "../league/LockCountdown";

// Last day of fiscal quarter `q` of fiscal year FY`yy` for a company whose
// year ends in month `fyeMonth` (India: 3 = March, so FY27 Q2 = 30 Sep 2026).
function periodEnd(fyLabel: string, q: number, fyeMonth: number): string {
  const yy = Number(fyLabel.replace(/\D/g, ""));
  if (!yy || q < 1 || q > 4) return "";
  const fy = yy < 100 ? 2000 + yy : yy;
  return new Date(Date.UTC(fy - 1, fyeMonth + 3 * q, 0)).toISOString().slice(0, 10);
}

// datetime-local value (no zone) interpreted as India time.
function istToIso(local: string): string | null {
  return local ? `${local}:00+05:30` : null;
}

const STATUS_LABEL: Record<BoardStatus, string> = {
  needs_last_year: "Needs last year's numbers",
  hidden: "Hidden",
  open: "Open for forecasts",
  results_due: "Results due: enter numbers",
  ready_to_score: "Ready to score",
  scored: "Scored",
  rescore_needed: "Results changed: re-score",
};

type Panel = { id: number; mode: "last_year" | "results" | "edit" } | null;

// The admin page's main view: one list of companies, each with a plain
// status and one button for the next step (2026-10).
export default function AdminCompanies() {
  const [config, setConfig] = useState<LeagueConfig | null>(null);
  const [rows, setRows] = useState<AdminBoardRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reload = () =>
    adminListEvents()
      .then(setRows)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load companies."));

  useEffect(() => {
    fetchLeagueConfig().then(setConfig).catch(() => {});
    reload();
  }, []);

  async function openNow(row: AdminBoardRow) {
    setError(null);
    try {
      await adminPatchEvent(row.id, { status: "open" });
      setMessage(`${row.company_name} is open for forecasts.`);
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't open it.");
    }
  }

  async function score(row: AdminBoardRow) {
    setError(null);
    setMessage(`Scoring ${row.company_name}...`);
    try {
      const res = await adminScoreEvent(row.id);
      setMessage(`Scored ${res.scored} forecast${res.scored === 1 ? "" : "s"} for ${row.company_name}.`);
      reload();
    } catch (e) {
      setMessage(null);
      setError(e instanceof ApiError ? e.message : "Couldn't score.");
    }
  }

  function done(text: string) {
    setMessage(text);
    setPanel(null);
    reload();
  }

  return (
    <div>
      <div className="admin-board-actions">
        <button type="button" className="search-button" onClick={() => setAdding((v) => !v)}>
          {adding ? "Close" : "Add a company"}
        </button>
      </div>
      {adding && config && (
        <AddCompanyForm
          config={config}
          onAdded={(id, name) => {
            setAdding(false);
            setMessage(`Added ${name}. It stays hidden until last year's numbers are in.`);
            setPanel({ id, mode: "last_year" });
            reload();
          }}
        />
      )}
      {error && <div className="search-error">{error}</div>}
      {message && <div className="calculator-field-note">{message}</div>}

      <div className="trading-section-header">Companies</div>
      {rows === null && !error && <div className="calculator-empty-hint">Loading...</div>}
      {rows && rows.length === 0 && <div className="calculator-empty-hint">No companies yet. Add one above.</div>}
      {rows && rows.length > 0 && (
        <ul className="admin-board">
          {rows.map((row) => (
            <li key={row.id} className="admin-board-row">
              <div className="admin-board-main">
                <div className="admin-board-info">
                  <div className="trading-table-stock-name">{row.company_name}</div>
                  <div className="trading-table-stock-ticker">
                    {row.ticker} · {row.season_label} · {row.sector} · results {formatDay(row.results_date)} ·{" "}
                    {row.forecasts} forecast{row.forecasts === 1 ? "" : "s"}
                  </div>
                </div>
                <span className={`admin-status admin-status-${row.status}`}>{STATUS_LABEL[row.status]}</span>
                <NextStep row={row} onPanel={setPanel} onOpen={openNow} onScore={score} />
              </div>
              {panel?.id === row.id && panel.mode !== "edit" && (
                <NumbersPanel
                  row={row}
                  mode={panel.mode}
                  onSwitch={row.status === "scored" || row.status === "rescore_needed" ? (mode) => setPanel({ id: row.id, mode }) : undefined}
                  onDone={done}
                  onCancel={() => setPanel(null)}
                />
              )}
              {panel?.id === row.id && panel.mode === "edit" && (
                <EditPanel row={row} onDone={done} onCancel={() => setPanel(null)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NextStep({ row, onPanel, onOpen, onScore }: {
  row: AdminBoardRow;
  onPanel: (p: Panel) => void;
  onOpen: (r: AdminBoardRow) => void;
  onScore: (r: AdminBoardRow) => void;
}) {
  const button = (label: string, onClick?: () => void) => (
    <button type="button" className="settings-row-action admin-next" onClick={onClick} disabled={!onClick}>
      {label}
    </button>
  );
  switch (row.status) {
    case "needs_last_year":
      return button("Enter last year's numbers", () => onPanel({ id: row.id, mode: "last_year" }));
    case "hidden":
      return button("Open for forecasts", () => onOpen(row));
    case "open":
      return button("Edit", () => onPanel({ id: row.id, mode: "edit" }));
    case "results_due":
      return button("Enter results", () => onPanel({ id: row.id, mode: "results" }));
    case "ready_to_score":
      return button("Score", () => onScore(row));
    case "rescore_needed":
      return button("Re-score", () => onScore(row));
    case "scored":
      // A typo can be fixed after scoring; the board then asks for a re-score.
      return button("Correct a result", () => onPanel({ id: row.id, mode: "results" }));
    default:
      return null;
  }
}

type Entry = { value: string; source_url: string };

// "FY26" -> "FY25", for the revenue-growth hint.
function yearBefore(label: string): string {
  return label.replace(/\d+/, (d) => String(Number(d) - 1).padStart(d.length, "0"));
}

function NumbersPanel({ row, mode, onSwitch, onDone, onCancel }: {
  row: AdminBoardRow;
  mode: "last_year" | "results";
  onSwitch?: (mode: "last_year" | "results") => void;
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const missing = mode === "last_year" ? row.missing_last_year : row.missing_results;
  const label = mode === "last_year" ? `${row.year_ago_label} Q${row.fiscal_quarter}` : `${row.fiscal_year_label} Q${row.fiscal_quarter}`;
  // Plain string math: a Date round trip shifts the day in non-UTC timezones.
  const end =
    mode === "last_year"
      ? `${Number(row.period_end_date.slice(0, 4)) - 1}${row.period_end_date.slice(4)}`
      : row.period_end_date;

  const set = (key: string, field: keyof Entry, value: string) =>
    setEntries((s) => ({ ...s, [key]: { ...(s[key] ?? { value: "", source_url: "" }), [field]: value } }));

  // Most numbers come from one filing: fill blank source links with the first one typed.
  function spreadSource(value: string) {
    if (!value.trim()) return;
    setEntries((s) => {
      const next = { ...s };
      for (const m of row.metrics) {
        if (!next[m.key]?.source_url) next[m.key] = { value: next[m.key]?.value ?? "", source_url: value };
      }
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const items: ActualInput[] = row.metrics
      .filter((m) => entries[m.key]?.value)
      .map((m) => ({
        metric_key: m.key,
        definition_key: m.definition_key,
        value: Number(entries[m.key].value),
        source_url: entries[m.key].source_url.trim(),
      }));
    if (items.length === 0) return setError("Enter at least one number.");
    setSaving(true);
    try {
      if (mode === "last_year") {
        const res = await adminPutLastYear(row.id, items);
        onDone(res.opened ? `Saved. ${row.company_name} is now open for forecasts.` : `Saved ${items.length} number(s) for ${label}.`);
      } else {
        await adminPutResults(row.id, items);
        onDone(`Saved ${items.length} result(s) for ${row.company_name}.`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="auth-form admin-panel" onSubmit={handleSubmit}>
      <div className="calculator-field-note">
        {mode === "last_year" ? "Last year's numbers" : "Reported results"}: {label} (quarter ending{" "}
        {formatDay(end, true)}).{" "}
        {mode === "last_year" && "Once every number is saved, the company opens for forecasts. "}
        Compute each value exactly per its definition, and link the filing it came from.
        {mode === "last_year" && " These numbers are also the lazy guess each forecast is compared with."}
      </div>
      {onSwitch && (
        <button type="button" className="auth-forgot-link" onClick={() => onSwitch(mode === "results" ? "last_year" : "results")}>
          {mode === "results" ? "Correct last year's numbers instead" : "Correct this quarter's results instead"}
        </button>
      )}
      {row.metrics.map((m) => (
        <div className="calculator-field" key={m.key}>
          <div className="calculator-field-header">
            <span>
              {m.label} ({m.unit}) {missing.includes(m.key) ? "" : <span className="league-submitted">saved</span>}
            </span>
          </div>
          <details className="league-definition">
            <summary>Definition ({m.definition_key})</summary>
            {m.definition}
          </details>
          {mode === "last_year" && m.key === "revenue_growth_yoy" && (
            <span className="auth-field-hint">
              Q{row.fiscal_quarter} {row.year_ago_label} versus Q{row.fiscal_quarter} {yearBefore(row.year_ago_label)}: (Q
              {row.fiscal_quarter} {row.year_ago_label} revenue / Q{row.fiscal_quarter} {yearBefore(row.year_ago_label)}{" "}
              revenue - 1) x 100. The Q{row.fiscal_quarter} {row.year_ago_label} results filing shows both quarters.
            </span>
          )}
          <div className="admin-grid">
            <input
              type="number"
              step="0.01"
              placeholder={missing.includes(m.key) ? "Value" : "New value (optional)"}
              aria-label={`${m.label} value`}
              value={entries[m.key]?.value ?? ""}
              onChange={(e) => set(m.key, "value", e.target.value)}
            />
            <input
              type="url"
              placeholder="https:// link to the source"
              aria-label={`${m.label} source link`}
              required={!!entries[m.key]?.value}
              value={entries[m.key]?.source_url ?? ""}
              onChange={(e) => set(m.key, "source_url", e.target.value)}
              onBlur={(e) => spreadSource(e.target.value)}
            />
          </div>
        </div>
      ))}
      {error && <div className="search-error">{error}</div>}
      <div className="admin-inline-actions">
        <button type="submit" className="search-button" disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </button>
        <button type="button" className="modal-skip" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function EditPanel({ row, onDone, onCancel }: { row: AdminBoardRow; onDone: (msg: string) => void; onCancel: () => void }) {
  const [lockLocal, setLockLocal] = useState("");
  const [notes, setNotes] = useState(row.research_notes ?? "");
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>, msg: string) {
    setError(null);
    try {
      await adminPatchEvent(row.id, body);
      onDone(msg);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update.");
    }
  }

  return (
    <div className="admin-inline-edit admin-panel">
      <div className="calculator-field-note">Forecasts lock {formatIst(row.lock_at)}.</div>
      {!row.lock_passed && (
        <label className="auth-field">
          <span>New lock time (IST)</span>
          <input type="datetime-local" value={lockLocal} onChange={(e) => setLockLocal(e.target.value)} />
        </label>
      )}
      <label className="auth-field">
        <span>Research notes (shown to forecasters)</span>
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {error && <div className="search-error">{error}</div>}
      <div className="admin-inline-actions">
        {lockLocal && (
          <button type="button" className="settings-row-action" onClick={() => patch({ lock_at: istToIso(lockLocal) }, "Lock time saved.")}>
            Save lock time
          </button>
        )}
        <button type="button" className="settings-row-action" onClick={() => patch({ research_notes: notes }, "Notes saved.")}>
          Save notes
        </button>
        <button type="button" className="settings-row-action" onClick={() => patch({ status: "draft" }, `${row.company_name} is hidden.`)}>
          Hide from players
        </button>
        <button type="button" className="modal-skip" onClick={onCancel}>
          Close
        </button>
      </div>
    </div>
  );
}

const EMPTY = {
  exchange: "NSE",
  ticker: "",
  company_name: "",
  description: "",
  sector: "",
  provider_symbol: "",
  fiscal_year_label: "FY27",
  fiscal_quarter: "2",
  results_date: "",
  lock_local: "",
  include_kpi: true,
  research_notes: "",
};

function AddCompanyForm({ config, onAdded }: { config: LeagueConfig; onAdded: (eventId: number, name: string) => void }) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof EMPTY, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const q = Number(form.fiscal_quarter);
  const end = periodEnd(form.fiscal_year_label, q, 3);
  const template = config.kpi_templates.find((t) => t.sector === form.sector);
  const kpiNotDisclosed = !!template?.non_disclosing_tickers.includes(form.ticker.trim().toUpperCase());
  const symbol = form.provider_symbol || (form.ticker ? `${form.ticker}.${form.exchange === "BSE" ? "BO" : "NS"}` : "");
  const sectorName = (s: string) => config.sector_explainers.find((e) => e.sector === s)?.display_name ?? s;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await adminQuickEvent({
        exchange: form.exchange,
        ticker: form.ticker,
        company_name: form.company_name,
        description: form.description.trim() || null,
        sector: form.sector,
        provider_symbol: symbol,
        fiscal_year_label: form.fiscal_year_label,
        fiscal_quarter: q,
        period_end_date: end,
        results_date: form.results_date,
        lock_at: istToIso(form.lock_local),
        include_kpi: !!template && form.include_kpi && !kpiNotDisclosed,
        research_notes: form.research_notes || null,
        season_label: `Q${q} ${form.fiscal_year_label.toUpperCase()}`,
      });
      onAdded(res.id, form.company_name);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add the company.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="auth-form admin-panel" onSubmit={handleSubmit}>
      <div className="admin-grid">
        <label className="auth-field">
          <span>Company name</span>
          <input value={form.company_name} onChange={(e) => set("company_name", e.target.value)} required />
        </label>
        <label className="auth-field">
          <span>NSE ticker</span>
          <input value={form.ticker} onChange={(e) => set("ticker", e.target.value.toUpperCase())} required />
        </label>
        <label className="auth-field">
          <span>Sector</span>
          <select value={form.sector} onChange={(e) => set("sector", e.target.value)} required>
            <option value="">Choose...</option>
            {config.kpi_templates.map((t) => (
              <option key={t.sector} value={t.sector}>
                {sectorName(t.sector)}
              </option>
            ))}
          </select>
        </label>
        <label className="auth-field">
          <span>Results date</span>
          <input type="date" value={form.results_date} onChange={(e) => set("results_date", e.target.value)} required />
        </label>
      </div>
      <label className="auth-field">
        <span>One-line description (home page card)</span>
        <input
          value={form.description}
          maxLength={140}
          placeholder="Leave blank to use the approved default for this ticker, if there is one"
          onChange={(e) => set("description", e.target.value)}
        />
      </label>
      {template && (
        <label className="league-radio">
          <input
            type="checkbox"
            checked={form.include_kpi && !kpiNotDisclosed}
            disabled={kpiNotDisclosed}
            onChange={(e) => set("include_kpi", e.target.checked)}
          />
          {kpiNotDisclosed
            ? `${form.ticker.toUpperCase()} doesn't disclose ${template.metric.label.toLowerCase()}, so no sector KPI`
            : `It discloses ${template.metric.label.toLowerCase()} every quarter (include the KPI)`}
        </label>
      )}
      <details className="league-definition">
        <summary>More options</summary>
        <div className="admin-grid">
          <label className="auth-field">
            <span>Exchange</span>
            <select value={form.exchange} onChange={(e) => set("exchange", e.target.value)}>
              <option>NSE</option>
              <option>BSE</option>
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
            <span>Lock time (IST)</span>
            <input type="datetime-local" value={form.lock_local} onChange={(e) => set("lock_local", e.target.value)} />
            <span className="auth-field-hint">Default: 11:59 pm the day before results</span>
          </label>
          <label className="auth-field">
            <span>Yahoo symbol</span>
            <input value={form.provider_symbol} placeholder={symbol} onChange={(e) => set("provider_symbol", e.target.value)} />
          </label>
        </div>
        <label className="auth-field">
          <span>Research notes (shown to forecasters)</span>
          <textarea rows={2} value={form.research_notes} onChange={(e) => set("research_notes", e.target.value)} />
        </label>
      </details>
      <div className="calculator-field-note">
        Q{q} {form.fiscal_year_label.toUpperCase()}, quarter ending {end || "?"}. It stays hidden from players until
        last year's numbers are entered.
      </div>
      {error && <div className="search-error">{error}</div>}
      <button type="submit" className="search-button" disabled={saving}>
        {saving ? "Adding..." : "Add company"}
      </button>
    </form>
  );
}

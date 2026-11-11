import { FormEvent, useEffect, useState } from "react";
import {
  ApiError,
  adminCreateWorldEvent,
  adminDeleteWorldEvent,
  adminListWorldEvents,
  adminUpdateWorldEvent,
} from "../../lib/api";
import type { WorldEvent, WorldEventIn, WorldEventSector } from "../../lib/types";
import { formatDay } from "../../lib/leagueFormat";

const SECTORS: { key: WorldEventSector; label: string }[] = [
  { key: "economy", label: "Economy & policy" },
  { key: "cement", label: "Cement" },
  { key: "autos", label: "Autos" },
  { key: "fmcg", label: "FMCG" },
  { key: "it", label: "IT" },
];

// Soft checks only: the copy rules say "may", never a prediction or a tip.
const PREDICTIVE = /\b(will|definitely|certainly|guaranteed)\b/i;
const ADVICE = /\b(buy|sell|target|invest now|should you)\b/i;

const EMPTY: WorldEventIn = {
  title: "",
  event_date: new Date().toISOString().slice(0, 10),
  sectors: [],
  why: "",
  why_long: "",
  chain: "",
  source_url: "",
  pinned: false,
  show_until: null,
};

function toInput(e: WorldEvent): WorldEventIn {
  return {
    title: e.title,
    event_date: e.event_date,
    sectors: e.sectors,
    why: e.why,
    why_long: e.why_long ?? "",
    chain: e.chain ?? "",
    source_url: e.source_url ?? "",
    pinned: e.pinned,
    show_until: e.show_until,
  };
}

export default function AdminWorldEvents() {
  const [events, setEvents] = useState<WorldEvent[] | null>(null);
  const [form, setForm] = useState<WorldEventIn>(EMPTY);
  const [editing, setEditing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = () =>
    adminListWorldEvents()
      .then(setEvents)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load world events."));

  useEffect(() => {
    load();
  }, []);

  const warnings = [
    PREDICTIVE.test(`${form.why} ${form.why_long ?? ""} ${form.chain ?? ""}`) &&
      'This reads like a prediction. Use "may" instead of "will".',
    ADVICE.test(`${form.title} ${form.why} ${form.why_long ?? ""}`) &&
      "This reads like investment advice. Describe the event and its possible effect only.",
  ].filter(Boolean) as string[];

  function set<K extends keyof WorldEventIn>(key: K, value: WorldEventIn[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleSector(s: WorldEventSector) {
    set("sectors", form.sectors.includes(s) ? form.sectors.filter((x) => x !== s) : [...form.sectors, s]);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    const body = {
      ...form,
      why_long: form.why_long?.trim() || null,
      chain: form.chain?.trim() || null,
      source_url: form.source_url?.trim() || null,
      show_until: form.show_until || null,
    };
    try {
      if (editing === null) await adminCreateWorldEvent(body);
      else await adminUpdateWorldEvent(editing, body);
      setMessage(editing === null ? "Published." : "Saved.");
      setForm(EMPTY);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(ev: WorldEvent) {
    if (!window.confirm(`Delete "${ev.title}"? This can't be undone.`)) return;
    try {
      await adminDeleteWorldEvent(ev.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete.");
    }
  }

  return (
    <div className="admin-world-events">
      <form className="glass panel admin-form" onSubmit={submit}>
        <h2 className="panel-title">{editing === null ? "Add a world event" : "Edit world event"}</h2>
        <label className="field">
          <span className="field-label">Title</span>
          <input className="input" value={form.title} maxLength={120} required onChange={(e) => set("title", e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Date of the event</span>
          <input className="input" type="date" value={form.event_date} required onChange={(e) => set("event_date", e.target.value)} />
        </label>
        <fieldset className="field">
          <legend className="field-label">Sectors it may affect</legend>
          <div className="league-chips">
            {SECTORS.map((s) => (
              <button
                key={s.key}
                type="button"
                className={`chip ${form.sectors.includes(s.key) ? "active" : ""}`}
                aria-pressed={form.sectors.includes(s.key)}
                onClick={() => toggleSector(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="field">
          <span className="field-label">Why it may matter</span>
          <textarea className="input" rows={2} value={form.why} maxLength={200} required onChange={(e) => set("why", e.target.value)} />
          <span className="field-hint">
            {form.why.length}/200. One sentence, plain words, "may" not "will".
          </span>
        </label>
        <label className="field">
          <span className="field-label">
            Longer explanation <span className="field-optional">Optional</span>
          </span>
          <textarea
            className="input"
            rows={5}
            value={form.why_long ?? ""}
            maxLength={800}
            onChange={(e) => set("why_long", e.target.value)}
          />
          <span className="field-hint">
            {(form.why_long ?? "").length}/800. Shown when someone opens "Why it may matter": 4 to 6 plain sentences on
            what is happening, how it reaches companies, which numbers it can move, what to watch and what it depends on.
          </span>
        </label>
        <label className="field">
          <span className="field-label">
            Cause and effect <span className="field-optional">Optional</span>
          </span>
          <input className="input" value={form.chain ?? ""} maxLength={200} onChange={(e) => set("chain", e.target.value)} />
          <span className="field-hint">Steps joined by →, for example: Oil up → freight costs up → margin may fall</span>
        </label>
        <label className="field">
          <span className="field-label">
            Source link <span className="field-optional">Optional</span>
          </span>
          <input className="input" type="url" value={form.source_url ?? ""} onChange={(e) => set("source_url", e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">
            Show until <span className="field-optional">Optional</span>
          </span>
          <input className="input" type="date" value={form.show_until ?? ""} onChange={(e) => set("show_until", e.target.value || null)} />
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={form.pinned} onChange={(e) => set("pinned", e.target.checked)} />
          Pin to the top
        </label>
        {warnings.map((w) => (
          <div key={w} className="notice">
            {w}
          </div>
        ))}
        {error && <div className="form-error">{error}</div>}
        {message && <div className="field-hint">{message}</div>}
        <div className="admin-form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving || form.sectors.length === 0} aria-busy={saving}>
            {saving ? "Saving..." : editing === null ? "Publish" : "Save changes"}
          </button>
          {editing !== null && (
            <button type="button" className="btn btn-tertiary" onClick={() => { setEditing(null); setForm(EMPTY); }}>
              Cancel
            </button>
          )}
        </div>
      </form>

      <section className="glass panel">
        <h2 className="panel-title">Published</h2>
        {events === null && <p className="empty-note">Loading...</p>}
        {events?.length === 0 && <p className="empty-note">No world events yet.</p>}
        {events && events.length > 0 && (
          <ul className="group">
            {events.map((ev) => (
              <li key={ev.id} className="admin-world-event-row">
                <div>
                  <strong>{ev.title}</strong>
                  {ev.pinned && " · Pinned"}
                  <div className="field-hint">
                    {formatDay(ev.event_date, true)} · {ev.sector_labels.join(", ")}
                    {ev.show_until ? ` · until ${formatDay(ev.show_until, true)}` : ""}
                  </div>
                </div>
                <div className="admin-form-actions">
                  <button type="button" className="btn btn-secondary btn-compact" onClick={() => { setEditing(ev.id); setForm(toInput(ev)); }}>
                    Edit
                  </button>
                  <button type="button" className="btn btn-destructive btn-compact" onClick={() => remove(ev)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

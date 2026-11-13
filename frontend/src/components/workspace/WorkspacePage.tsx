import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError, clearWorkspace, fetchCompany, fetchCompanyNews, fetchLeagueConfig, fetchLeagueEvent, fetchResearchHistory,
  fetchWorkspace, saveWorkspace,
} from "../../lib/api";
import { requestFormJump } from "../../lib/forecastDrafts";
import type { Theme } from "../../hooks/useTheme";
import type {
  CompanyFinancialsResponse, CompanyNews, EventDetail, LeagueConfig, ResearchHistory, UserPublic, Workspace,
  WorksheetData,
} from "../../lib/types";
import { emptyWorksheet, isSector } from "../../lib/worksheet";
import { getMemoryWorksheet, getStep, setMemoryWorksheet, setStep } from "../../lib/workspaceMemory";
import ProfileModal from "../league/ProfileModal";
import SiteFooter from "../SiteFooter";
import StepData from "./StepData";
import Worksheet from "./Worksheet";

// Wording approved 2026-11-13 (Areas/Research workspace wording).
const BLOCKED_TEXT: Record<string, string> = {
  sign_in: "Sign in to save your notes. They're saved to your account, so you can pick up on another device.",
  terms_required: "Please agree to the Terms of Use and Privacy Policy first.",
  profile_required: "Choose a public handle and your age group to save your notes.",
  guardian_consent_pending: "Your notes will be saved once your parent's consent is recorded.",
};
const NOTE_MAX = 2000;
const SAVE_DELAY_MS = 1200;

type SaveStatus = "idle" | "saving" | "saved" | "error";

// The server rejects out-of-range numbers; drop them rather than fail the save.
function clean(ws: WorksheetData): WorksheetData {
  const within = (v: number | null | undefined, lo: number, hi: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
  return {
    inputs: Object.fromEntries(Object.entries(ws.inputs).map(([k, v]) => [k, within(v, -100, 500)])),
    units: ws.units
      ? {
          this_year: ws.units.this_year.map((v) => within(v, 0, 10_000_000)),
          last_year: ws.units.last_year.map((v) => within(v, 0, 10_000_000)),
        }
      : null,
    base: ws.base ?? null,
    own_base: within(ws.own_base, -100, 100),
    unsure: Object.fromEntries(Object.entries(ws.unsure).map(([k, v]) => [k, within(v, 0, 100)])),
  };
}

interface WorkspacePageProps {
  eventId: number;
  user: UserPublic | null;
  onUserChange: (u: UserPublic) => void;
  onOpenAuth: () => void;
  theme: Theme;
  visible: boolean;
}

export default function WorkspacePage({ eventId, user, onUserChange, onOpenAuth, visible }: WorkspacePageProps) {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [config, setConfig] = useState<LeagueConfig | null>(null);
  const [history, setHistory] = useState<ResearchHistory | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [company, setCompany] = useState<CompanyFinancialsResponse | null>(null);
  const [news, setNews] = useState<CompanyNews | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [notes, setNotes] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string[]>([]);
  const [worksheet, setWorksheet] = useState<WorksheetData>(emptyWorksheet);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(() => getStep(eventId));
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [profileOpen, setProfileOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const loadedKey = useRef<string | null>(null);
  const pendingNotes = useRef<Record<string, string>>({});
  const pendingWorksheet = useRef<WorksheetData | null>(null);
  const timer = useRef<number | null>(null);

  const canSave = ws?.save_blocked === null;

  const load = useCallback(async () => {
    setError(null);
    try {
      const [w, ev, cfg] = await Promise.all([fetchWorkspace(eventId), fetchLeagueEvent(eventId), fetchLeagueConfig()]);
      setWs(w);
      setEvent(ev);
      setConfig(cfg);
      // Take the saved state only on first load or a change of account, so a
      // refresh never overwrites what's being typed.
      const key = `${eventId}:${user?.id ?? "anon"}:${w.save_blocked ?? "ok"}`;
      if (loadedKey.current !== key) {
        loadedKey.current = key;
        setNotes(w.state?.notes ?? {});
        setDone(w.state?.done ?? []);
        setWorksheet(
          w.save_blocked === null ? (w.state?.worksheet ?? emptyWorksheet()) : (getMemoryWorksheet(eventId) ?? emptyWorksheet()),
        );
        setLoadedFor(key);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load the workspace.");
    }
  }, [eventId, user?.id, user?.age_band, user?.guardian_consent_status, user?.handle, user?.needs_terms]);

  useEffect(() => {
    load();
  }, [load]);

  const wasVisible = useRef(visible);
  useEffect(() => {
    if (visible && !wasVisible.current) load();
    wasVisible.current = visible;
  }, [visible, load]);

  const companyId = event?.company.id;
  const symbol = event?.company.provider_symbol ?? null;
  useEffect(() => {
    if (companyId === undefined) return;
    let cancelled = false;
    fetchResearchHistory(companyId)
      .then((h) => !cancelled && setHistory(h))
      .catch((err) => !cancelled && setHistoryError(err instanceof ApiError ? err.message : "Couldn't load history."));
    if (symbol) {
      fetchCompany(symbol).then((c) => !cancelled && setCompany(c)).catch(() => {});
      fetchCompanyNews(symbol).then((n) => !cancelled && setNews(n)).catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [companyId, symbol]);

  const flush = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const body: { notes?: Record<string, string>; worksheet?: WorksheetData } = {};
    if (Object.keys(pendingNotes.current).length > 0) body.notes = pendingNotes.current;
    if (pendingWorksheet.current) body.worksheet = clean(pendingWorksheet.current);
    pendingNotes.current = {};
    pendingWorksheet.current = null;
    if (!body.notes && !body.worksheet) return;
    setStatus("saving");
    try {
      await saveWorkspace(eventId, body);
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }, [eventId]);

  function schedule() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
  }

  // Leaving the page saves what's waiting.
  useEffect(() => {
    if (!visible) flush();
  }, [visible, flush]);
  useEffect(() => () => void flush(), [flush]);

  if (error) {
    return (
      <div className="page">
        <a className="back-link" href="#/league" data-keep-scroll>← Companies</a>
        <div className="form-error">{error}</div>
      </div>
    );
  }
  if (!ws || !event || !config) {
    return (
      <div className="page">
        <p className="empty-note">Loading...</p>
      </div>
    );
  }

  const name = event.company.name;
  const steps = ws.steps;
  const index = Math.min(stepIndex, steps.length - 1);
  const step = steps[index];
  const sector = isSector(event.company.sector) ? event.company.sector : null;
  const isLast = index === steps.length - 1;

  function goTo(i: number) {
    setStepIndex(i);
    setStep(eventId, i);
    document.getElementById("workspace-step-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function editNote(text: string) {
    setNotes((n) => ({ ...n, [step.key]: text }));
    pendingNotes.current = { ...pendingNotes.current, [step.key]: text };
    schedule();
  }

  async function toggleDone() {
    const next = done.includes(step.key) ? done.filter((k) => k !== step.key) : [...done, step.key];
    setDone(next);
    setStatus("saving");
    try {
      await saveWorkspace(eventId, { done: next });
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  function editWorksheet(next: WorksheetData) {
    setWorksheet(next);
    if (canSave) {
      pendingWorksheet.current = next;
      schedule();
    } else {
      setMemoryWorksheet(eventId, next);
    }
  }

  async function handleClear() {
    await flush();
    try {
      await clearWorkspace(eventId);
      setNotes({});
      setDone([]);
      setWorksheet(emptyWorksheet());
      setConfirmClear(false);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  const statusText =
    status === "saving" ? "Saving..." : status === "saved" ? "Saved" : status === "error" ? "Couldn't save. Check your connection and try again." : "";

  return (
    <div className="page page-wide workspace-page">
      <header className="page-header glass page-hero">
        <a className="back-link" href={`#/event/${event.id}`} data-keep-scroll>
          ← {name}
        </a>
        <h1 className="page-title">Research workspace: {name}</h1>
        <p className="page-lede">
          Ten steps that analysts follow before results. Each step shows what Stackly already has, a few questions to
          think about, and space for your notes. The forecast itself is yours.
        </p>
        {canSave && (
          <div className="workspace-progress">
            <div className="workspace-progress-bar" aria-hidden="true">
              <span style={{ width: `${(done.length / steps.length) * 100}%` }} />
            </div>
            <span className="workspace-progress-text">
              {done.length} of {steps.length} steps done
            </span>
          </div>
        )}
        {ws.status === "scored" ? (
          <p className="callout workspace-banner">
            Results are in. Compare your notes with how it turned out.{" "}
            <a href={`#/results/${event.id}`}>See the results</a>
          </p>
        ) : (
          ws.locked && (
            <p className="callout workspace-banner">
              Forecasts for {name} are locked. Your notes are still here and you can keep adding to them. The worksheet
              is hidden.
            </p>
          )
        )}
      </header>

      <div className="workspace-layout">
        <nav className="workspace-steps glass" aria-label="Steps">
          <ol>
            {steps.map((s, i) => (
              <li key={s.key}>
                <button
                  type="button"
                  className={`workspace-step-link ${i === index ? "is-current" : ""}`}
                  aria-current={i === index ? "step" : undefined}
                  aria-label={`Step ${i + 1}: ${s.title}${done.includes(s.key) ? " (done)" : ""}`}
                  onClick={() => goTo(i)}
                >
                  <span className={`workspace-step-num ${done.includes(s.key) ? "is-done" : ""}`} aria-hidden="true">
                    {done.includes(s.key) ? "✓" : i + 1}
                  </span>
                  <span className="workspace-step-name">{s.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div className="workspace-main">
          <section className="glass panel workspace-step-head" aria-labelledby="workspace-step-title">
            <p className="workspace-step-count">
              Step {index + 1} of {steps.length}
            </p>
            <h2 className="panel-title" id="workspace-step-title">
              {step.title}
            </h2>
            <p className="section-text">{step.why}</p>
          </section>

          <StepData
            step={step.key}
            event={event}
            config={config}
            workspace={ws}
            history={history}
            historyError={historyError}
            company={company}
            news={news}
          />

          {step.key === "worksheet" &&
            sector &&
            (ws.locked ? (
              <p className="callout workspace-banner">Forecasts are locked, so the worksheet is hidden.</p>
            ) : (
              <Worksheet
                key={loadedFor ?? "loading"}
                sector={sector}
                event={event}
                worksheet={worksheet}
                onChange={editWorksheet}
                lastYear={ws.last_year}
                lastQuarter={ws.last_quarter}
              />
            ))}

          <section className="glass panel news-panel workspace-think" aria-label="Questions and notes">
            {step.items.length > 0 && !(step.key === "worksheet" && ws.locked) && (
              <ul className="workspace-items">
                {step.items.map((item) => (
                  <li key={item.text} className={`workspace-item workspace-item-${item.kind}`}>
                    {item.text}
                  </li>
                ))}
              </ul>
            )}

            {canSave ? (
              <div className="field">
                <label className="field-label" htmlFor="workspace-notes">
                  Your notes
                </label>
                <textarea
                  id="workspace-notes"
                  className="input workspace-notes"
                  rows={5}
                  maxLength={NOTE_MAX}
                  placeholder="What did you find? What surprised you?"
                  value={notes[step.key] ?? ""}
                  onChange={(e) => editNote(e.target.value)}
                />
                <div className="workspace-notes-meta">
                  <span className={statusText ? "status-text" : undefined} role="status">
                    {statusText}
                  </span>
                  <span className="field-hint">
                    {(notes[step.key] ?? "").length.toLocaleString("en-IN")}/2,000
                  </span>
                </div>
              </div>
            ) : (
              <div className="callout workspace-blocked">
                <p>{BLOCKED_TEXT[ws.save_blocked ?? "sign_in"]}</p>
                {ws.save_blocked === "sign_in" && (
                  <button type="button" className="btn btn-secondary btn-compact" onClick={onOpenAuth}>
                    Sign in
                  </button>
                )}
                {ws.save_blocked === "profile_required" && user && (
                  <button type="button" className="btn btn-secondary btn-compact" onClick={() => setProfileOpen(true)}>
                    Choose a handle and age group
                  </button>
                )}
              </div>
            )}

            <div className="workspace-step-actions">
              {canSave && (
                <button
                  type="button"
                  className={`btn ${done.includes(step.key) ? "btn-secondary" : "btn-primary"}`}
                  aria-pressed={done.includes(step.key)}
                  title={done.includes(step.key) ? "Press again to undo" : undefined}
                  onClick={toggleDone}
                >
                  {done.includes(step.key) ? "Done" : "Mark as done"}
                </button>
              )}
              <div className="workspace-pager">
                {index > 0 && (
                  <button type="button" className="btn btn-tertiary" onClick={() => goTo(index - 1)}>
                    Previous step
                  </button>
                )}
                {isLast ? (
                  ws.status === "open" && (
                    <a className="btn btn-secondary" href={`#/event/${event.id}`} onClick={() => requestFormJump(event.id)}>
                      Go to your forecast
                    </a>
                  )
                ) : (
                  <button type="button" className="btn btn-secondary" onClick={() => goTo(index + 1)}>
                    Next step
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>

      <details className="glass panel workspace-glossary">
        <summary className="panel-title">Glossary</summary>
        <dl className="workspace-definitions">
          {ws.glossary.map((g) => (
            <div key={g.term}>
              <dt>{g.term}</dt>
              <dd>{g.definition}</dd>
            </div>
          ))}
        </dl>
      </details>

      {canSave && (
        <div className="workspace-clear">
          {confirmClear ? (
            <div className="callout" role="alertdialog" aria-label="Clear this workspace">
              <p>
                This deletes your notes, ticks and worksheet for {name}. Your forecast doesn't change. This can't be
                undone.
              </p>
              <div className="worksheet-confirm-actions">
                <button type="button" className="btn btn-destructive-filled btn-compact" onClick={handleClear}>
                  Clear
                </button>
                <button type="button" className="btn btn-tertiary btn-compact" onClick={() => setConfirmClear(false)}>
                  Keep
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn-destructive" onClick={() => setConfirmClear(true)}>
              Clear this workspace
            </button>
          )}
        </div>
      )}

      <SiteFooter />

      {profileOpen && user && (
        <ProfileModal
          user={user}
          onClose={() => setProfileOpen(false)}
          onSaved={(u) => {
            onUserChange(u);
            setProfileOpen(false);
          }}
        />
      )}
    </div>
  );
}

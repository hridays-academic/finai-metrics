import { FormEvent, useEffect, useRef, useState } from "react";
import { ApiError, saveForecast } from "../../lib/api";
import { clearForecastDraft, getForecastDraft, setForecastDraft, type Range } from "../../lib/forecastDrafts";
import { formatDay, slabDomain } from "../../lib/leagueFormat";
import type { EventDetail, Forecast, LeagueConfig, UserPublic } from "../../lib/types";
import RangeSlab from "../RangeSlab";
import MetricSteps, { type MetricFacts } from "./MetricSteps";

interface ForecastFormProps {
  event: EventDetail;
  config: LeagueConfig;
  user: UserPublic | null;
  forecast: Forecast | null;
  onSaved: (f: Forecast) => void;
  onNeedProfile: () => void;
  onOpenAuth: () => void;
  onLocked: () => void;
  // Last year's league figure per metric: the scale centres on it (T10).
  lastYear?: Record<string, number | null>;
  lastQuarter?: Record<string, number | null>;
  // Each number's facts beside its range (the round screen).
  facts?: Record<string, MetricFacts | undefined>;
}

// The saved forecast's values, with any unsaved draft from earlier in this tab on top.
function initialRanges(event: EventDetail, forecast: Forecast | null, draft?: Record<string, Range>): Record<string, Range> {
  const out: Record<string, Range> = {};
  for (const m of event.metrics) {
    const v = forecast?.values.find((x) => x.metric_key === m.key);
    out[m.key] = draft?.[m.key] ?? { low: v ? String(v.low) : "", high: v ? String(v.high) : "" };
  }
  return out;
}

export default function ForecastForm(props: ForecastFormProps) {
  const { event, config, user, forecast, onSaved, onNeedProfile, onOpenAuth, onLocked, lastYear, lastQuarter, facts } = props;
  const [tried, setTried] = useState(false);
  const readOnly = event.status !== "open" || forecast?.locked === true;
  const needsConsent = user?.age_band === "under_18" && user.guardian_consent_status !== "granted";

  const [draft] = useState(() => (readOnly ? undefined : getForecastDraft(event.id)));
  const [ranges, setRanges] = useState(() => initialRanges(event, forecast, draft?.ranges));
  const [tags, setTags] = useState<string[]>(draft?.tags ?? forecast?.reason_tags ?? []);
  const [note, setNote] = useState(draft?.note ?? forecast?.note ?? "");
  const fromWorksheet = draft?.fromWorksheet === true;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(forecast?.updated_at ?? null);
  const [unsaved, setUnsaved] = useState(draft !== undefined);
  // Only the visitor's own edits become a draft, never the loaded values.
  const edited = useRef(draft !== undefined);

  useEffect(() => {
    if (edited.current) setForecastDraft(event.id, { ranges, tags, note });
  }, [event.id, ranges, tags, note]);

  function markEdited() {
    edited.current = true;
    setUnsaved(true);
  }

  function setRange(key: string, side: "low" | "high", value: string) {
    markEdited();
    setRanges((r) => ({ ...r, [key]: { ...r[key], [side]: value } }));
  }

  function toggleTag(key: string) {
    markEdited();
    setTags((t) => (t.includes(key) ? t.filter((x) => x !== key) : [...t, key]));
  }

  function editNote(value: string) {
    markEdited();
    setNote(value);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!user) return onOpenAuth();
    if (!user.handle || !user.age_band) return onNeedProfile();
    const values = event.metrics.map((m) => ({
      metric_key: m.key,
      low: Number(ranges[m.key].low),
      high: Number(ranges[m.key].high),
    }));
    const bad = event.metrics.find((m, i) => ranges[m.key].low === "" || ranges[m.key].high === "" || values[i].low > values[i].high);
    if (bad) {
      setError(`${bad.label}: enter a low and a high, with low no bigger than high.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await saveForecast(event.id, { values, reason_tags: tags, note: note.trim() || null });
      setSavedAt(saved.updated_at);
      clearForecastDraft(event.id);
      edited.current = false;
      setUnsaved(false);
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError && err.code === "profile_required") onNeedProfile();
      if (err instanceof ApiError && err.code === "forecast_locked") onLocked();
      setError(err instanceof ApiError ? err.message : "Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="league-form" onSubmit={handleSubmit}>
      <p className="league-eighty">
        Pick a low and a high you're pretty sure the result lands between. Too tight and you might miss. Too wide and
        you lose points for playing it safe.
      </p>
      {fromWorksheet && unsaved && (
        <p className="form-note worksheet-start-note">Started from your worksheet. Change anything before you save.</p>
      )}

      <MetricSteps metrics={event.metrics} ranges={Object.fromEntries(
          event.metrics.map((m) => {
            const r = ranges[m.key];
            const ok = r.low !== "" && r.high !== "" && Number(r.low) <= Number(r.high);
            return [m.key, ok ? ([Number(r.low), Number(r.high)] as [number, number]) : null];
          })
        )} facts={facts}>
        {(m) => {
        const r = ranges[m.key];
        const width = r.low !== "" && r.high !== "" ? Number(r.high) - Number(r.low) : null;
        const valid = width !== null && width >= 0 && Number.isFinite(width);
        return (
          <fieldset className="field" key={m.key}>
            <legend className="field-label">{m.label}</legend>
            {/* F1-F7 (master plan phase 4): the one range control. */}
            <RangeSlab
              label={m.label}
              unit={m.unit}
              domain={slabDomain(m.key, lastYear?.[m.key])}
              value={valid ? [Number(r.low), Number(r.high)] : null}
              onChange={([a, b]) => {
                setRange(m.key, "low", a.toFixed(1));
                setRange(m.key, "high", b.toFixed(1));
              }}
              lastYear={lastYear?.[m.key] ?? null}
              lastQuarter={lastQuarter?.[m.key] ?? null}
              disabled={readOnly}
            />
            <p className={`field-hint ${(width !== null && width < 0) || (width === null && tried) ? "field-hint-error" : ""}`}>
              {width === null
                ? tried
                  ? "Enter both numbers."
                  : ""
                : width < 0
                  ? "Low is above high. Swap them."
                  : ""}
            </p>
            <details className="league-definition">
              <summary>How this is measured</summary>
              <p>{m.definition}</p>
            </details>
          </fieldset>
        );
      }}
      </MetricSteps>

      <fieldset className="field">
        <legend className="field-label">
          {/* F9 (approved 2.25). */}
          Why? <span className="field-optional">Optional</span>
        </legend>
        <div className="league-chips">
          {config.reason_tags.map((t) => (
            <button
              type="button"
              key={t.key}
              className={`chip ${tags.includes(t.key) ? "active" : ""}`}
              aria-pressed={tags.includes(t.key)}
              disabled={readOnly}
              onClick={() => toggleTag(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="field">
        <span className="field-label">
          Note <span className="field-optional">Optional</span>
        </span>
        <textarea
          className="input"
          value={note}
          maxLength={config.note_max_chars}
          rows={2}
          disabled={readOnly}
          onChange={(e) => editNote(e.target.value)}
        />
        <span className="field-hint">
          {note.length}/{config.note_max_chars}
        </span>
      </label>

      {needsConsent && (
        <div className="notice">
          Because you're under 18, we need a parent or guardian's consent (a signed form or an email from your parent) before you can submit.
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
      {readOnly ? (
        <div className="notice">
          {event.status === "scored" ? (
            forecast ? (
              <a href={`#/results/${event.id}`}>Scored. See your results</a>
            ) : (
              "Results are in. You didn't forecast this company."
            )
          ) : forecast ? (
            `Locked. Results are announced on ${formatDay(event.results_date, true)}; your score appears here after that.`
          ) : (
            "Forecasts for this company are locked."
          )}
        </div>
      ) : (
        <>
          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={saving || needsConsent}
            aria-busy={saving}
          >
            {saving ? "Saving..." : !user ? "Sign in to forecast" : forecast ? "Update forecast" : "Submit forecast"}
          </button>
          {unsaved && <p className="field-hint">Not submitted yet. Your entries are kept until you close or reload this tab.</p>}
          {savedAt && (
            <p className="field-hint">
              Saved {new Date(savedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST. You can edit it
              until the lock. The last saved version counts.
            </p>
          )}
        </>
      )}
    </form>
  );
}

import { FormEvent, useEffect, useRef, useState } from "react";
import { ApiError, saveForecast } from "../../lib/api";
import { clearForecastDraft, getForecastDraft, setForecastDraft, type Range } from "../../lib/forecastDrafts";
import { formatDay } from "../../lib/leagueFormat";
import type { EventDetail, Forecast, LeagueConfig, UserPublic } from "../../lib/types";

interface ForecastFormProps {
  event: EventDetail;
  config: LeagueConfig;
  user: UserPublic | null;
  forecast: Forecast | null;
  onSaved: (f: Forecast) => void;
  onNeedProfile: () => void;
  onOpenAuth: () => void;
  onLocked: () => void;
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
  const { event, config, user, forecast, onSaved, onNeedProfile, onOpenAuth, onLocked } = props;
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
        Give a range you're 80% sure the result lands in. Too narrow, and a miss costs a lot. Too wide, and the width
        costs points.
      </p>
      {fromWorksheet && unsaved && (
        <p className="callout callout-tip worksheet-start-note">Started from your worksheet. Change anything before you save.</p>
      )}

      {event.metrics.map((m) => {
        const r = ranges[m.key];
        const width = r.low !== "" && r.high !== "" ? Number(r.high) - Number(r.low) : null;
        return (
          <fieldset className="field" key={m.key}>
            <legend className="field-label">{m.label}</legend>
            <div className="league-range-inputs">
              <div className="input-wrap">
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min={m.min_value}
                  max={m.max_value}
                  className="input"
                  placeholder="Low"
                  aria-label={`${m.label} low`}
                  value={r.low}
                  disabled={readOnly}
                  onChange={(e) => setRange(m.key, "low", e.target.value)}
                />
                <span className="input-suffix">{m.unit}</span>
              </div>
              <span className="league-range-to">to</span>
              <div className="input-wrap">
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min={m.min_value}
                  max={m.max_value}
                  className="input"
                  placeholder="High"
                  aria-label={`${m.label} high`}
                  value={r.high}
                  disabled={readOnly}
                  onChange={(e) => setRange(m.key, "high", e.target.value)}
                />
                <span className="input-suffix">{m.unit}</span>
              </div>
            </div>
            <p className={`field-hint ${width !== null && width < 0 ? "field-hint-error" : ""}`}>
              {width === null
                ? "Enter both numbers."
                : width < 0
                  ? "Low is above high. Swap them."
                  : `Range width: ${width.toFixed(1)} points.`}
            </p>
            <details className="league-definition">
              <summary>How this is measured</summary>
              <p>{m.definition}</p>
            </details>
          </fieldset>
        );
      })}

      <fieldset className="field">
        <legend className="field-label">
          What's behind your forecast? <span className="field-optional">Optional</span>
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

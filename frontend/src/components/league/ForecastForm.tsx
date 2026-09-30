import { FormEvent, useState } from "react";
import { ApiError, saveForecast } from "../../lib/api";
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

type Range = { low: string; high: string };

function initialRanges(event: EventDetail, forecast: Forecast | null): Record<string, Range> {
  const out: Record<string, Range> = {};
  for (const m of event.metrics) {
    const v = forecast?.values.find((x) => x.metric_key === m.key);
    out[m.key] = { low: v ? String(v.low) : "", high: v ? String(v.high) : "" };
  }
  return out;
}

export default function ForecastForm(props: ForecastFormProps) {
  const { event, config, user, forecast, onSaved, onNeedProfile, onOpenAuth, onLocked } = props;
  const [ranges, setRanges] = useState(() => initialRanges(event, forecast));
  const [tags, setTags] = useState<string[]>(forecast?.reason_tags ?? []);
  const [note, setNote] = useState(forecast?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(forecast?.updated_at ?? null);

  const readOnly = event.status !== "open" || forecast?.locked === true;
  const needsConsent = user?.age_band === "under_18" && user.guardian_consent_status !== "granted";

  function setRange(key: string, side: "low" | "high", value: string) {
    setRanges((r) => ({ ...r, [key]: { ...r[key], [side]: value } }));
  }

  function toggleTag(key: string) {
    setTags((t) => (t.includes(key) ? t.filter((x) => x !== key) : [...t, key]));
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
      <div className="league-eighty">
        <strong>80% sure</strong> -- for each number, give a range you're 80% sure the actual result will land in.
        Too narrow and a miss costs you a lot; too wide and the width itself costs points.
      </div>

      {event.metrics.map((m) => {
        const r = ranges[m.key];
        const width = r.low !== "" && r.high !== "" ? Number(r.high) - Number(r.low) : null;
        return (
          <div className="calculator-field" key={m.key}>
            <div className="calculator-field-header">
              <span>{m.label}</span>
            </div>
            <div className="league-range-inputs">
              <div className="calculator-input-wrap">
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min={m.min_value}
                  max={m.max_value}
                  placeholder="Low"
                  aria-label={`${m.label} low`}
                  value={r.low}
                  disabled={readOnly}
                  onChange={(e) => setRange(m.key, "low", e.target.value)}
                />
                <span className="calculator-input-suffix">{m.unit}</span>
              </div>
              <span className="league-range-to">to</span>
              <div className="calculator-input-wrap">
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min={m.min_value}
                  max={m.max_value}
                  placeholder="High"
                  aria-label={`${m.label} high`}
                  value={r.high}
                  disabled={readOnly}
                  onChange={(e) => setRange(m.key, "high", e.target.value)}
                />
                <span className="calculator-input-suffix">{m.unit}</span>
              </div>
            </div>
            <div className="calculator-field-note">
              {width === null
                ? "Enter a low and a high."
                : width < 0
                  ? "Low is above high -- swap them."
                  : `Range width: ${width.toFixed(1)} points.`}
            </div>
            <details className="league-definition">
              <summary>How this is measured</summary>
              {m.definition}
            </details>
          </div>
        );
      })}

      <div className="calculator-field">
        <div className="calculator-field-header">
          <span>What's driving your forecast? (optional)</span>
        </div>
        <div className="league-chips">
          {config.reason_tags.map((t) => (
            <button
              type="button"
              key={t.key}
              className={`group-jump-pill ${tags.includes(t.key) ? "active" : ""}`}
              aria-pressed={tags.includes(t.key)}
              disabled={readOnly}
              onClick={() => toggleTag(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <label className="auth-field">
        <span>Note (optional)</span>
        <textarea
          value={note}
          maxLength={config.note_max_chars}
          rows={2}
          disabled={readOnly}
          onChange={(e) => setNote(e.target.value)}
        />
        <span className="auth-field-hint">
          {note.length}/{config.note_max_chars}
        </span>
      </label>

      {needsConsent && (
        <div className="calculator-field-note">
          Because you're under 18, a guardian's consent (collected by your school) is needed before you can submit.
        </div>
      )}
      {error && <div className="search-error">{error}</div>}
      {readOnly ? (
        <div className="calculator-field-note">
          {forecast ? "Your forecast is locked. It will be scored after results are announced." : "Forecasts for this event are locked."}
        </div>
      ) : (
        <>
          <button type="submit" className="search-button" disabled={saving || needsConsent}>
            {saving ? "Saving..." : !user ? "Sign in to forecast" : forecast ? "Update forecast" : "Submit forecast"}
          </button>
          {savedAt && (
            <div className="calculator-field-note">
              Saved {new Date(savedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST. You can edit it
              until the lock; the last saved version counts.
            </div>
          )}
        </>
      )}
    </form>
  );
}

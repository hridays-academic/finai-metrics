import { FormEvent, useState } from "react";
import { ApiError, updateLeagueProfile } from "../../lib/api";
import type { UserPublic } from "../../lib/types";

interface ProfileModalProps {
  user: UserPublic;
  onSaved: (user: UserPublic) => void;
  onClose: () => void;
}

// Asked once, on the first league action. The handle is public (it will
// appear on leaderboards and profiles); nothing else here is.
export default function ProfileModal({ user, onSaved, onClose }: ProfileModalProps) {
  const [handle, setHandle] = useState(user.handle ?? "");
  const [ageBand, setAgeBand] = useState<string>(user.age_band ?? "");
  const [school, setSchool] = useState(user.school_name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ageLocked = user.age_band !== null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onSaved(await updateLeagueProfile({ handle: handle.trim(), age_band: ageBand, school_name: school.trim() || null }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Set up your league profile">
      <div className="modal-card">
        <h2>Join the Results League</h2>
        <p className="modal-intro">
          Pick a public handle. It's the only thing other players will see, so don't use your full name.
        </p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field">
            <span>Handle</span>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              minLength={3}
              maxLength={20}
              pattern="[A-Za-z0-9_]+"
              title="Letters, numbers and underscores"
              required
              autoFocus
            />
            <span className="auth-field-hint">3-20 letters, numbers or underscores</span>
          </label>

          <fieldset className="auth-field league-fieldset" disabled={ageLocked}>
            <legend>Your age group</legend>
            <label className="league-radio">
              <input type="radio" name="age" checked={ageBand === "under_18"} onChange={() => setAgeBand("under_18")} required />
              Under 18
            </label>
            <label className="league-radio">
              <input type="radio" name="age" checked={ageBand === "18_plus"} onChange={() => setAgeBand("18_plus")} />
              18 or over
            </label>
            {ageLocked && <span className="auth-field-hint">Already set. Ask your teacher to change it.</span>}
          </fieldset>
          {ageBand === "under_18" && (
            <p className="calculator-field-note">
              Players under 18 need a parent or guardian's consent, collected through your school, before they can
              submit forecasts. You can still browse and research in the meantime.
            </p>
          )}

          <label className="auth-field">
            <span>School (optional)</span>
            <input value={school} onChange={(e) => setSchool(e.target.value)} maxLength={80} />
          </label>

          {error && <div className="search-error">{error}</div>}
          <button type="submit" className="search-button auth-submit" disabled={saving || !ageBand}>
            {saving ? "Saving..." : "Save"}
          </button>
          <button type="button" className="modal-skip" onClick={onClose}>
            Not now
          </button>
        </form>
      </div>
    </div>
  );
}

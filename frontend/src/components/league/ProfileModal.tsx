import { createPortal } from "react-dom";
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

  // Portalled to the app shell: the page it opens from has transforms (scroll
  // motion), which would otherwise trap this fixed overlay inside the page
  // instead of covering the viewport.
  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Set up your league profile">
      <div className="modal-card sheet">
        <h2>Join the Results League</h2>
        <p className="modal-intro">
          Pick a public handle. It's the only thing other players will see, so don't use your full name.
        </p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field">
            <span className="field-label">Handle</span>
            <input className="input"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              minLength={3}
              maxLength={20}
              pattern="[A-Za-z0-9_]+"
              required
              autoFocus
            />
            <span className="field-hint">3 to 20 letters, numbers or underscores.</span>
          </label>

          <fieldset className="field league-fieldset" disabled={ageLocked}>
            <legend className="field-label">Your age group</legend>
            <label className="league-radio">
              <input type="radio" name="age" checked={ageBand === "under_18"} onChange={() => setAgeBand("under_18")} required />
              Under 18
            </label>
            <label className="league-radio">
              <input type="radio" name="age" checked={ageBand === "18_plus"} onChange={() => setAgeBand("18_plus")} />
              18 or over
            </label>
            {ageLocked && <span className="field-hint">Already set. Ask your teacher to change it.</span>}
          </fieldset>
          {ageBand === "under_18" && (
            <p className="notice">
              Players under 18 need a parent or guardian's consent, by signed form or by email from the parent,
              recorded by us, before they can submit forecasts. You can still browse and research in the meantime.
            </p>
          )}

          <label className="field">
            <span className="field-label">
              School <span className="field-optional">Optional</span>
            </span>
            <input className="input" value={school} onChange={(e) => setSchool(e.target.value)} maxLength={80} />
          </label>

          {error && <div className="form-error">{error}</div>}
          <button type="submit" className="btn btn-primary btn-block" disabled={saving || !ageBand} aria-busy={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
          <button type="button" className="btn btn-tertiary btn-block" onClick={onClose}>
            Not now
          </button>
        </form>
      </div>
    </div>,
    document.querySelector(".app-shell") ?? document.body
  );
}

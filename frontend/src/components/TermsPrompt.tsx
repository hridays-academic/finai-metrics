import { useState } from "react";
import { acceptTerms, logOut, ApiError } from "../lib/api";
import { clearAuthToken } from "../lib/auth";
import type { UserPublic } from "../lib/types";

interface TermsPromptProps {
  onAgreed: (user: UserPublic) => void;
  onSignedOut: () => void;
}

// Shown to a signed-in account that hasn't agreed to the current Terms of
// Use and Privacy Policy (UserPublic.needs_terms): accounts made before
// those pages existed, or after a new version. The backend also refuses
// forecasts until they agree, so this can't be skipped via the API. Reuses
// the shared modal styles (see MarketStatusNotice.tsx).
export default function TermsPrompt({ onAgreed, onSignedOut }: TermsPromptProps) {
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAgree() {
    setSaving(true);
    setError(null);
    try {
      onAgreed(await acceptTerms());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save that. Please try again.");
      setSaving(false);
    }
  }

  async function handleSignOut() {
    await logOut();
    clearAuthToken();
    onSignedOut();
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Terms of Use and Privacy Policy">
      <div className="modal-card market-status-card">
        <h2>Terms of Use and Privacy Policy</h2>
        <p className="modal-intro">
          Stackly now has a{" "}
          <a href="#/terms" target="_blank" rel="noopener">
            Terms of Use
          </a>{" "}
          and a{" "}
          <a href="#/privacy" target="_blank" rel="noopener">
            Privacy Policy
          </a>
          . Please read them and agree to keep using your account.
        </p>
        <label className="market-status-dont-show">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />I agree to the
          Terms of Use and Privacy Policy
        </label>
        {error && <div className="search-error">{error}</div>}
        <button
          type="button"
          className="search-button trading-tutorial-close"
          disabled={!checked || saving}
          onClick={handleAgree}
        >
          {saving ? "Saving..." : "Agree and continue"}
        </button>
        <button type="button" className="modal-skip" onClick={handleSignOut}>
          Sign out instead
        </button>
      </div>
    </div>
  );
}

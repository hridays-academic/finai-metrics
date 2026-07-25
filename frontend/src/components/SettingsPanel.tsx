import { FormEvent, useState } from "react";
import type { Theme } from "../hooks/useTheme";
import type { UserPublic } from "../lib/types";
import { logIn, saveTapetideKeyToAccount, validateTapetideKey, ApiError } from "../lib/api";
import { setAuthToken } from "../lib/auth";
import { getTapetideKey, setTapetideKey } from "../lib/tapetideKey";

interface SettingsPanelProps {
  theme: Theme;
  onToggleTheme: () => void;
  onClose: () => void;
  user: UserPublic | null;
  // Called after the active Tapetide key changes, so App.tsx can re-read
  // it from localStorage and refresh the quota counter -- same pattern
  // TapetideKeyGate.tsx's onKeySet already uses.
  onTapetideKeyChange: () => void;
}

type KeyStep = "closed" | "verify" | "edit";

// Reveals/changes the Tapetide key actually being used right now, since
// TapetideKeyGate.tsx only ever runs once (whenever no key is stored yet)
// -- there was previously no way to swap a key afterward short of clearing
// localStorage by hand. Signed-in users must re-enter their password
// first (reuses the existing /api/auth/login check purely as a "prove
// it's still you" gate -- a deliberate extra step before overwriting a
// saved credential, not because the session token itself is untrusted);
// anonymous users skip straight to the key field, matching how the key
// was never protected by anything beyond localStorage in the first place.
export default function SettingsPanel({
  theme,
  onToggleTheme,
  onClose,
  user,
  onTapetideKeyChange,
}: SettingsPanelProps) {
  const [keyStep, setKeyStep] = useState<KeyStep>("closed");
  const [password, setPassword] = useState("");
  const [newKey, setNewKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentKey = getTapetideKey();
  const maskedKey = currentKey ? `Ending in ...${currentKey.slice(-4)}` : "Not set";

  function startConfigure() {
    setError(null);
    setPassword("");
    setNewKey("");
    setKeyStep(user ? "verify" : "edit");
  }

  function cancelConfigure() {
    setError(null);
    setKeyStep("closed");
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      // Re-checking the password via the normal login call -- a fresh,
      // still-valid token comes back either way, so just keep using it.
      const res = await logIn(user.email, password);
      setAuthToken(res.token);
      setKeyStep("edit");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Incorrect password.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveKey(e: FormEvent) {
    e.preventDefault();
    const trimmed = newKey.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      if (user) {
        await saveTapetideKeyToAccount(trimmed);
      } else {
        await validateTapetideKey(trimmed);
      }
      setTapetideKey(trimmed);
      onTapetideKeyChange();
      setKeyStep("closed");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't verify that key. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="settings-backdrop" onClick={onClose} />
      <div className="settings-panel" role="dialog" aria-label="Settings">
        <div className="settings-panel-header">
          <h2>Settings</h2>
          <button className="icon-button" aria-label="Close settings" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="settings-row">
          <div>
            <div className="settings-row-label">Dark mode</div>
            <div className="settings-row-sub">Preference is saved on this device</div>
          </div>
          <button
            className="theme-toggle"
            data-active={theme === "dark"}
            role="switch"
            aria-checked={theme === "dark"}
            aria-label="Toggle dark mode"
            onClick={onToggleTheme}
          >
            <span className="knob" />
          </button>
        </div>

        <div className="settings-row">
          <div>
            <div className="settings-row-label">Tapetide API Key</div>
            <div className="settings-row-sub">{maskedKey}</div>
          </div>
          {keyStep === "closed" && (
            <button type="button" className="settings-key-configure" onClick={startConfigure}>
              Configure
            </button>
          )}
        </div>

        {keyStep === "verify" && (
          <form className="auth-form" onSubmit={handleVerify}>
            <label className="auth-field">
              <span>Confirm your password to continue</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />
            </label>
            {error && <div className="search-error">{error}</div>}
            <div className="settings-key-form-actions">
              <button type="submit" className="search-button auth-submit" disabled={loading}>
                {loading ? "..." : "Verify"}
              </button>
              <button type="button" className="tapetide-gate-skip" onClick={cancelConfigure}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {keyStep === "edit" && (
          <form className="tapetide-gate-form" onSubmit={handleSaveKey}>
            <input
              type="text"
              placeholder="Paste new API key"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              aria-label="New Tapetide API key"
              autoFocus
            />
            <button type="submit" disabled={loading || !newKey.trim()}>
              {loading ? "Checking..." : "Save"}
            </button>
          </form>
        )}
        {keyStep === "edit" && (
          <>
            {error && <div className="tapetide-gate-error">{error}</div>}
            <button type="button" className="tapetide-gate-skip" onClick={cancelConfigure}>
              Cancel
            </button>
          </>
        )}
      </div>
    </>
  );
}

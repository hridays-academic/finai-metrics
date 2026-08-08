import { FormEvent, useState } from "react";
import type { ThemeMode, ThemeName } from "../hooks/useTheme";
import type { UserPublic } from "../lib/types";
import { logIn, saveTapetideKeyToAccount, validateTapetideKey, ApiError } from "../lib/api";
import { setAuthToken } from "../lib/auth";
import { getTapetideKey, setTapetideKey } from "../lib/tapetideKey";

interface SettingsPanelProps {
  themeName: ThemeName;
  mode: ThemeMode;
  onSetThemeName: (theme: ThemeName) => void;
  onSetMode: (mode: ThemeMode) => void;
  onClose: () => void;
  user: UserPublic | null;
  // Called after the active Tapetide key changes, so App.tsx can re-read
  // it from localStorage and refresh the quota counter -- same pattern
  // TapetideKeyGate.tsx's onKeySet already uses.
  onTapetideKeyChange: () => void;
}

// Preview swatch colors for the pickers below -- hand-kept, approximate
// copies of each combination's --bg-app/--accent from theme.css, not read
// live off CSS variables. There's no way to sample "what would --accent
// look like under a theme/mode that ISN'T currently active" without
// something like an offscreen iframe per swatch, and these are purely
// decorative preview dots (not applied anywhere as real UI color), so a
// hand-kept copy is the pragmatic choice -- just keep in sync if
// theme.css's actual values change. Theme swatches always preview that
// theme's DARK mode (its primary identity); the mode picker's own swatches
// are deliberately generic (near-black / near-white) rather than
// theme-tinted, since mode is a light/dark choice independent of theme.
const THEME_OPTIONS: { value: ThemeName; label: string; bg: string; accent: string }[] = [
  { value: "green", label: "Green", bg: "#0a0f0b", accent: "#4f9d6f" },
  { value: "blue", label: "Blue", bg: "#0e1116", accent: "#4fd1c5" },
];

const MODE_OPTIONS: { value: ThemeMode; label: string; bg: string }[] = [
  { value: "dark", label: "Dark", bg: "#0a0a0a" },
  { value: "light", label: "Light", bg: "#f5f5f5" },
];

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
  themeName,
  mode,
  onSetThemeName,
  onSetMode,
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
    // Google-only accounts (user.has_password === false) have nothing to
    // verify a password against -- /api/auth/login would always fail for
    // them, permanently locking them out of this flow if they landed on
    // "verify" anyway. Skip straight to the key field, same as anonymous
    // visitors get: the already-authenticated session stands in for that
    // check in the Google case.
    setKeyStep(user && user.has_password ? "verify" : "edit");
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

        <div className="settings-theme-section">
          <div className="settings-row-label">Theme</div>
          <div className="theme-picker" role="group" aria-label="Choose a theme">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`theme-picker-option ${themeName === opt.value ? "active" : ""}`}
                aria-pressed={themeName === opt.value}
                onClick={() => onSetThemeName(opt.value)}
              >
                <span className="theme-picker-swatch" style={{ background: opt.bg }}>
                  <span className="theme-picker-swatch-accent" style={{ background: opt.accent }} />
                </span>
                <span className="theme-picker-name">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="settings-theme-section">
          <div className="settings-row-label">Mode</div>
          <div className="theme-picker" role="group" aria-label="Choose light or dark mode">
            {MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`theme-picker-option ${mode === opt.value ? "active" : ""}`}
                aria-pressed={mode === opt.value}
                onClick={() => onSetMode(opt.value)}
              >
                <span className="theme-picker-swatch" style={{ background: opt.bg }} />
                <span className="theme-picker-name">{opt.label}</span>
              </button>
            ))}
          </div>
          <div className="settings-row-sub">Preference is saved on this device</div>
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

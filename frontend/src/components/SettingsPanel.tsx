import { FormEvent, useState } from "react";
import type { ThemeMode, ThemeName } from "../hooks/useTheme";
import { deleteAccount, ApiError } from "../lib/api";
import { clearAuthToken } from "../lib/auth";
import type { UserPublic } from "../lib/types";
import { getStartingBalance, setStartingBalance } from "../lib/portfolio";
import { SHOW_EXTRA_TOOLS } from "../lib/features";
import CoinAmount from "./CoinAmount";

interface SettingsPanelProps {
  user: UserPublic | null;
  onAccountDeleted: () => void;
  themeName: ThemeName;
  mode: ThemeMode;
  onSetThemeName: (theme: ThemeName) => void;
  onSetMode: (mode: ThemeMode) => void;
  onClose: () => void;
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

export default function SettingsPanel({
  user,
  onAccountDeleted,
  themeName,
  mode,
  onSetThemeName,
  onSetMode,
  onClose,
}: SettingsPanelProps) {
  const [editingBalance, setEditingBalance] = useState(false);
  const [balanceInput, setBalanceInput] = useState(() => String(getStartingBalance()));
  const [startingBalance, setStartingBalanceState] = useState(getStartingBalance);

  // Delete my account (2026-11): a typed "DELETE" confirms it. See
  // auth_service.delete_account for what is deleted and what is kept
  // anonymised.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete(e: FormEvent) {
    e.preventDefault();
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount(deleteInput.trim());
      clearAuthToken();
      onAccountDeleted();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Couldn't delete your account. Please try again.");
      setDeleting(false);
    }
  }

  function saveStartingBalance() {
    const parsed = Number(balanceInput);
    if (Number.isFinite(parsed) && parsed > 0) {
      setStartingBalance(parsed);
      setStartingBalanceState(parsed);
    }
    setEditingBalance(false);
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

        {SHOW_EXTRA_TOOLS && (
          <>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">Paper Trading starting balance</div>
            <div className="settings-row-sub">
              <CoinAmount value={startingBalance} /> -- applies next time you reset your portfolio, or on
              first use
            </div>
          </div>
          {!editingBalance && (
            <button type="button" className="settings-row-action" onClick={() => setEditingBalance(true)}>
              Change
            </button>
          )}
        </div>
        {editingBalance && (
          <form
            className="modal-form"
            onSubmit={(e) => {
              e.preventDefault();
              saveStartingBalance();
            }}
          >
            <input
              type="number"
              min="1"
              step="1000"
              placeholder="e.g. 1000000"
              value={balanceInput}
              onChange={(e) => setBalanceInput(e.target.value)}
              aria-label="Paper Trading starting balance in coins"
              autoFocus
            />
            <button type="submit" disabled={!balanceInput.trim() || Number(balanceInput) <= 0}>
              Save
            </button>
          </form>
        )}
          </>
        )}

        {user && (
          <>
            <div className="settings-row">
              <div>
                <div className="settings-row-label">Delete my account</div>
                <div className="settings-row-sub">
                  Deletes your account, profile, sign-ins and activity. Your forecasts stay in league results without
                  your name or notes. This can't be undone.
                </div>
              </div>
              {!confirmingDelete && (
                <button type="button" className="settings-row-action" onClick={() => setConfirmingDelete(true)}>
                  Delete
                </button>
              )}
            </div>
            {confirmingDelete && (
              <form className="modal-form" onSubmit={handleDelete}>
                <input
                  placeholder="Type DELETE to confirm"
                  value={deleteInput}
                  onChange={(e) => setDeleteInput(e.target.value)}
                  aria-label="Type DELETE to confirm deleting your account"
                  autoFocus
                />
                <button type="submit" disabled={deleteInput.trim() !== "DELETE" || deleting}>
                  {deleting ? "Deleting..." : "Delete my account"}
                </button>
              </form>
            )}
            {deleteError && <div className="search-error">{deleteError}</div>}
          </>
        )}
      </div>
    </>
  );
}

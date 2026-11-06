import { FormEvent, useState } from "react";
import type { ThemeMode } from "../hooks/useTheme";
import { deleteAccount, ApiError } from "../lib/api";
import { clearAuthToken } from "../lib/auth";
import type { UserPublic } from "../lib/types";
import { getStartingBalance, setStartingBalance } from "../lib/portfolio";
import { SHOW_EXTRA_TOOLS } from "../lib/features";
import CoinAmount from "./CoinAmount";

interface SettingsPanelProps {
  user: UserPublic | null;
  onAccountDeleted: () => void;
  mode: ThemeMode;
  onSetMode: (mode: ThemeMode) => void;
  onClose: () => void;
}

const MODE_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export default function SettingsPanel({
  user,
  onAccountDeleted,
  mode,
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
      <div className="settings-panel sheet" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="settings-panel-header">
          <h2>Settings</h2>
          <button type="button" className="icon-button" aria-label="Close settings" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <section className="settings-section">
          <h3 className="settings-section-title">Appearance</h3>
          <div className="segmented" role="group" aria-label="Appearance">
            {MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={mode === opt.value ? "active" : ""}
                aria-pressed={mode === opt.value}
                onClick={() => onSetMode(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="settings-row-sub">Saved on this device.</p>
        </section>

        {SHOW_EXTRA_TOOLS && (
          <>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">Paper Trading starting balance</div>
            <div className="settings-row-sub">
              <CoinAmount value={startingBalance} />. Applies next time you reset your portfolio, or on
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
            <section className="settings-section">
              <h3 className="settings-section-title">Account</h3>
              <p className="settings-row-sub">
                Deleting your account removes your profile, sign-ins and activity. Your forecasts stay in league
                results without your name or notes. This can't be undone.
              </p>
              {!confirmingDelete ? (
                <button type="button" className="btn btn-destructive" onClick={() => setConfirmingDelete(true)}>
                  Delete my account
                </button>
              ) : (
                <form className="settings-delete-form" onSubmit={handleDelete}>
                  <label className="field">
                    <span className="field-label">Type DELETE to confirm</span>
                    <input
                      className="input"
                      value={deleteInput}
                      onChange={(e) => setDeleteInput(e.target.value)}
                      autoComplete="off"
                      autoFocus
                    />
                  </label>
                  <div className="button-row">
                    <button
                      type="submit"
                      className="btn btn-destructive-filled"
                      disabled={deleteInput.trim() !== "DELETE" || deleting}
                    >
                      {deleting ? "Deleting..." : "Delete my account"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-tertiary"
                      disabled={deleting}
                      onClick={() => {
                        setConfirmingDelete(false);
                        setDeleteInput("");
                        setDeleteError(null);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
              {deleteError && <div className="form-error">{deleteError}</div>}
            </section>
          </>
        )}
      </div>
    </>
  );
}

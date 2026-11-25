import { FormEvent, useRef, useState } from "react";
import { useSheet } from "../hooks/useSheet";
import type { ThemeMode } from "../hooks/useTheme";
import { deleteAccount, ApiError } from "../lib/api";
import { clearAuthToken } from "../lib/auth";
import type { UserPublic } from "../lib/types";
import { getStartingBalance, setStartingBalance } from "../lib/portfolio";
import { SHOW_EXTRA_TOOLS } from "../lib/features";
import { getMotion, getSound, getVibration, type MotionPref, setMotion, setSound, setVibration } from "../lib/prefs";
import CoinAmount from "./CoinAmount";

interface SettingsPanelProps {
  user: UserPublic | null;
  onAccountDeleted: () => void;
  choice: ThemeMode | "device";
  onSetChoice: (choice: ThemeMode | "device") => void;
  onClose: () => void;
}

// K5 (master plan; wording approved 2026-11-24, decisions 2.19).
const MODE_OPTIONS: { value: ThemeMode | "device"; label: string }[] = [
  { value: "device", label: "Match my device" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function Choice<T extends string>({ label, value, options, onPick }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onPick: (v: T) => void;
}) {
  return (
    <div className="settings-choice">
      <span className="field-label">{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map((opt) => (
          <button key={opt.value} type="button" className={value === opt.value ? "active" : ""} aria-pressed={value === opt.value} onClick={() => onPick(opt.value)}>
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function SettingsPanel({
  user,
  onAccountDeleted,
  choice,
  onSetChoice,
  onClose,
}: SettingsPanelProps) {
  const [sound, setSoundState] = useState(getSound);
  const [vibration, setVibrationState] = useState(getVibration);
  const [motion, setMotionState] = useState<MotionPref>(getMotion);
  const sheetRef = useRef<HTMLDivElement>(null);
  useSheet(sheetRef, onClose);
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
      <div className="settings-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="settings-panel sheet" role="dialog" aria-modal="true" aria-label="Settings" ref={sheetRef} tabIndex={-1}>
        <div className="settings-panel-header">
          <h2>Settings</h2>
          <button type="button" className="icon-button" aria-label="Close settings" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <section className="settings-section">
          <h3 className="settings-section-title">On this device</h3>
          <Choice label="Appearance" value={choice} options={MODE_OPTIONS} onPick={onSetChoice} />
          <Choice
            label="Sound"
            value={sound ? "on" : "off"}
            options={[{ value: "off", label: "Off" }, { value: "on", label: "On" }]}
            onPick={(v) => {
              setSound(v === "on");
              setSoundState(v === "on");
            }}
          />
          <Choice
            label="Vibration"
            value={vibration ? "on" : "off"}
            options={[{ value: "on", label: "On" }, { value: "off", label: "Off" }]}
            onPick={(v) => {
              setVibration(v === "on");
              setVibrationState(v === "on");
            }}
          />
          <Choice
            label="Motion"
            value={motion}
            options={[{ value: "full", label: "Full" }, { value: "reduced", label: "Reduced" }]}
            onPick={(v) => {
              setMotion(v);
              setMotionState(v);
            }}
          />
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

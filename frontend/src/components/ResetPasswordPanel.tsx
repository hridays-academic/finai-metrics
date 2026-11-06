import { FormEvent, useState } from "react";
import { resetPassword, ApiError } from "../lib/api";

interface ResetPasswordPanelProps {
  token: string;
  onDone: () => void;
}

// Shown by App.tsx whenever the page loads with a "?reset_token=" query
// param -- the link a password-reset email points at (see main.py's
// /api/auth/forgot-password, which builds that link from this same
// origin). A blocking overlay (the shared `.modal-*` modal styles,
// see TradingTutorial.tsx on that name), not a slide-over like
// AuthPanel.tsx, since arriving here IS the whole reason for this
// page load -- there's nothing else useful to show behind it yet anyway
// (the visitor isn't signed in at this point).
export default function ResetPasswordPanel({ token, onDone }: ResetPasswordPanelProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Reset your password">
      <div className="modal-card sheet">
        <h2>Reset your password</h2>

        {done ? (
          <>
            <p className="modal-intro">
              Your password has been reset. You can now sign in with your new password.
            </p>
            <button type="button" className="btn btn-primary btn-block" onClick={onDone}>
              Continue
            </button>
          </>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="field">
              <span className="field-label">New password</span>
              <input className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoFocus
              />
              <span className="field-hint">At least 8 characters.</span>
            </label>
            <label className="field">
              <span className="field-label">Confirm new password</span>
              <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
            </label>

            {error && <div className="form-error">{error}</div>}

            <button type="submit" className="btn btn-primary btn-block" disabled={loading} aria-busy={loading}>
              {loading ? "Saving..." : "Reset password"}
            </button>
            <button type="button" className="btn btn-tertiary btn-block" onClick={onDone}>
              Cancel
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

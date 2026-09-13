import { FormEvent, useState } from "react";
import { forgotPassword, ApiError } from "../lib/api";

interface ForgotPasswordFormProps {
  // Prefills from whatever the user already typed in the email field above,
  // so switching into this mode doesn't make them retype it.
  initialEmail: string;
  onBack: () => void;
}

// Shared by AuthPanel.tsx and TapetideKeyGate.tsx's "signin" step -- those
// two forms are deliberately separate copies of each other (different
// surrounding chrome, see TapetideKeyGate.tsx's own comment on why), but
// "forgot password" is simple/self-contained enough to actually share
// rather than duplicate a third time.
export default function ForgotPasswordForm({ initialEmail, onBack }: ForgotPasswordFormProps) {
  const [email, setEmail] = useState(initialEmail);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await forgotPassword(email);
      // Always shown on success, regardless of whether this address
      // actually has an account -- see lib/api.ts's forgotPassword comment.
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="auth-form">
        <p className="auth-field-hint">
          If an account exists for <strong>{email}</strong>, a password reset link has been sent --
          it's valid for 30 minutes. Check your inbox (and spam folder).
        </p>
        <button type="button" className="tapetide-gate-skip" onClick={onBack}>
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <p className="auth-field-hint">
        Enter your account's email and we'll send you a link to reset your password.
      </p>
      <label className="auth-field">
        <span>Email</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
      </label>

      {error && <div className="search-error">{error}</div>}

      <button type="submit" className="search-button auth-submit" disabled={loading || !email.trim()}>
        {loading ? "..." : "Send reset link"}
      </button>
      <button type="button" className="tapetide-gate-skip" onClick={onBack}>
        Back to sign in
      </button>
    </form>
  );
}

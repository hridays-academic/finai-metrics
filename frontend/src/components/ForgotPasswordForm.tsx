import { FormEvent, useState } from "react";
import { forgotPassword, ApiError } from "../lib/api";

interface ForgotPasswordFormProps {
  // Prefills from whatever the user already typed in the email field above,
  // so switching into this mode doesn't make them retype it.
  initialEmail: string;
  onBack: () => void;
}

// Used by AuthPanel.tsx's sign-in form. Self-contained, so it stays its own
// component.
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
        <p className="field-hint">
          If an account exists for <strong>{email}</strong>, we've sent a password reset link. It works for 30
          minutes. Check your inbox and spam folder.
        </p>
        <button type="button" className="btn btn-tertiary btn-block" onClick={onBack}>
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <p className="field-hint">
        Enter your account's email and we'll send you a link to reset your password.
      </p>
      <label className="field">
        <span className="field-label">Email</span>
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
      </label>

      {error && <div className="form-error">{error}</div>}

      <button type="submit" className="btn btn-primary btn-block" disabled={loading || !email.trim()} aria-busy={loading}>
        {loading ? "Sending..." : "Send reset link"}
      </button>
      <button type="button" className="btn btn-tertiary btn-block" onClick={onBack}>
        Back to sign in
      </button>
    </form>
  );
}

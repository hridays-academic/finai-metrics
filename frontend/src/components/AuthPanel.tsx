import { FormEvent, useEffect, useRef, useState } from "react";
import { signUp, logIn, logOut, loginWithGoogle, fetchActivity, ApiError } from "../lib/api";
import { setAuthToken, clearAuthToken } from "../lib/auth";
import type { ActivityEntry, UserPublic } from "../lib/types";
import GoogleSignInButton from "./GoogleSignInButton";
import { isGoogleSignInConfigured } from "../lib/googleAuth";
import ForgotPasswordForm from "./ForgotPasswordForm";

interface AuthPanelProps {
  user: UserPublic | null;
  onAuthChange: (user: UserPublic | null) => void;
  onClose: () => void;
}

type Mode = "signin" | "signup" | "forgot";

const ACTION_LABEL: Record<string, string> = {
  signed_up: "Created account",
  logged_in: "Signed in",
  searched: "Searched",
};

// activity_log.created_at is SQLite's `datetime('now')`, which is UTC with
// no timezone suffix ("YYYY-MM-DD HH:MM:SS") -- appending "Z" after
// swapping in the ISO separator is what tells Date() to parse it as UTC
// instead of (incorrectly) local time.
function formatTimestamp(sqliteUtc: string): string {
  const date = new Date(`${sqliteUtc.replace(" ", "T")}Z`);
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export default function AuthPanel({ user, onAuthChange, onClose }: AuthPanelProps) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  // The required "I agree to the Terms and Privacy Policy" box (2026-11).
  // A ref too, because GoogleSignInButton keeps the credential callback it
  // was mounted with.
  const [agreed, setAgreed] = useState(false);
  const agreedRef = useRef(false);
  agreedRef.current = agreed;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activity, setActivity] = useState<ActivityEntry[] | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchActivity()
      .then((res) => {
        if (!cancelled) setActivity(res.entries);
      })
      .catch((err) => {
        if (!cancelled) setActivityError(err instanceof ApiError ? err.message : "Couldn't load activity.");
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = mode === "signup" ? await signUp(email, name, password, agreed) : await logIn(email, password);
      setAuthToken(res.token);
      onAuthChange(res.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleCredential(credential: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await loginWithGoogle(credential, agreedRef.current);
      setAuthToken(res.token);
      onAuthChange(res.user);
    } catch (err) {
      if (err instanceof ApiError && err.code === "terms_required") {
        // A new Google account from the sign-in tab: nothing was created.
        setMode("signup");
        setError("New to Stackly? Tick the box to agree to the Terms of Use and Privacy Policy, then continue with Google.");
        return;
      }
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogOut() {
    await logOut();
    clearAuthToken();
    onAuthChange(null);
  }

  return (
    <>
      <div className="settings-backdrop" onClick={onClose} />
      <div className="settings-panel" role="dialog" aria-label="Account">
        <div className="settings-panel-header">
          <h2>
            {user ? "Your account" : mode === "signup" ? "Create your account" : mode === "forgot" ? "Reset password" : "Welcome back"}
          </h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {user ? (
          <>
            <div className="auth-user-summary">
              <div className="auth-user-name">{user.name}</div>
              <div className="auth-user-email">{user.email}</div>
            </div>

            <div className="auth-activity">
              <div className="auth-activity-label">Recent activity</div>
              {activityError && <div className="search-error">{activityError}</div>}
              {activity === null && !activityError && <div className="auth-activity-empty">Loading...</div>}
              {activity && activity.length === 0 && (
                <div className="auth-activity-empty">No activity yet -- try searching a company.</div>
              )}
              {activity && activity.length > 0 && (
                <ul className="auth-activity-list">
                  {activity.map((entry, i) => (
                    <li className="auth-activity-item" key={i}>
                      <span className="auth-activity-action">
                        {ACTION_LABEL[entry.action] ?? entry.action}
                        {entry.detail ? `: ${entry.detail}` : ""}
                      </span>
                      <span className="auth-activity-time">{formatTimestamp(entry.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <button type="button" className="auth-signout" onClick={handleLogOut}>
              Sign out
            </button>
          </>
        ) : mode === "forgot" ? (
          <ForgotPasswordForm initialEmail={email} onBack={() => setMode("signin")} />
        ) : (
          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="auth-mode-toggle" role="group" aria-label="Sign in or create an account">
              <button type="button" className={mode === "signin" ? "active" : ""} onClick={() => setMode("signin")}>
                Sign in
              </button>
              <button type="button" className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>
                Sign up
              </button>
            </div>

            {mode === "signup" && (
              <label className="auth-field">
                <span>Name</span>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
            )}
            <label className="auth-field">
              <span>Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label className="auth-field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
              {mode === "signup" && <span className="auth-field-hint">At least 8 characters</span>}
            </label>

            {mode === "signin" && (
              <button type="button" className="auth-forgot-link" onClick={() => setMode("forgot")}>
                Forgot password?
              </button>
            )}

            {mode === "signup" && (
              <label className="market-status-dont-show">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} required />
                <span>
                  I agree to the{" "}
                  <a href="#/terms" target="_blank" rel="noopener">
                    Terms of Use
                  </a>{" "}
                  and{" "}
                  <a href="#/privacy" target="_blank" rel="noopener">
                    Privacy Policy
                  </a>
                </span>
              </label>
            )}

            {error && <div className="search-error">{error}</div>}

            {/* Directly above the submit button, not after the Google
                button/divider below -- it was easy to miss down there
                (past a visual divider, reads as belonging to the "or"
                alternative rather than the form itself). This placement
                means it's in the way of every submit path, password or
                Google. */}
            <p className="auth-disclaimer">
              Stackly provides financial data and educational information only. Any financial
              decisions you make using data from this site are your own responsibility -- the site and
              its owner(s) accept no liability for outcomes resulting from its use.
            </p>

            <button type="submit" className="search-button auth-submit" disabled={loading || (mode === "signup" && !agreed)}>
              {loading ? "..." : mode === "signup" ? "Create account" : "Sign in"}
            </button>

            {/* Renders nothing if VITE_GOOGLE_CLIENT_ID isn't configured --
                see GoogleSignInButton.tsx. */}
            <div className="auth-divider">
              <span>or</span>
            </div>
            {/* Google creates the account on its first click, so on the
                sign-up tab it only appears once the box is ticked. */}
            {mode === "signup" && !agreed ? (
              isGoogleSignInConfigured() && <p className="auth-field-hint">Tick the box above to continue with Google.</p>
            ) : (
              <GoogleSignInButton onCredential={handleGoogleCredential} />
            )}
          </form>
        )}
      </div>
    </>
  );
}

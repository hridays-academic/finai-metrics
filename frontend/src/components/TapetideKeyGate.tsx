import { FormEvent, useState } from "react";
import {
  validateTapetideKey,
  saveTapetideKeyToAccount,
  signUp,
  logIn,
  loginWithGoogle,
  ApiError,
} from "../lib/api";
import { setTapetideKey } from "../lib/tapetideKey";
import { setAuthToken } from "../lib/auth";
import type { UserPublic } from "../lib/types";
import GoogleSignInButton from "./GoogleSignInButton";

const TAPETIDE_TOKENS_URL = "https://tapetide.com/settings/tokens";

type Step = "welcome" | "signin" | "signup" | "key";

interface TapetideKeyGateProps {
  user: UserPublic | null;
  // True once App.tsx has finished checking a stored auth token (or there
  // was never one to check) -- see the note on the loading branch below for
  // why this matters.
  sessionChecked: boolean;
  onAuthChange: (user: UserPublic | null) => void;
  onKeySet: () => void;
}

// Full-screen, blocking overlay shown whenever no Tapetide API key is
// stored yet -- see CLAUDE.md's "Bring-your-own Tapetide key" section for
// why every visitor needs their own (one shared key's 50-calls/day free
// tier can't cover more than one person). Blurs the app behind it via
// backdrop-filter rather than a class toggle on the app root, so this
// component doesn't need to reach into anything else's DOM/styling.
//
// (2026-07) Now a small multi-step flow rather than a single form: signing
// in first can skip key entry entirely if the account already has one
// saved (main.py's /api/auth/login returns the decrypted key alongside the
// session token), and signing up funnels straight into key entry, which
// then saves to the new account instead of just this browser. "Continue
// without an account" preserves the original, simpler flow unchanged for
// anyone who doesn't want either.
export default function TapetideKeyGate({ user, sessionChecked, onAuthChange, onKeySet }: TapetideKeyGateProps) {
  // Starts on "key" (skipping the welcome screen) if App.tsx already
  // resolved a signed-in user by the time this mounts -- e.g. a valid
  // session token but no saved key yet, or a saved key that already got
  // adopted (in which case this component won't even be rendered at all,
  // see App.tsx).
  const [step, setStep] = useState<Step>(user ? "key" : "welcome");

  // -- Sign in / sign up (mirrors AuthPanel.tsx's form -- kept as its own
  // copy since this is a full-screen gate step, not a slide-over, and the
  // two have different enough surrounding chrome that sharing the form
  // JSX wasn't worth the coupling). --
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // -- Tapetide key entry --
  const [key, setKey] = useState("");
  const [keyLoading, setKeyLoading] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  // Shared by password sign-in/sign-up and Google Sign-In below -- either
  // path ends with the same AuthResponse shape, so both funnel into
  // whichever of "adopt the account's saved key" / "ask for one" applies.
  function handleAuthSuccess(res: { token: string; user: UserPublic }) {
    setAuthToken(res.token);
    onAuthChange(res.user);
    if (res.user.tapetide_key) {
      // Account already has a key saved (returning user, signed in from
      // a fresh browser) -- use it directly, no key-entry step needed.
      setTapetideKey(res.user.tapetide_key);
      onKeySet();
    } else {
      setStep("key");
    }
  }

  async function handleAuthSubmit(e: FormEvent) {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = mode === "signup" ? await signUp(email, name, password) : await logIn(email, password);
      handleAuthSuccess(res);
    } catch (err) {
      setAuthError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleGoogleCredential(credential: string) {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await loginWithGoogle(credential);
      handleAuthSuccess(res);
    } catch (err) {
      setAuthError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleKeySubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) return;
    setKeyLoading(true);
    setKeyError(null);
    try {
      if (user) {
        // Signed in -- validate AND persist to the account (encrypted at
        // rest, see auth_service.py) so it's there next time they sign in,
        // even from a different browser/device.
        await saveTapetideKeyToAccount(trimmed);
      } else {
        // Anonymous ("continue without an account") -- same validate-only
        // check as before, nothing saved server-side.
        await validateTapetideKey(trimmed);
      }
      setTapetideKey(trimmed);
      onKeySet();
    } catch (err) {
      setKeyError(err instanceof ApiError ? err.message : "Couldn't verify that key. Please try again.");
    } finally {
      setKeyLoading(false);
    }
  }

  // Covers the brief window where App.tsx has a stored auth token but
  // hasn't heard back from /api/auth/me yet -- without this, a returning
  // signed-in visitor whose account has a saved key would see the welcome
  // screen flash before this component (or the whole gate) disappears a
  // moment later. Showing the same blurred overlay throughout (just with
  // different content) avoids any flash of the raw, ungated app instead.
  if (!sessionChecked) {
    return (
      <div className="tapetide-gate-overlay" role="dialog" aria-modal="true" aria-label="Loading">
        <div className="tapetide-gate-card">
          <p className="tapetide-gate-intro">Checking your session...</p>
        </div>
      </div>
    );
  }

  if (step === "welcome") {
    return (
      <div className="tapetide-gate-overlay" role="dialog" aria-modal="true" aria-label="Sign in or continue">
        <div className="tapetide-gate-card">
          <h2>Welcome to Stackly Metrics</h2>
          <p className="tapetide-gate-intro">
            Sign in to reuse a Tapetide key you've already saved, or sign up to save one for next time.
          </p>
          <div className="tapetide-gate-welcome-actions">
            <button
              type="button"
              className="search-button"
              onClick={() => {
                setMode("signin");
                setStep("signin");
              }}
            >
              Sign In
            </button>
            <button
              type="button"
              className="search-button"
              onClick={() => {
                setMode("signup");
                setStep("signup");
              }}
            >
              Sign Up
            </button>
          </div>
          <button type="button" className="tapetide-gate-skip" onClick={() => setStep("key")}>
            Continue without an account
          </button>
        </div>
      </div>
    );
  }

  if (step === "signin" || step === "signup") {
    return (
      <div
        className="tapetide-gate-overlay"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "signup" ? "Sign up" : "Sign in"}
      >
        <div className="tapetide-gate-card">
          <h2>{mode === "signup" ? "Create Account" : "Sign In"}</h2>
          <form className="auth-form" onSubmit={handleAuthSubmit}>
            <div className="auth-mode-toggle" role="group" aria-label="Sign in or create an account">
              <button type="button" className={mode === "signin" ? "active" : ""} onClick={() => setMode("signin")}>
                Sign In
              </button>
              <button type="button" className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>
                Sign Up
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
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
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

            {authError && <div className="search-error">{authError}</div>}

            {/* Directly above the submit button, not after the Google
                button/divider below -- it was easy to miss down there
                (past a visual divider, reads as belonging to the "or"
                alternative rather than the form itself). This placement
                means it's in the way of every submit path, password or
                Google. */}
            <p className="auth-disclaimer">
              Stackly Metrics provides financial data and educational information only. Any financial
              decisions you make using data from this site are your own responsibility -- the site and
              its owner(s) accept no liability for outcomes resulting from its use.
            </p>

            <button type="submit" className="search-button auth-submit" disabled={authLoading}>
              {authLoading ? "..." : mode === "signup" ? "Create Account" : "Sign In"}
            </button>

            {/* Renders nothing if VITE_GOOGLE_CLIENT_ID isn't configured --
                see GoogleSignInButton.tsx. */}
            <div className="auth-divider">
              <span>or</span>
            </div>
            <GoogleSignInButton onCredential={handleGoogleCredential} />
          </form>
          <button type="button" className="tapetide-gate-skip" onClick={() => setStep("key")}>
            Continue without an account
          </button>
        </div>
      </div>
    );
  }

  // step === "key"
  return (
    <div className="tapetide-gate-overlay" role="dialog" aria-modal="true" aria-label="Connect your Tapetide account">
      <div className="tapetide-gate-card">
        <h2>Connect your Tapetide account</h2>
        <p className="tapetide-gate-intro">
          Stackly Metrics fetches real NSE/BSE price history and analyst data through{" "}
          <a href={TAPETIDE_TOKENS_URL} target="_blank" rel="noopener noreferrer">
            Tapetide
          </a>
          . It's free, but every visitor needs their own API key -- here's how to get one:
        </p>

        <ol className="tapetide-gate-steps">
          <li>
            Go to{" "}
            <a href={TAPETIDE_TOKENS_URL} target="_blank" rel="noopener noreferrer">
              Tapetide
            </a>{" "}
            and create a free account, or sign in if you already have one.
          </li>
          <li>Open your API tokens page and generate a new token.</li>
          <li>Copy the token.</li>
          <li>Paste it below and hit "Use this key."</li>
        </ol>

        <form className="tapetide-gate-form" onSubmit={handleKeySubmit}>
          <input
            type="text"
            placeholder="Paste your Tapetide API key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            aria-label="Tapetide API key"
            autoFocus
          />
          <button type="submit" disabled={keyLoading || !key.trim()}>
            {keyLoading ? "Checking..." : "Use this key"}
          </button>
        </form>
        {keyError && <div className="tapetide-gate-error">{keyError}</div>}

        <p className="tapetide-gate-note">
          {user
            ? "Your key is saved to your account (encrypted) so you won't need to re-enter it next time you sign in."
            : "Your key is stored only in this browser and sent straight to our backend, which forwards it to Tapetide on your behalf -- it's never saved on our servers."}
        </p>
      </div>
    </div>
  );
}

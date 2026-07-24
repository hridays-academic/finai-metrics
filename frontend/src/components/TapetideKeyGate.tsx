import { FormEvent, useState } from "react";
import { validateTapetideKey, ApiError } from "../lib/api";
import { setTapetideKey } from "../lib/tapetideKey";

const TAPETIDE_TOKENS_URL = "https://tapetide.com/settings/tokens";

interface TapetideKeyGateProps {
  onKeySet: () => void;
}

// Full-screen, blocking overlay shown whenever no Tapetide API key is
// stored yet -- see CLAUDE.md's "Bring-your-own Tapetide key" section for
// why every visitor needs their own (one shared key's 50-calls/day free
// tier can't cover more than one person). Blurs the app behind it via
// backdrop-filter rather than a class toggle on the app root, so this
// component doesn't need to reach into anything else's DOM/styling.
export default function TapetideKeyGate({ onKeySet }: TapetideKeyGateProps) {
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      // Verified against Tapetide's real API before we ever store it --
      // see main.py's /api/tapetide/validate.
      await validateTapetideKey(trimmed);
      setTapetideKey(trimmed);
      onKeySet();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't verify that key. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="tapetide-gate-overlay" role="dialog" aria-modal="true" aria-label="Connect your Tapetide account">
      <div className="tapetide-gate-card">
        <h2>Connect your Tapetide account</h2>
        <p className="tapetide-gate-intro">
          FinAI Metrics fetches real NSE/BSE price history and analyst data through{" "}
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

        <form className="tapetide-gate-form" onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Paste your Tapetide API key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            aria-label="Tapetide API key"
            autoFocus
          />
          <button type="submit" disabled={loading || !key.trim()}>
            {loading ? "Checking..." : "Use this key"}
          </button>
        </form>
        {error && <div className="tapetide-gate-error">{error}</div>}

        <p className="tapetide-gate-note">
          Your key is stored only in this browser and sent straight to our backend, which forwards it
          to Tapetide on your behalf -- it's never saved on our servers.
        </p>
      </div>
    </div>
  );
}

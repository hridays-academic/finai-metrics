import { FormEvent, useEffect, useState } from "react";
import type { QuotaStatus } from "../lib/types";
import QuotaCounter from "./QuotaCounter";

interface CompanySearchProps {
  onSearch: (query: string) => void;
  loading: boolean;
  error: string | null;
  quota: QuotaStatus | null;
  tapetideResetAt: string | null;
}

function formatCountdown(resetAt: string): string {
  const diffMs = new Date(resetAt).getTime() - Date.now();
  if (diffMs <= 0) return "any moment now";
  const totalMinutes = Math.ceil(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

// Re-renders on its own timer so "resets in Xh Ym" counts down live instead
// of freezing at whatever it read when the API response first arrived.
function TapetideResetCountdown({ resetAt }: { resetAt: string }) {
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceUpdate((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="search-source-reset" role="status">
      Tapetide resets in {formatCountdown(resetAt)}
    </span>
  );
}

export default function CompanySearch({ onSearch, loading, error, quota, tapetideResetAt }: CompanySearchProps) {
  const [query, setQuery] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed) onSearch(trimmed);
  }

  return (
    <div className="search-bar-wrap">
      <div className="search-row">
        <form className="search-form" onSubmit={handleSubmit}>
          <input
            className="search-input"
            type="text"
            placeholder="Enter a company name or ticker, e.g. Reliance, TCS, or RELIANCE.NS"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Company name or ticker"
          />
          <button className="search-button" type="submit" disabled={loading || !query.trim()}>
            {loading ? "Loading..." : "Search"}
          </button>
        </form>

        {quota && <QuotaCounter quota={quota} />}
        {tapetideResetAt && <TapetideResetCountdown resetAt={tapetideResetAt} />}
      </div>
      {error && <div className="search-error">{error}</div>}
      <div className="search-hint">
        Tip: use the exact NSE/BSE ticker (e.g. "RELIANCE.NS" or "TATASTEEL.BO") for the most
        reliable match.
      </div>
      <p className="page-disclaimer">
        Stackly provides financial data and educational information only. Any financial decisions
        you make using data from this site are your own responsibility -- the site and its
        owner(s) accept no liability for outcomes resulting from its use.
      </p>
    </div>
  );
}

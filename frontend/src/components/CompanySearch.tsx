import { FormEvent, useState } from "react";

interface CompanySearchProps {
  onSearch: (query: string) => void;
  loading: boolean;
  error: string | null;
}

export default function CompanySearch({ onSearch, loading, error }: CompanySearchProps) {
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

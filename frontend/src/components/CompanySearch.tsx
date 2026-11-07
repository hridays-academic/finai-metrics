import { FormEvent, useEffect, useState } from "react";
import ArrowChip from "./ArrowChip";

interface CompanySearchProps {
  onSearch: (query: string) => void;
  loading: boolean;
  error: string | null;
  // Set when a company page opened Research: fills the box with its symbol.
  prefill?: string;
  // Set when the visitor arrived from a company page, for the way back.
  backTo?: { eventId: number; name: string } | null;
  onBack?: () => void;
}

export default function CompanySearch({ onSearch, loading, error, prefill, backTo, onBack }: CompanySearchProps) {
  const [query, setQuery] = useState(prefill ?? "");

  useEffect(() => {
    if (prefill) setQuery(prefill);
  }, [prefill]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed) onSearch(trimmed);
  }

  return (
    <div className="search-bar-wrap">
      <div className="glass panel research-search">
      {backTo && (
        <a
          className="back-link"
          href={`#/event/${backTo.eventId}`}
          onClick={onBack}
        >
          ← Back to forecast: {backTo.name}
        </a>
      )}
      <h1 className="page-title">Research</h1>
      <form className="search-form" onSubmit={handleSubmit}>
        <input
          className="input search-input"
          type="search"
          placeholder="Company name or ticker, e.g. Reliance, TCS or RELIANCE.NS"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Company name or ticker"
        />
        <button className="btn btn-primary" type="submit" disabled={loading || !query.trim()} aria-busy={loading}>
          {loading ? "Searching..." : "Search"}
          {!loading && <ArrowChip />}
        </button>
      </form>
      {error && <div className="form-error">{error}</div>}
      <p className="footnote">
        For the most reliable match, use the exact ticker, such as RELIANCE.NS or TATASTEEL.BO. Stackly is for education
        only. Any financial decisions you make are your own responsibility, and Stackly and its owner accept no liability
        for them.
      </p>
      </div>
    </div>
  );
}

import { FormEvent, useState } from "react";
import ArrowChip from "./ArrowChip";

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
      <div className="glass panel research-search">
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

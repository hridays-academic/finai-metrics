import { FormEvent, useEffect, useState } from "react";

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
    <section className="glass panel research-search" aria-labelledby="research-title">
      {backTo && (
        <a
          className="back-link"
          href={`#/event/${backTo.eventId}`}
          onClick={onBack}
          data-keep-scroll
        >
          ← Back to forecast: {backTo.name}
        </a>
      )}
      <h1 className="research-title" id="research-title">
        Research
      </h1>
      <form className="search-form" onSubmit={handleSubmit}>
        <input
          className="input search-input"
          type="search"
          placeholder="Company name or ticker, e.g. Reliance, TCS or RELIANCE.NS"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Company name or ticker"
        />
        <button
          className={`btn btn-primary ${loading ? "" : "btn-arrow"}`}
          type="submit"
          disabled={loading || !query.trim()}
          aria-busy={loading}
        >
          {loading ? "Searching..." : "Search"}
          {!loading && <span className="btn-arrow-icon" aria-hidden="true" />}
        </button>
      </form>
      {error && <div className="form-error">{error}</div>}
      <p className="footnote">
        {/* RW6/W5 (master plan): the liability line lives in the Terms and the footer, not here. */}
        For the most reliable match, use the exact ticker, such as RELIANCE.NS or TATASTEEL.BO.
      </p>
    </section>
  );
}

import { useEffect, useState } from "react";
import type { RecommendedCompany } from "../lib/types";
import { fetchRecommendations } from "../lib/api";

interface RecommendedCompanyCardProps {
  company: RecommendedCompany;
  onSelect: (ticker: string) => void;
}

// Empty-state suggestions, rotated daily server-side. Sourced from
// Bharat-SM-Data specifically so this costs zero Tapetide quota just from
// loading the empty page. Clicking a card still runs a normal search
// (Tapetide by default, unless the user has picked a different source),
// same as typing the ticker in.
//
// (2026-07) No longer shows a hover popover with the verdict/explanation --
// removed at the user's request. The backend still computes and returns
// `verdict`/`explanation` on RecommendedCompany unchanged (same functions a
// real search uses); this component just doesn't render them anymore. See
// CLAUDE.md's "Homepage recommendations" section for the history if this
// needs revisiting.
function RecommendedCompanyCard({ company, onSelect }: RecommendedCompanyCardProps) {
  return (
    <div className="recommended-company-card" onClick={() => onSelect(company.ticker)}>
      <span className="recommended-company-name">{company.name}</span>
      <span className="recommended-company-meta">
        {company.ticker}
        {company.sector ? ` · ${company.sector}` : ""}
      </span>
      <span className="recommended-company-arrow" aria-hidden="true">
        →
      </span>
    </div>
  );
}

interface RecommendedCompaniesProps {
  onSelect: (ticker: string) => void;
}

export default function RecommendedCompanies({ onSelect }: RecommendedCompaniesProps) {
  const [companies, setCompanies] = useState<RecommendedCompany[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRecommendations()
      .then((res) => {
        if (!cancelled) setCompanies(res.companies);
      })
      .catch(() => {
        // Nice-to-have, not core -- if it fails, just don't show the section
        // rather than surfacing an error on an otherwise-empty page.
        if (!cancelled) setCompanies([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!companies || companies.length === 0) return null;

  return (
    <div className="recommended-companies">
      <div className="recommended-companies-label">Or try one of these</div>
      {/* Column count matches however many came back today (3-5, see
          _RECOMMENDATIONS_PER_DAY) so they always sit in exactly one row --
          equal-width columns rather than a fixed card width that could wrap
          depending on viewport/name length. */}
      <div className="recommended-companies-grid" style={{ gridTemplateColumns: `repeat(${companies.length}, 1fr)` }}>
        {companies.map((c) => (
          <RecommendedCompanyCard key={c.ticker} company={c} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

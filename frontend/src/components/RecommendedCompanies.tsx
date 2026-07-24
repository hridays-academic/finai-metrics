import { useEffect, useRef, useState } from "react";
import type { RecommendedCompany } from "../lib/types";
import { fetchRecommendations } from "../lib/api";

// Same reasoning as MetricCard.tsx's POPOVER_APPROX_HEIGHT -- flip the
// popover upward if there isn't room below in the viewport.
const POPOVER_APPROX_HEIGHT = 180;

// Empty-state suggestions, rotated daily server-side. Sourced from
// Bharat-SM-Data specifically so this costs zero Tapetide quota just from
// loading the empty page. Clicking a card still runs a normal search
// (Tapetide by default, unless the user has picked a different source),
// same as typing the ticker in.
//
// The underlying verdict (Strong/Mixed/Weak Fundamentals) is still real,
// freshly-computed Health Snapshot data -- shown as plain text in the hover
// popover -- but deliberately NOT color-coded on the card itself anymore.
// A green/yellow/red border on an untouched empty-state suggestion read as
// a "buy this" signal at a glance, which is exactly the kind of thing this
// app avoids everywhere else (see CLAUDE.md's HealthSnapshot vs
// AnalystConsensus distinction) -- so every card is plain neutral grey now,
// and the verdict text only shows once you've actually opened the popover
// and have the explanation alongside it for context.
const VERDICT_LABEL: Record<string, string> = {
  good: "Strong Fundamentals",
  warning: "Mixed Fundamentals",
  bad: "Weak Fundamentals",
};

interface RecommendedCompanyCardProps {
  company: RecommendedCompany;
  onSelect: (ticker: string) => void;
}

function RecommendedCompanyCard({ company, onSelect }: RecommendedCompanyCardProps) {
  const [open, setOpen] = useState(false);
  const [openAbove, setOpenAbove] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  function handleOpen() {
    const rect = cardRef.current?.getBoundingClientRect();
    if (rect) {
      setOpenAbove(window.innerHeight - rect.bottom < POPOVER_APPROX_HEIGHT);
    }
    setOpen(true);
  }

  return (
    <div
      ref={cardRef}
      className="recommended-company-card"
      onMouseEnter={handleOpen}
      onMouseLeave={() => setOpen(false)}
      onClick={() => onSelect(company.ticker)}
    >
      <span className="recommended-company-name">{company.name}</span>
      <span className="recommended-company-meta">
        {company.ticker}
        {company.sector ? ` · ${company.sector}` : ""}
      </span>
      <span className="recommended-company-arrow" aria-hidden="true">
        →
      </span>

      {open && (
        <div className={`metric-popover ${openAbove ? "above" : ""}`} role="tooltip">
          <div className="metric-popover-title">{company.name}</div>
          {/* No tone class -- falls back to the popover's plain neutral-grey
              background, matching every other card here. */}
          <p className="metric-popover-assessment">{VERDICT_LABEL[company.verdict] ?? company.verdict}</p>
          <p className="metric-popover-definition">{company.explanation}</p>
        </div>
      )}
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

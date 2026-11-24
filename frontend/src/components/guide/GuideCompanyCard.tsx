import { useEffect, useState } from "react";
import { fetchRecentResults } from "../../lib/api";
import { colourClass, DIFFICULTY_LABEL } from "../../lib/difficulty";
import { useCompanyDifficulty } from "../../hooks/useCompanyDifficulty";
import DifficultyEdge from "../DifficultyEdge";
import { Grain, Guilloche } from "../league/CardArt";

// A small version of a company's Home tile (2026-11-19, guide v3): the card
// material (engraving and grain) in the company's difficulty colour, with its
// sector and name, beside the real numbers on pages 2, 3, 6 and 7. The colour
// comes from the league's research history, as on Home; graphite until it
// loads or if it can't.

export const GUIDE_COMPANIES = {
  maruti: { ticker: "MARUTI", name: "Maruti Suzuki", sector: "Autos" },
  marico: { ticker: "MARICO", name: "Marico", sector: "Everyday goods" },
} as const;

export type GuideCompany = keyof typeof GUIDE_COMPANIES;

// One request for both companies' league ids, shared by every card.
let ids: Promise<Record<string, number>> | null = null;
function companyIds(): Promise<Record<string, number>> {
  if (!ids) {
    ids = fetchRecentResults()
      .then((rows) => Object.fromEntries(rows.map((r) => [r.event.company.ticker, r.event.company.id])))
      .catch(() => {
        ids = null;
        return {};
      });
  }
  return ids;
}

export default function GuideCompanyCard({ company, className = "" }: { company: GuideCompany; className?: string }) {
  const c = GUIDE_COMPANIES[company];
  const [id, setId] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    companyIds().then((all) => !cancelled && setId(all[c.ticker] ?? null));
    return () => {
      cancelled = true;
    };
  }, [c.ticker]);
  const level = useCompanyDifficulty(id);
  return (
    <div className={`sector-tile g2-company ${colourClass(level)} ${level ? "has-edge" : ""} ${className}`} aria-hidden="true">
      <span className="tile-material">
        <Guilloche />
        <Grain />
      </span>
      <DifficultyEdge label={level ? DIFFICULTY_LABEL[level] : null} />
      <span className="tile-sector">{c.sector}</span>
      <span className="tile-name">{c.name}</span>
    </div>
  );
}

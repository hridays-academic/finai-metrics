import { useEffect, useState } from "react";
import { fetchResearchHistory } from "../lib/api";
import { type Difficulty, difficultyOf, fromProviderRows } from "../lib/difficulty";

// A league company's difficulty level (lib/difficulty), from the league's
// research history so it matches Home, the company page and Research. One
// request per company per visit (the history is cached server-side too).
const known = new Map<number, Promise<Difficulty | null>>();

function levelFor(companyId: number): Promise<Difficulty | null> {
  let p = known.get(companyId);
  if (!p) {
    p = Promise.resolve()
      .then(() => fetchResearchHistory(companyId))
      .then((h) => difficultyOf(fromProviderRows(h?.provider_rows)))
      .catch(() => {
        known.delete(companyId);
        return null;
      });
    known.set(companyId, p);
  }
  return p;
}

// S4 (master plan): Home primes the level from rows it already has (the
// recent-results response), so it makes no history request per company.
export function primeDifficulty(companyId: number, rows: Parameters<typeof fromProviderRows>[0]): void {
  if (!known.has(companyId) && rows && rows.length) known.set(companyId, Promise.resolve(difficultyOf(fromProviderRows(rows))));
}

export function useCompanyDifficulty(companyId: number | null | undefined): Difficulty | null {
  const [level, setLevel] = useState<Difficulty | null>(null);
  useEffect(() => {
    if (companyId == null) return;
    let cancelled = false;
    levelFor(companyId).then((l) => !cancelled && setLevel(l));
    return () => {
      cancelled = true;
    };
  }, [companyId]);
  return companyId == null ? null : level;
}

import { useEffect, useState } from "react";
import { fetchLeagueConfig, fetchLeagueEvents } from "./api";

// Which league sector (if any) a Research company belongs to, so its card
// can use the same sector colour as the forecast page. Read once per visit
// from the public league lists; anything not in the league is null (the
// card is then neutral graphite).
interface SectorLookup {
  bySymbol: Map<string, { sector: string; companyId: number }>;
  names: Map<string, string>;
}

let lookup: Promise<SectorLookup> | null = null;

function load(): Promise<SectorLookup> {
  if (!lookup) {
    lookup = Promise.all([
      fetchLeagueEvents("upcoming").catch(() => []),
      fetchLeagueEvents("scored").catch(() => []),
      fetchLeagueConfig().catch(() => null),
    ]).then(([up, scored, config]) => {
      const bySymbol = new Map<string, { sector: string; companyId: number }>();
      for (const e of [...up, ...scored]) {
        const c = e.company;
        for (const s of [c.provider_symbol, `${c.ticker}.NS`, `${c.ticker}.BO`, c.ticker]) {
          if (s) bySymbol.set(s.toUpperCase(), { sector: c.sector, companyId: c.id });
        }
      }
      const names = new Map((config?.sector_explainers ?? []).map((x) => [x.sector, x.display_name]));
      return { bySymbol, names };
    });
  }
  return lookup;
}

export interface LeagueMatch {
  sector: string | null;
  label: string | null;
  companyId: number | null; // for the league's research history
}

export function useLeagueSector(symbol: string): LeagueMatch {
  const [found, setFound] = useState<LeagueMatch>({ sector: null, label: null, companyId: null });
  useEffect(() => {
    let cancelled = false;
    load().then(({ bySymbol, names }) => {
      if (cancelled) return;
      const match = bySymbol.get(symbol.toUpperCase());
      const sector = match?.sector ?? null;
      setFound({
        sector,
        label: sector ? names.get(sector) ?? sector.charAt(0).toUpperCase() + sector.slice(1) : null,
        companyId: match?.companyId ?? null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [symbol]);
  return found;
}

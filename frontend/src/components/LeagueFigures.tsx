import { useEffect, useState } from "react";
import { fetchResearchCompanies, fetchResearchHistory } from "../lib/api";
import { quarterLabel } from "../lib/leagueFormat";
import { n } from "../lib/scoring";
import type { ActualRow } from "../lib/types";
import SectorCheatSheet from "./SectorCheatSheet";

// RW3 (master plan phase 7): on a league or practice company's Research
// page, the league's own three numbers come first: the figures students
// forecast, from the company's filings, newest first. League figures only.
// Heading and note are DRAFT wording.

const COLUMNS: { key: string; label: string }[] = [
  { key: "revenue_growth_yoy", label: "Revenue growth" },
  { key: "operating_margin", label: "Operating margin" },
  { key: "sector_kpi", label: "Sector number" },
];

export default function LeagueFigures({ symbol }: { symbol: string }) {
  const [rows, setRows] = useState<ActualRow[] | null>(null);
  const [sector, setSector] = useState<{ key: string; name: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setRows(null);
    fetchResearchCompanies()
      .then((cs) => {
        const c = cs.find((x) => x.symbol === symbol);
        if (!c) return;
        setSector({ key: c.sector, name: c.sector_name });
        return fetchResearchHistory(c.id).then((h) => !cancelled && setRows(h.actuals));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [symbol]);
  if (!rows || rows.length === 0) return null;
  const ends = [...new Set(rows.map((r) => r.period_end_date))].sort().reverse().slice(0, 8);
  const cell = (end: string, key: string) => rows.find((r) => r.period_end_date === end && r.metric_key === key);
  return (
    <section className="glass panel league-figures" aria-labelledby="league-figures-title">
      <h2 className="section-title" id="league-figures-title">
        League figures
      </h2>
      <p className="section-text">The three numbers the league scores, from the company's own filings. Links open the source.</p>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Quarter to</th>
              {COLUMNS.map((c) => (
                <th key={c.key} scope="col">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ends.map((end) => (
              <tr key={end}>
                <th scope="row">{quarterLabel(end)}</th>
                {COLUMNS.map((c) => {
                  const a = cell(end, c.key);
                  return (
                    <td key={c.key}>
                      {a ? (
                        <a href={a.source_url} target="_blank" rel="noopener noreferrer">
                          {n(a.value)}%
                        </a>
                      ) : (
                        "N/A"
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sector && <SectorCheatSheet sector={sector.key} sectorName={sector.name} />}
    </section>
  );
}

import { useEffect, useState } from "react";
import { fetchPeer } from "../lib/api";
import type { PeerSummary } from "../lib/types";
import { formatDay } from "../lib/leagueFormat";

const COLS: { key: keyof PeerSummary; label: string; unit: "%" | "x" }[] = [
  { key: "revenue_growth", label: "Revenue growth", unit: "%" },
  { key: "ebitda_margin", label: "EBITDA margin", unit: "%" },
  { key: "net_margin", label: "Net margin", unit: "%" },
  { key: "roe", label: "ROE", unit: "%" },
  { key: "roce", label: "ROCE", unit: "%" },
  { key: "debt_to_equity", label: "Debt / equity", unit: "x" },
  { key: "pe_ratio", label: "P/E", unit: "x" },
  { key: "ev_to_ebitda", label: "EV / EBITDA", unit: "x" },
];

function cell(v: unknown, unit: "%" | "x") {
  if (typeof v !== "number") return <span className="cell-na">N/A</span>;
  return unit === "%" ? `${v.toFixed(1)}%` : `${v.toFixed(1)}x`;
}

function quarter(iso: string | null): string {
  return iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" }) : "N/A";
}

export type PeerRows = Record<string, PeerSummary | "error" | undefined>;

// Loads each peer on its own, so a slow one never holds up the others.
// Shared by the peers table and the analysis (peer P/E comparison).
export function usePeers(peers: string[]): PeerRows {
  const [rows, setRows] = useState<PeerRows>({});
  const key = peers.join(",");
  useEffect(() => {
    let cancelled = false;
    setRows({});
    for (const p of key ? key.split(",") : []) {
      fetchPeer(p)
        .then((r) => !cancelled && setRows((s) => ({ ...s, [p]: r })))
        .catch(() => !cancelled && setRows((s) => ({ ...s, [p]: "error" })));
    }
    return () => {
      cancelled = true;
    };
  }, [key]);
  return rows;
}

// The company next to its peers on eight ratios.
export default function PeersPanel({ self, peers, rows }: { self: PeerSummary; peers: string[]; rows: PeerRows }) {
  if (peers.length === 0) return null;
  const all: (PeerSummary | { symbol: string; state: "loading" | "error" })[] = [
    self,
    ...peers.map((p) => {
      const r = rows[p];
      return r === undefined ? { symbol: p, state: "loading" as const } : r === "error" ? { symbol: p, state: "error" as const } : r;
    }),
  ];

  return (
    <section className="glass panel reveal peers" aria-labelledby="peers-title">
      <h2 className="panel-title" id="peers-title">
        Compared with peers
      </h2>
      <div className="table-wrap">
        <table className="data-table peers-table">
          <thead>
            <tr>
              <th>Company</th>
              {COLS.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
              <th>Latest quarter</th>
            </tr>
          </thead>
          <tbody>
            {all.map((r, i) =>
              "state" in r ? (
                <tr key={r.symbol}>
                  <td>{r.symbol.replace(/\.(NS|BO)$/, "")}</td>
                  <td colSpan={COLS.length + 1} className="cell-na">
                    {r.state === "loading" ? "Loading..." : "Not available right now"}
                  </td>
                </tr>
              ) : (
                <tr key={r.symbol} className={i === 0 ? "peers-self" : ""}>
                  <td>
                    {r.name.replace(/\s+(Limited|Ltd\.?)$/i, "")}
                    {i === 0 && <span className="visually-hidden"> (this company)</span>}
                  </td>
                  {COLS.map((c) => (
                    <td key={c.key}>{cell(r[c.key], c.unit)}</td>
                  ))}
                  <td>
                    {quarter(r.latest_quarter)}
                    {r.reported_latest_quarter && <span className="chip chip-static peers-reported">Reported</span>}
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
      <p className="footnote">
        Latest fiscal year from Yahoo Finance; P/E and EV/EBITDA use share prices at least 30 days old. "Reported" means
        Yahoo already has the quarter that ended most recently
        {self.fundamentals_as_of ? ` (checked ${formatDay(self.fundamentals_as_of, true)})` : ""}; Yahoo can lag a filing
        by a few days.
      </p>
    </section>
  );
}

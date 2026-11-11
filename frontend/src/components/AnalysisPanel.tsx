import type { Analysis, AnalysisLine } from "../lib/types";
import type { PeerRows } from "./PeersPanel";
import { formatDay } from "../lib/leagueFormat";
import TileGrid from "./TileGrid";

const PEER_MIN = 2;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// V2 (approved template): needs a positive P/E here and 2+ peers with one.
// Built on the page because the peers load separately.
function peerLine(pe: number | null, rows: PeerRows): AnalysisLine | null {
  if (pe === null) return null;
  const pes = Object.values(rows).flatMap((r) =>
    r && r !== "error" && typeof r.pe_ratio === "number" && r.pe_ratio > 0 ? [r.pe_ratio] : []
  );
  if (pes.length < PEER_MIN) return null;
  const mid = Number(median(pes).toFixed(1));
  const own = Number(pe.toFixed(1));
  if (own === mid) return null;
  return {
    id: "V2",
    text:
      `That is ${own > mid ? "higher" : "lower"} than the middle of the peers shown (${mid.toFixed(1)}x). A higher ` +
      "figure can mean investors expect more growth, or that the shares cost more for each rupee of profit; this page " +
      "does not say which.",
  };
}

// The written analysis: fixed rules over the figures already on this page.
export default function AnalysisPanel({
  analysis,
  peers,
  fetchedAt,
}: {
  analysis: Analysis;
  peers: PeerRows;
  fetchedAt?: string | null;
}) {
  const v2 = peerLine(analysis.pe, peers);
  const sections = analysis.sections.map((s) =>
    s.key === "valuation" && v2 ? { ...s, sentences: [...s.sentences, v2] } : s
  );
  if (sections.length === 0 && analysis.questions.length === 0) return null;

  return (
    <section className="glass panel reveal news-panel analysis" aria-labelledby="analysis-title">
      <h2 className="panel-title" id="analysis-title">
        What the numbers show
      </h2>
      {sections.length > 0 && (
        <TileGrid className="analysis-sections" minTile={300} pairOnPhones={false}>
          {sections.map((s) => (
            <div className="analysis-section" key={s.key}>
              <h3 className="analysis-heading">{s.title}</h3>
              {s.sentences.map((l) => (
                <p className="analysis-text" key={l.id}>
                  {l.text}
                </p>
              ))}
            </div>
          ))}
        </TileGrid>
      )}
      {analysis.questions.length > 0 && (
        <div className="analysis-questions">
          <h3 className="analysis-heading">Questions to think about before forecasting</h3>
          <ul>
            {analysis.questions.map((q) => (
              <li key={q.id}>{q.text}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="footnote">
        Written by fixed rules from the figures on this page (Yahoo Finance
        {fetchedAt ? `, fetched ${formatDay(fetchedAt, true)}` : ""}), not by a person or AI. A sentence is left out when
        a figure it needs is N/A. It describes the past and is not advice.
      </p>
    </section>
  );
}

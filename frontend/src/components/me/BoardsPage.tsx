import { useEffect, useState } from "react";
import { ApiError, type Board, type BoardKind, fetchBoard } from "../../lib/api";
import { n } from "../../lib/scoring";
import type { UserPublic } from "../../lib/types";
import ErrorState from "../ErrorState";
import SiteFooter from "../SiteFooter";
import { HeroWaves } from "../league/CardArt";

// #/boards (master plan phase 6: E5, X3, SC9). Ranked by average score with a
// minimum, never by volume; handles only. Tabs approved as 2.39; the rest
// is DRAFT wording.

const TABS: { key: BoardKind; label: string }[] = [
  { key: "week", label: "This week" },
  { key: "season", label: "This season" },
  { key: "improved", label: "Most improved this week" },
];

// A1 (Stop 3): short heads that fit one line on a phone. DRAFT.
const VALUE_HEAD: Record<BoardKind, string> = { week: "Avg per card", season: "Avg score", improved: "Change" };

function statusLine(board: Board): string | null {
  switch (board.your_status) {
    case "hidden":
      return "You're hidden from leaderboards. You can change this in Settings.";
    case "consent_pending":
      return "You'll appear once a parent or guardian agrees.";
    case "no_handle":
      return "Choose a handle to appear on leaderboards.";
    case "under_review":
      return "Your handle is being checked. You'll appear once it's approved.";
    case "too_few":
      return board.board === "season"
        ? `Forecast at least ${board.minimum} companies this season to appear.`
        : `Play at least ${board.minimum} cards this week to appear.`;
    default:
      return null;
  }
}

export default function BoardsPage({ user }: { user: UserPublic | null }) {
  const [kind, setKind] = useState<BoardKind>("week");
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    setBoard(null);
    fetchBoard(kind)
      .then(setBoard)
      .catch((e) => setError(e instanceof ApiError ? e.message : "We couldn't load the leaderboard."));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [kind, user?.id]);

  const rows = board ? [...board.rows, ...(board.you ? [board.you] : [])] : [];
  const fmt = (v: number) => (kind === "improved" ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${n(Math.abs(v))}` : n(v));
  return (
    <div className="page boards-page">
      <header className="page-hero">
        <HeroWaves />
        <h1 className="hero-title">Leaderboards</h1>
        <p className="hero-lede">Ranked by average score, never by how much you play. Handles only.</p>
      </header>

      {/* Wide screens: three equal tabs. Phones: one select, so nothing wraps. */}
      <div className="segmented board-tabs" role="tablist" aria-label="Leaderboards">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={kind === t.key} className={kind === t.key ? "active" : ""} onClick={() => setKind(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <label className="filter-select board-select">
        <span>Leaderboard:</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as BoardKind)}>
          {TABS.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      {error && <ErrorState message={error} onRetry={load} />}
      {!board && !error && <div className="skeleton skeleton-panel" aria-busy="true" aria-label="Loading the leaderboard" />}
      {board && (
        <section className="glass panel" aria-label={board.title}>
          {board.season_label && <p className="section-text">Season: {board.season_label}</p>}
          {rows.length === 0 ? (
            <p className="section-text">
              {board.board === "season"
                ? `No one has forecast ${board.minimum} scored companies this season yet.`
                : `No one has played ${board.minimum} cards this week yet.`}
            </p>
          ) : (
            <div className="table-wrap">
              <table className="data-table board-table">
                <thead>
                  <tr>
                    <th scope="col">Rank</th>
                    <th scope="col">Handle</th>
                    <th scope="col">{VALUE_HEAD[kind]}</th>
                    <th scope="col" className="board-count">
                      {kind === "season" ? "Companies" : "Cards"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.rank}-${r.handle}`} className={r.you ? "is-you" : ""}>
                      <td>{r.rank}</td>
                      <th scope="row">
                        {r.handle}
                        {r.you && <span className="board-you"> (you)</span>}
                      </th>
                      <td>{fmt(r.value)}</td>
                      <td className="board-count">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {statusLine(board) && <p className="section-text">{statusLine(board)}</p>}
          {!user && <p className="section-text">Sign in to see where you stand.</p>}
        </section>
      )}
      <SiteFooter />
    </div>
  );
}

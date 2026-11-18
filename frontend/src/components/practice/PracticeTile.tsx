import type { PracticeCard } from "../../lib/types";
import { colourClass, DIFFICULTY_LABEL } from "../../lib/difficulty";
import { MYSTERY_NAME } from "../../lib/practice";
import { Grain, Guilloche } from "../league/CardArt";
import DifficultyEdge from "../DifficultyEdge";
import { n } from "../league/ResultsPage";

// One practice company, styled like Home's tiles (wording approved
// 2026-11-18): the difficulty colour, the sector, the name or "Mystery
// company", one line about it, and your first-try score once you have one.
// `badge`: the "Practice" badge, on Home only (2026-11-18: not needed on the
// Practice page itself).
export default function PracticeTile({ card, index = 0, badge = false }: { card: PracticeCard; index?: number; badge?: boolean }) {
  const level = card.difficulty;
  return (
    <li data-scrub="tile" data-i={index}>
      <a className={`sector-tile practice-tile ${colourClass(level)} ${level ? "has-edge" : ""}`} href={`#/practice/${card.code}`}>
        <span className="tile-material" aria-hidden="true">
          <Guilloche />
          <Grain />
        </span>
        <DifficultyEdge label={level ? DIFFICULTY_LABEL[level] : null} />
        <span className="tile-sector">
          {card.sector_name}
          {badge && <span className="practice-badge">Practice</span>}
        </span>
        <h3 className="tile-name">{card.name ?? MYSTERY_NAME}</h3>
        <span className="tile-when">{card.season_label ?? ""}</span>
        <p className="practice-tile-line">{card.mystery_line ?? card.description}</p>
        <span className="tile-foot">
          <span className="practice-tile-score">
            {card.first_score !== null ? `First try: ${n(card.first_score)} points` : ""}
          </span>
          <span className="btn btn-dark btn-arrow">
            Forecast
            <span className="btn-arrow-icon" aria-hidden="true" />
          </span>
        </span>
      </a>
    </li>
  );
}

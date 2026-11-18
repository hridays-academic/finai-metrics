import { BallSkin } from "../FreeBall";

// The guide's pinned object (2026-11-18, Hriday: a separate, scripted ball,
// same skin, never loose, no ballStore). It draws exactly what the step in
// focus shows (GuidePage's objectView), including a range being dragged or a
// button pressed in that step's card. Track, range, ball and marks only:
// scores stay in the cards. Decorative: everything it shows is also in the
// step cards.

// A 0-20% scale across the track, with a little room at each end.
const MIN = 0;
const MAX = 20;
const x = (v: number) => `${6 + ((v - MIN) / (MAX - MIN)) * 88}%`;

// Step 1's four quarters, evenly along the track.
const QUARTER_AT = ["15%", "38%", "62%", "85%"];

export const CHIPS = [
  { long: "Revenue growth", short: "Revenue" },
  { long: "Margin", short: "Margin" },
  { long: "Sector number", short: "Sector" },
];

export interface ObjectView {
  // Step 1: which quarter glows as results day (null: no quarters).
  quarter: number | null;
  // Step 2: the three chips, and whether the sector chip is lit.
  chips: boolean;
  sectorLit: boolean;
  ticks: boolean;
  range: [number, number] | null;
  dots: number[];
  ball: number | null;
  lazy: number | null;
}

export default function GuideObject({ view, step }: { view: ObjectView; step: number }) {
  const range = view.range ?? [10, 14];
  const ball = view.ball ?? 12;
  const below = view.range !== null && ball < range[0];
  const above = view.range !== null && ball > range[1];
  const missed = view.ball !== null && (below || above);
  // A missed ball rests on the track clear of the gold range, however small
  // the miss, so it never looks as if it landed on the range.
  const ballLeft = below
    ? `min(${x(ball)}, calc(${x(range[0])} - var(--ball) / 2 - 6px))`
    : above
      ? `max(${x(ball)}, calc(${x(range[1])} + var(--ball) / 2 + 6px))`
      : x(ball);
  return (
    <div className={`guide-object ${missed ? "has-gap" : ""}`} aria-hidden="true" data-step={step}>
      <div className="guide-scene">
        <span className={`guide-chips-row ${view.chips ? "is-on" : ""}`}>
          {CHIPS.map((c, i) => (
            <span key={c.long} className={`guide-object-chip ${i === 2 && view.sectorLit ? "is-lit" : ""}`}>
              <span className="chip-long">{c.long}</span>
              <span className="chip-short">{c.short}</span>
            </span>
          ))}
        </span>
        <span className="guide-track" />
        <span className={`guide-quarters ${view.quarter !== null ? "is-on" : ""}`}>
          {QUARTER_AT.map((left, i) => (
            <span key={i} className={`guide-quarter ${view.quarter === i ? "is-lit" : ""}`} style={{ left }}>
              {view.quarter === i && <span className="guide-quarter-day">Results day</span>}
              <span className="guide-quarter-label">Q{i + 1}</span>
            </span>
          ))}
        </span>
        <span
          className={`guide-range ${view.range ? "is-on" : ""}`}
          style={{ left: x(range[0]), width: `calc(${x(range[1])} - ${x(range[0])})` }}
        />
        {view.dots.map((d, i) => (
          <span
            key={i}
            className={`guide-object-dot ${d >= range[0] && d <= range[1] ? "is-caught" : ""}`}
            style={{ left: x(d) }}
          />
        ))}
        <span className={`guide-lazy ${view.lazy !== null ? "is-on" : ""}`} style={{ left: x(view.lazy ?? 9) }}>
          <span className="guide-lazy-label">Lazy guess</span>
        </span>
        {/* The gap between the ball and the range, and what it costs. */}
        <span
          className={`guide-gap ${missed ? "is-on" : ""} ${above ? "is-above" : "is-below"}`}
          style={
            above
              ? { left: x(range[1]), right: `calc(100% - ${ballLeft})` }
              : { left: ballLeft, right: `calc(100% - ${x(range[0])})` }
          }
        >
          <span className="guide-gap-label">−20 per point</span>
        </span>
        <span
          className={`guide-ball ${view.ball !== null ? "is-on" : ""} ${missed || !view.range ? "on-track" : "on-range"}`}
          style={{ left: ballLeft, ["--spin" as string]: `${ball * 36}deg` }}
        >
          <span className="ball-skin guide-ball-skin">
            <BallSkin />
          </span>
        </span>
        <span className={`guide-ticks ${view.ticks ? "is-on" : ""}`}>
          {[0, 5, 10, 15, 20].map((v) => (
            <span key={v} className="guide-tick" style={{ left: x(v) }}>
              {v}%
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

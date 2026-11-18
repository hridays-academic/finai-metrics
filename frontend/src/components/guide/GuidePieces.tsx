import { useEffect, useState } from "react";
import { fetchLeagueConfig, fetchLeagueEvents } from "../../lib/api";
import { explain, n, scoreMetric } from "../../lib/scoring";
import type { LeagueConfig } from "../../lib/types";
import { BallSkin } from "../FreeBall";

// The guide's small interactive pieces (wording approved 2026-11-18, vault:
// Areas/First-visit guide and Practice). Every number is a made-up example,
// and every score sentence comes from lib/scoring.ts, which mirrors the
// server's approved sentences word for word.

// ---------- A two-handled range on a 0-20% scale ----------

const MIN = 0;
const MAX = 20;
const STEP = 0.5;
const pos = (v: number) => `${((v - MIN) / (MAX - MIN)) * 100}%`;

interface RangeSliderProps {
  low: number;
  high: number;
  onChange: (low: number, high: number) => void;
  dots?: number[];
  ball?: number;
  lazy?: number;
}

export function RangeSlider({ low, high, onChange, dots = [], ball, lazy }: RangeSliderProps) {
  return (
    <div className="guide-slider">
      <div className="guide-slider-bar">
        <span className="guide-slider-track" />
        <span className="guide-slider-fill" style={{ left: pos(low), width: `calc(${pos(high)} - ${pos(low)})` }} />
        {dots.map((d, i) => (
          <span key={i} className={`guide-dot ${d >= low && d <= high ? "is-caught" : ""}`} style={{ left: pos(d) }} />
        ))}
        {lazy !== undefined && (
          <span className="guide-slider-lazy" style={{ left: pos(lazy) }}>
            <span>{n(lazy)}%</span>
          </span>
        )}
        {ball !== undefined && (
          <span className="guide-slider-ball" style={{ left: pos(ball) }}>
            <span className="ball-skin">
              <BallSkin />
            </span>
            <span className="guide-slider-ball-label">{n(ball)}%</span>
          </span>
        )}
        <input
          type="range"
          aria-label="Low"
          min={MIN}
          max={MAX}
          step={STEP}
          value={low}
          aria-valuetext={`${n(low)}%`}
          onChange={(e) => onChange(Math.min(Number(e.target.value), high), high)}
        />
        <input
          type="range"
          aria-label="High"
          min={MIN}
          max={MAX}
          step={STEP}
          value={high}
          aria-valuetext={`${n(high)}%`}
          onChange={(e) => onChange(low, Math.max(Number(e.target.value), low))}
        />
      </div>
      <div className="guide-slider-scale" aria-hidden="true">
        <span>{MIN}%</span>
        <span>{MAX}%</span>
      </div>
      <p className="guide-slider-value">
        {n(low)}% to {n(high)}%
      </p>
    </div>
  );
}

// ---------- Step 1: when results come out ----------

const QUARTERS = [
  { q: "Q1", text: "Apr to Jun, out by mid August." },
  { q: "Q2", text: "Jul to Sep, out by mid November." },
  { q: "Q3", text: "Oct to Dec, out by mid February." },
  { q: "Q4", text: "Jan to Mar, out by the end of May." },
];

interface PickProps {
  picked: number | null;
  setPicked: (i: number) => void;
}

export function QuarterPicker({ picked, setPicked }: PickProps) {
  return (
    <div className="guide-try">
      <p className="guide-try-prompt">Tap a quarter to see when its results come out.</p>
      <div className="segmented" role="group" aria-label="Quarters">
        {QUARTERS.map((item, i) => (
          <button
            key={item.q}
            type="button"
            className={picked === i ? "active" : ""}
            aria-pressed={picked === i}
            onClick={() => setPicked(i)}
          >
            {item.q}
          </button>
        ))}
      </div>
      <p className="guide-try-result" aria-live="polite">
        {picked !== null && (
          <>
            <strong>{QUARTERS[picked].q}</strong> {QUARTERS[picked].text}
          </>
        )}
      </p>
    </div>
  );
}

// ---------- Step 2: each sector's number ----------

// Plain lines approved by Hriday 2026-11-18 (vault: Areas/First-visit guide
// and Practice). The sector button already names the sector, so the card
// shows only the line. A sector without one falls back to its league
// definition.
export const SECTOR_LINES: Record<string, string> = {
  cement: "How many more tonnes of cement it sold than in the same three months last year.",
  autos: "How many more vehicles it sold, in India and abroad, than in the same three months last year.",
  fmcg: "How much more product it sold in India than in the same three months last year, leaving out price rises.",
  it: "How much more money it made than in the same three months last year, as if exchange rates hadn't changed.",
};

export function SectorPicker({ picked, setPicked }: PickProps) {
  const [config, setConfig] = useState<LeagueConfig | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchLeagueConfig()
      .then((c) => !cancelled && setConfig(c))
      .catch(() => !cancelled && setConfig(null));
    return () => {
      cancelled = true;
    };
  }, []);
  if (!config || config.kpi_templates.length === 0) return null;
  const name = (sector: string) => config.sector_explainers.find((e) => e.sector === sector)?.display_name ?? sector;
  const current = picked === null ? null : config.kpi_templates[Math.min(picked, config.kpi_templates.length - 1)];
  return (
    <div className="guide-try">
      <p className="guide-try-prompt">Pick a sector to see its number.</p>
      <div className="guide-chips" role="group" aria-label="Sectors">
        {config.kpi_templates.map((t, i) => (
          <button
            key={t.sector}
            type="button"
            className={`chip ${i === picked ? "active" : ""}`}
            aria-pressed={i === picked}
            onClick={() => setPicked(i)}
          >
            {name(t.sector)}
          </button>
        ))}
      </div>
      <p className="guide-try-result" aria-live="polite">
        {current &&
          (SECTOR_LINES[current.sector] ?? (
            <>
              <strong>{current.metric.label}:</strong> {current.metric.definition}
            </>
          ))}
      </p>
    </div>
  );
}

// ---------- Steps 3 to 5: ranges the pinned object follows live ----------

export type Range = [number, number];

interface RangePieceProps {
  value: Range;
  onChange: (value: Range) => void;
}

// Made-up results, just for this example (the card says so).
export const DOTS = [5.5, 8, 9, 10, 10.5, 11.5, 12, 13, 14.5, 17.5];
export const RESULT = 12;
export const LAZY = 9;

// Where each step's range starts (step index: 2, 3 and 4).
export const START_RANGES: Record<number, Range> = { 2: [9.5, 13.5], 3: [10, 14], 4: [10, 14] };

export function RangeCatch({ value: [low, high], onChange }: RangePieceProps) {
  const caught = DOTS.filter((d) => d >= low && d <= high).length;
  return (
    <div className="guide-try">
      <p className="guide-try-prompt">Drag the ends. These ten dots are made-up results, just for this example.</p>
      <RangeSlider low={low} high={high} onChange={(l, h) => onChange([l, h])} dots={DOTS} />
      <p className="guide-try-result" aria-live="polite">
        Your range catches {caught} of these 10.
      </p>
    </div>
  );
}

export function ScoreDemo({ value: [low, high], onChange }: RangePieceProps) {
  const score = scoreMetric(low, high, RESULT, null);
  return (
    <div className="guide-try">
      <p className="guide-try-prompt">Drag your range. The result here is 12%.</p>
      <RangeSlider low={low} high={high} onChange={(l, h) => onChange([l, h])} ball={RESULT} />
      <p className="guide-try-score">
        <span className="guide-try-points">{n(score.base)}</span> points
      </p>
      <p className="guide-try-result" aria-live="polite">
        {explain(low, high, RESULT, null)[0]}
      </p>
    </div>
  );
}

export function LazyDemo({ value: [low, high], onChange }: RangePieceProps) {
  const score = scoreMetric(low, high, RESULT, LAZY);
  const [pointsLine, bonusLine] = explain(low, high, RESULT, LAZY);
  return (
    <div className="guide-try">
      <p className="guide-try-prompt">Move your range. The lazy guess is 9%.</p>
      <RangeSlider low={low} high={high} onChange={(l, h) => onChange([l, h])} ball={RESULT} lazy={LAZY} />
      <p className="guide-try-score">
        <span className="guide-try-points">{n(score.points)}</span> points
      </p>
      <div aria-live="polite">
        <p className="guide-try-result">{pointsLine}</p>
        <p className="guide-try-result">{bonusLine}</p>
      </div>
    </div>
  );
}

// ---------- Step 6: try one ----------

export function TryOne() {
  const [anyOpen, setAnyOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchLeagueEvents("upcoming")
      .then((events) => !cancelled && setAnyOpen(events.some((e) => e.status === "open")))
      .catch(() => !cancelled && setAnyOpen(false));
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <div className="guide-try guide-try-actions">
      <a className="btn btn-primary" href="#/practice?surprise=1">
        Surprise me
      </a>
      <a className="btn btn-secondary" href="#/practice">
        Pick a company
      </a>
      {anyOpen && (
        <a className="btn btn-secondary" href="#/league">
          Forecast a real company
        </a>
      )}
    </div>
  );
}

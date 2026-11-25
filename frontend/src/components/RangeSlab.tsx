import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import { ALPHA, K, n, widthCost } from "../lib/scoring";
import { BallSkin } from "./FreeBall";

// The range control (master plan phase 4, F1-F7, F11, A5): Home's slab with
// the gold range, used by the league form and practice. Wording approved
// 2026-11-24 (decisions 2.21-2.24; 2.21 changed by Hriday: no starting range).
//
// - It starts empty. One drag along the bar sets both ends; then each end, or
//   the middle, can be dragged.
// - Last year (the lazy guess) and, where it means something, last quarter
//   are marked on the bar.
// - The numbers above the bar can be tapped and typed (inputmode decimal).
// - Keyboard: each end is a slider; arrows move 0.1, Shift+arrows 1.
// - Under it: what the range would score if the result lands inside, and a
//   nudge when it is very narrow or very wide.

export type Pair = [number, number];

interface RangeSlabProps {
  label: string; // the metric, e.g. "Revenue growth (YoY)"
  unit: string;
  domain: Pair; // the scale (from scaleAround: last year ± 8 or 10)
  value: Pair | null;
  onChange: (next: Pair) => void;
  lastYear?: number | null;
  lastQuarter?: number | null;
  disabled?: boolean;
  step?: number;
  // Quick rounds: the actual result, shown as Home's ball dropping onto the slab.
  result?: number | null;
}

const NARROW = 1; // points of width
const WIDE = 12;
const HIT = 22; // px either side of an end that grabs it

const round1 = (v: number) => Math.round(v * 10) / 10;

export default function RangeSlab({ label, unit, domain, value, onChange, lastYear = null, lastQuarter = null, disabled = false, step = 0.1, result = null }: RangeSlabProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: "draw" | "low" | "high" | "body"; anchor: number; start: Pair | null; startX: number } | null>(null);
  const [lo, hi] = widen(domain, value, lastYear, lastQuarter, result);
  const span = hi - lo || 1;
  const frac = (v: number) => Math.min(1, Math.max(0, (v - lo) / span));
  const pct = (v: number) => `${frac(v) * 100}%`;
  const clamp = (v: number) => Math.min(hi, Math.max(lo, v));
  const at = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return lo;
    return clamp(round1(lo + ((clientX - r.left) / r.width) * span));
  };
  const set = (a: number, b: number) => onChange([round1(Math.min(a, b)), round1(Math.max(a, b))]);

  function down(e: PointerEvent<HTMLDivElement>) {
    if (disabled || e.button !== 0) return;
    const r = trackRef.current?.getBoundingClientRect();
    if (!r) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const v = at(e.clientX);
    if (value) {
      const xLow = r.left + frac(value[0]) * r.width;
      const xHigh = r.left + frac(value[1]) * r.width;
      const dLow = Math.abs(e.clientX - xLow);
      const dHigh = Math.abs(e.clientX - xHigh);
      if (Math.min(dLow, dHigh) <= HIT) {
        drag.current = { mode: dLow <= dHigh ? "low" : "high", anchor: v, start: value, startX: e.clientX };
        return;
      }
      if (e.clientX > xLow && e.clientX < xHigh) {
        drag.current = { mode: "body", anchor: v, start: value, startX: e.clientX };
        return;
      }
    }
    // One drag sets both ends.
    drag.current = { mode: "draw", anchor: v, start: null, startX: e.clientX };
    set(v, v);
  }

  function move(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const v = at(e.clientX);
    if (d.mode === "draw") set(d.anchor, v);
    else if (d.mode === "low" && d.start) set(Math.min(v, d.start[1]), d.start[1]);
    else if (d.mode === "high" && d.start) set(d.start[0], Math.max(v, d.start[0]));
    else if (d.mode === "body" && d.start) {
      const shift = v - d.anchor;
      const w = d.start[1] - d.start[0];
      const a = Math.min(hi - w, Math.max(lo, d.start[0] + shift));
      set(a, a + w);
    }
  }

  function up() {
    drag.current = null;
  }

  function keys(end: "low" | "high") {
    return (e: KeyboardEvent<HTMLElement>) => {
      if (disabled) return;
      const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      const delta = dir * (e.shiftKey ? 1 : step);
      // From empty, the keyboard starts at last year (or the middle).
      const base: Pair = value ?? [lastYear ?? (lo + hi) / 2, lastYear ?? (lo + hi) / 2];
      if (end === "low") set(Math.min(base[0] + delta, base[1]), base[1]);
      else set(base[0], Math.max(base[1] + delta, base[0]));
    };
  }

  const width = value ? value[1] - value[0] : null;
  const insidePoints = width === null ? null : Math.max(0, 100 - widthCost(value![0], value![1]));
  const missPerPoint = (K * 2) / ALPHA;
  const ticks = niceTicks(lo, hi);

  return (
    <div className={`range-slab ${disabled ? "is-disabled" : ""}`}>
      <div className="range-slab-numbers">
        <EditableNumber side="Low" value={value?.[0] ?? null} unit={unit} disabled={disabled} onCommit={(v) => set(v, value ? value[1] : v)} />
        <span className="range-slab-to" aria-hidden="true">
          to
        </span>
        <EditableNumber side="High" value={value?.[1] ?? null} unit={unit} disabled={disabled} onCommit={(v) => set(value ? value[0] : v, v)} />
      </div>

      <div className="range-slab-track-wrap">
        <div
          className="range-slab-track"
          ref={trackRef}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        >
          <span className="slab range-slab-slab" aria-hidden="true" />
          {lastYear !== null && <Mark at={pct(lastYear)} text={`Last year ${n(lastYear)}${unit}`} kind="lazy" />}
          {lastQuarter !== null && <Mark at={pct(lastQuarter)} text={`Last quarter ${n(lastQuarter)}${unit}`} kind="quarter" />}
          {value && (
            <>
              <span
                className="slab-range range-slab-range"
                style={{ left: `calc(${pct(value[0])} - 12px)`, width: `calc(${pct(value[1])} - ${pct(value[0])} + 24px)` }}
                aria-hidden="true"
              />
              {(["low", "high"] as const).map((end) => (
                <span
                  key={end}
                  className="range-slab-knob"
                  style={{ left: pct(end === "low" ? value[0] : value[1]) }}
                  role="slider"
                  tabIndex={disabled ? -1 : 0}
                  aria-label={`${label} ${end}`}
                  aria-valuemin={lo}
                  aria-valuemax={hi}
                  aria-valuenow={end === "low" ? value[0] : value[1]}
                  aria-valuetext={`${n(end === "low" ? value[0] : value[1])}${unit}`}
                  onKeyDown={keys(end)}
                />
              ))}
            </>
          )}
          {result !== null && (
            <span className="range-slab-ball" style={{ left: pct(result) }} aria-hidden="true">
              <span className="ball-skin">
                <BallSkin />
              </span>
            </span>
          )}
          {!value && (
            // Keyboard users start from here: arrows set a range at last year.
            <span
              className="range-slab-empty"
              role="slider"
              tabIndex={disabled ? -1 : 0}
              aria-label={`${label}: set a range`}
              aria-valuemin={lo}
              aria-valuemax={hi}
              aria-valuetext="No range yet"
              onKeyDown={keys("high")}
            />
          )}
        </div>
        <div className="range-slab-scale" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} style={{ left: pct(t) }}>
              {n(t)}
              {unit}
            </span>
          ))}
        </div>
      </div>

      <p className="range-slab-line" aria-live="polite">
        {value === null
          ? "Drag along the bar to set your low and high. Last year is marked."
          : `If the result lands inside: ${n(insidePoints!)} points. Each point it misses by: −${n(missPerPoint)}.`}
      </p>
      {width !== null && width < NARROW && (
        <p className="range-slab-nudge">This is narrow. Would a result just outside it surprise you? If not, widen it.</p>
      )}
      {width !== null && width > WIDE && (
        <p className="range-slab-nudge">This is wide. Its width costs {n(widthCost(value![0], value![1]))} points. Can you narrow it?</p>
      )}
    </div>
  );
}

// The scale always holds the domain, the range and the marks.
export function widen(domain: Pair, value: Pair | null, ...marks: (number | null)[]): Pair {
  const vals = [domain[0], domain[1], ...(value ?? []), ...marks.filter((m): m is number => m !== null)];
  return [Math.floor(Math.min(...vals)), Math.ceil(Math.max(...vals))];
}

export function niceTicks(lo: number, hi: number): number[] {
  const span = hi - lo;
  const step = span <= 10 ? 2 : span <= 25 ? 5 : span <= 60 ? 10 : 20;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(Math.round(t * 10) / 10);
  return out;
}

function Mark({ at, text, kind }: { at: string; text: string; kind: "lazy" | "quarter" }) {
  return (
    <span className={`range-slab-mark is-${kind}`} style={{ left: at }}>
      <span className="range-slab-mark-label">{text}</span>
    </span>
  );
}

function EditableNumber({ side, value, unit, disabled, onCommit }: {
  side: "Low" | "High";
  value: number | null;
  unit: string;
  disabled: boolean;
  onCommit: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);
  const commit = () => {
    const v = Number(text.replace(/[^0-9.\-−]/g, "").replace("−", "-"));
    if (text.trim() !== "" && Number.isFinite(v)) onCommit(round1(v));
    setEditing(false);
  };
  if (editing) {
    return (
      <label className="range-slab-number is-editing">
        <span className="range-slab-number-side">{side}</span>
        <input
          ref={inputRef}
          className="input"
          type="text"
          inputMode="decimal"
          aria-label={`${side} (type a number)`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") setEditing(false);
          }}
        />
        <span className="range-slab-number-unit">{unit}</span>
      </label>
    );
  }
  return (
    <button
      type="button"
      className="range-slab-number"
      disabled={disabled}
      aria-label={`${side}: ${value === null ? "not set" : `${n(value)}${unit}`}. Tap to type a number.`}
      onClick={() => {
        setText(value === null ? "" : String(value));
        setEditing(true);
      }}
    >
      <span className="range-slab-number-side">{side}</span>
      <span className="range-slab-number-value">{value === null ? "Not set" : `${n(value)}${unit}`}</span>
    </button>
  );
}

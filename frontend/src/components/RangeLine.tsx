import { useId, useLayoutEffect, useRef, useState } from "react";

// The range bar (2026-11-15, v3): a recessed dark track, the student's range
// as a raised gold capsule, the actual result as a glossy white dot, and last
// year / the crowd as small ticks. Used on the forecast form, the results
// page, the worksheet and Home's recent results.

export interface RangeMark {
  key: string;
  value: number;
  // Short text above the tick, e.g. "actual 13%". Omit for no label.
  label?: string;
  kind: "actual" | "ref"; // ref = last year, crowd: small grey ticks
}

interface RangeLineProps {
  low: number | null;
  high: number | null;
  marks?: RangeMark[];
  // The scale never gets narrower than this many units, so a narrow range
  // reads as narrow instead of filling the whole line.
  minSpan?: number;
  compact?: boolean;
  // With a label the line is an image for screen readers; without one it is
  // decorative (the same figures are in the text next to it).
  ariaLabel?: string;
}

const NICE = [1, 2, 2.5, 5, 10];


export function niceStep(span: number, targetTicks: number): number {
  const raw = span / Math.max(targetTicks, 1);
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = NICE.find((n) => n * mag >= raw) ?? 10;
  return step * mag;
}

// The visible scale: every value plus some room, at least `minSpan` wide,
// widened to whole ticks.
export function lineScale(values: number[], minSpan: number, targetTicks: number) {
  const vals = values.filter((v) => Number.isFinite(v));
  let min = vals.length ? Math.min(...vals) : 0;
  let max = vals.length ? Math.max(...vals) : 1;
  const pad = Math.max((max - min) * 0.15, 0.5);
  min -= pad;
  max += pad;
  if (max - min < minSpan) {
    const mid = (min + max) / 2;
    min = mid - minSpan / 2;
    max = mid + minSpan / 2;
  }
  const step = niceStep(max - min, targetTicks);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 1000; t += step) ticks.push(Number(t.toFixed(6)));
  return { lo, hi, step, ticks };
}

function tickText(v: number, step: number): string {
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const text = v.toFixed(digits);
  return text === "-0" ? "0" : text;
}

const CHAR_PX = 7;
const LANE = 18;

// Labels sit in rows above the line; each takes the first row where it
// doesn't touch the previous one, so close values stack instead of overlapping.
function placeLabels(marks: RangeMark[], x: (v: number) => number, width: number) {
  const lanesEnd: number[] = [];
  return marks
    .filter((m) => m.label)
    .sort((a, b) => a.value - b.value)
    .map((m) => {
      const w = (m.label as string).length * CHAR_PX + 6;
      const left = Math.min(Math.max(0, x(m.value) - w / 2), Math.max(0, width - w));
      let lane = lanesEnd.findIndex((end) => left >= end + 4);
      if (lane === -1) {
        lane = lanesEnd.length;
        lanesEnd.push(0);
      }
      lanesEnd[lane] = left + w;
      return { ...m, left, lane };
    });
}

export default function RangeLine({
  low,
  high,
  marks = [],
  minSpan = 2,
  compact = false,
  ariaLabel,
}: RangeLineProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const uid = useId().replace(/:/g, "");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth || 320);
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const hasRange = low !== null && high !== null && Number.isFinite(low) && Number.isFinite(high) && low <= high;
  const values = [...(hasRange ? [low as number, high as number] : []), ...marks.map((m) => m.value)];
  const inset = 10; // room for the dot and the edge numbers
  const usable = Math.max(width - inset * 2, 1);
  const { lo, hi, step, ticks } = lineScale(values, minSpan, compact ? 3 : Math.max(3, Math.round(usable / 70)));
  const x = (v: number) => inset + ((v - lo) / (hi - lo || 1)) * usable;

  const placed = placeLabels(marks, x, width);
  const lanes = placed.length ? Math.max(...placed.map((p) => p.lane)) + 1 : 0;
  const top = lanes * LANE + (lanes ? 4 : 0);
  const track = compact ? 8 : 10;
  const cy = top + (compact ? 9 : 11);
  const height = cy + (compact ? 22 : 28);
  const dot = compact ? 6 : 8;

  return (
    <div
      className={`range-line ${compact ? "range-line-compact" : ""}`}
      ref={ref}
      {...(ariaLabel ? { role: "img", "aria-label": ariaLabel } : { "aria-hidden": true })}
    >
      {width > 0 && (
        <>
          <svg width={width} height={height} className="range-line-svg" focusable="false">
            <defs>
              <linearGradient id={`g${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#ffe08f" />
                <stop offset="0.5" stopColor="#f2c14e" />
                <stop offset="1" stopColor="#c8952a" />
              </linearGradient>
              <radialGradient id={`w${uid}`} cx="0.35" cy="0.3" r="0.75">
                <stop offset="0" stopColor="#ffffff" />
                <stop offset="0.55" stopColor="#e9ecf1" />
                <stop offset="1" stopColor="#9aa1ad" />
              </radialGradient>
            </defs>
            <rect x={inset} y={cy - track / 2} width={usable} height={track} rx={track / 2} className="rl-track" />
            <line x1={inset + track / 2} x2={width - inset - track / 2} y1={cy + track / 2 - 0.5} y2={cy + track / 2 - 0.5} className="rl-track-edge" />
            {ticks.map((t) => (
              <text key={t} x={x(t)} y={cy + (compact ? 19 : 24)} className="rl-tick-text" textAnchor="middle">
                {tickText(t, step)}
              </text>
            ))}
            {hasRange && (
              <rect
                x={x(low as number) - track / 2}
                y={cy - track / 2}
                width={Math.max(x(high as number) - x(low as number), 0) + track}
                height={track}
                rx={track / 2}
                fill={`url(#g${uid})`}
                className="rl-range"
              />
            )}
            {marks
              .filter((m) => m.kind === "ref")
              .map((m) => (
                <line key={m.key} x1={x(m.value)} x2={x(m.value)} y1={cy - track} y2={cy + track} className="rl-ref" />
              ))}
            {marks
              .filter((m) => m.kind === "actual")
              .map((m) => (
                <circle key={m.key} cx={x(m.value)} cy={cy} r={dot} fill={`url(#w${uid})`} className="rl-actual" />
              ))}
          </svg>
          {placed.map((p) => (
            <span
              key={p.key}
              className={`rl-label ${p.kind === "actual" ? "rl-label-actual" : ""}`}
              style={{ left: p.left, top: p.lane * LANE }}
            >
              {p.label}
            </span>
          ))}
        </>
      )}
    </div>
  );
}

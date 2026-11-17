import { useId } from "react";

// Artwork for the 3D company card (2026-11-16): engraved guilloche lines, a
// fine grain and a small revenue line. All inline
// SVG, drawn in the card's own colours (--sector-light / --sector-dark), so
// nothing is downloaded. The paths are computed once at module load.

const W = 480;
const H = 302;

function wavePath(k: number): string {
  const pts: string[] = [];
  for (let x = -10; x <= W + 10; x += 6) {
    const y = 4 + k * 10 + 16 * Math.sin(x / 41 + k * 0.33) + 7 * Math.sin(x / 13.5 + k * 0.9);
    pts.push(`${x},${y.toFixed(1)}`);
  }
  return `M${pts.join("L")}`;
}

const WAVES = Array.from({ length: 30 }, (_, k) => wavePath(k));

export function Guilloche() {
  return (
    <svg className="card3d-guilloche" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g fill="none" strokeWidth="0.8">
        {WAVES.map((d, k) => (
          <path key={k} d={d} stroke={k % 2 ? "var(--sector-light)" : "var(--sector-dark)"} />
        ))}
      </g>
    </svg>
  );
}

// Fine grain: turbulence turned into sparse dark specks.
export function Grain() {
  const id = `grain${useId().replace(/:/g, "")}`;
  return (
    <svg className="card3d-grain" aria-hidden="true">
      <filter id={id} x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.95" numOctaves="2" stitchTiles="stitch" />
        <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1.6 -0.55" />
      </filter>
      <rect width="100%" height="100%" filter={`url(#${id})`} />
    </svg>
  );
}

// The last eight quarters' revenue as a small line; gaps where a quarter is missing.
export function CardSpark({ values }: { values: (number | null)[] }) {
  const known = values.filter((v): v is number => v !== null);
  if (known.length < 2) return null;
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  const span = hi - lo || 1;
  const w = 120;
  const h = 40;
  const step = w / Math.max(1, values.length - 1);
  const parts: string[] = [];
  let open = false;
  values.forEach((v, i) => {
    if (v === null) {
      open = false;
      return;
    }
    const x = (i * step).toFixed(1);
    const y = (h - 3 - ((v - lo) / span) * (h - 6)).toFixed(1);
    parts.push(`${open ? "L" : "M"}${x},${y}`);
    open = true;
  });
  return (
    <svg className="card3d-spark-line" viewBox={`-2 0 ${w + 4} ${h}`} aria-hidden="true">
      <path d={parts.join("")} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

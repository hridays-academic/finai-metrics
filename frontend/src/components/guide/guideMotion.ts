// The guide's page stack (2026-11-19, Hriday; motion copied from the
// services pages of kigo.studio, measured in Playwright: the incoming page
// is tilted about -7deg as it enters, eases to 0 as its top reaches the top,
// pivoting at its horizontal centre, 90% of the way down). Pure, so it is
// tested. Everything is scrubbed by scroll position, never timed.

export const TILT_DEG = -7;
export const COVER_SCALE = 0.96;
export const COVER_DIM = 0.35;

const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// How far a page has risen: 0 while its top is at (or below) the bottom of
// the visible area, 1 once it reaches the top. `top` is where its top would
// be on screen without sticking, measured from the visible area's top.
export function riseProgress(top: number, visibleHeight: number): number {
  return visibleHeight > 0 ? clamp(1 - top / visibleHeight) : 1;
}

// The incoming page's tilt. kigo eases it out (-5.1deg at 81% of the way up
// the screen still to go, -1.2deg at 31%), which fits (1 - p)^1.5.
export function tiltAt(p: number): number {
  const left = 1 - clamp(p);
  return left === 0 ? 0 : TILT_DEG * Math.pow(left, 1.5);
}

// The page underneath, as the next one covers it.
export function coverAt(p: number): { scale: number; dim: number } {
  const c = clamp(p);
  return { scale: 1 - (1 - COVER_SCALE) * c, dim: COVER_DIM * c };
}

// Which page counts as the current one: the last that has risen at least
// halfway. `progress[0]` is the first page, always fully up.
export function currentPage(progress: number[]): number {
  let current = 0;
  progress.forEach((p, i) => {
    if (i > 0 && p >= 0.5) current = i;
  });
  return current;
}

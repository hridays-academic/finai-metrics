// Where the ball is (2026-11-16): on Home's slider ("hero"), or loose on
// Home ("free"). Dragging it out of Home's scene frees it. It goes back on
// the slider when it drops into the gold range (the mini game), on a double
// tap, or when the visitor leaves Home. In memory only: a reload resets it.
export interface BallLaunch {
  x: number; // centre, viewport pixels
  y: number;
  vx: number; // pixels per second
  vy: number;
  // When the ball was freed mid-drag, the drag carries on with this pointer.
  pointerId?: number;
  grabX?: number;
  grabY?: number;
}

type Mode = "hero" | "free";

let mode: Mode = "hero";
let launch: BallLaunch | null = null;
// Where the loose ball was when it went back (viewport pixels), so the
// slider can carry on its fall from there; null drops it from above.
let dockAt: BallLaunch | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export const ballStore = {
  mode: (): Mode => mode,
  launch: (): BallLaunch | null => launch,
  free(state: BallLaunch) {
    mode = "free";
    launch = state;
    emit();
  },
  dock(at: BallLaunch | null = null) {
    if (mode === "hero") return;
    mode = "hero";
    launch = null;
    dockAt = at;
    emit();
  },
  dockAt: (): BallLaunch | null => dockAt,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

import { useEffect, useRef, useSyncExternalStore } from "react";
import { ballStore } from "../lib/ballStore";

// The loose ball (2026-11-16): once dragged out of Home's scene it plays on
// Home only (App renders it only there, and leaving Home puts it back on the
// slider). Ordinary gravity: it lands on the tops of Home's company tiles and
// panels (and rides along with them as the page scrolls), rolls off their
// edges, and otherwise rests at the bottom of the screen (above the phone tab
// bar); it bounces off floor, walls and top bar, and its surface turns as it
// rolls. The mini game: drop it into the gold range on the slider and it
// goes back on the slider (the range pulses). Drag it anywhere and throw it; a tap
// makes it hop; a double tap scrolls Home to the top and puts it back on the
// slider. Its shadow sits on the floor under it, spreading as it rises.
// Decorative and pointer-only (aria-hidden); the physics loop runs only while
// it moves.

const GRAVITY = 2600; // px/s^2
const FLOOR_BOUNCE = 0.52;
const WALL_BOUNCE = 0.6;
const ROLL_FRICTION = 1.3; // per second, on the floor
const MAX_THROW = 3200;
const DOUBLE_TAP_MS = 320;
// What the ball can land on (one-way: only when falling onto the top).
const SURFACES = ".home .sector-tile, .home .glass.panel, .home .guide-strip";

export function BallSkin() {
  return (
    <>
      <span className="ball-texture" aria-hidden="true" />
      <span className="ball-shade" />
    </>
  );
}

export default function FreeBall({ onHome }: { onHome: () => void }) {
  const mode = useSyncExternalStore(ballStore.subscribe, ballStore.mode, ballStore.mode);
  return mode === "free" ? <LooseBall onHome={onHome} /> : null;
}

function LooseBall({ onHome }: { onHome: () => void }) {
  const ballRef = useRef<HTMLSpanElement>(null);
  const shadowRef = useRef<HTMLSpanElement>(null);
  const homeRef = useRef(onHome);
  homeRef.current = onHome;

  useEffect(() => {
    const ball = ballRef.current;
    const shadow = shadowRef.current;
    if (!ball || !shadow) return;
    const texture = ball.querySelector<HTMLElement>(".ball-texture");
    const start = ballStore.launch();

    let r = ball.offsetWidth / 2;
    let x = start?.x ?? window.innerWidth / 2;
    let y = start?.y ?? window.innerHeight / 2;
    let vx = start?.vx ?? 0;
    let vy = start?.vy ?? 0;
    let spin = 0; // texture angle, radians
    let dragging = false;
    let pointerId = -1;
    let grabX = 0;
    let grabY = 0;
    let downAt = { t: 0, x: 0, y: 0 };
    let travelled = 0;
    let lastTap = 0;
    let samples: { t: number; x: number; y: number }[] = [];
    let surface: HTMLElement | null = null;
    let surfaceTop = 0;
    let surfaceMoved = false;
    let frame = 0;
    let homeTimer = 0;
    let last = 0;

    // The floor: the bottom of the screen, or the top of the phone tab bar.
    const floor = () => {
      const nav = document.querySelector<HTMLElement>(".primary-nav");
      const rect = nav?.getBoundingClientRect();
      const bottom = rect && rect.top > window.innerHeight / 2 ? rect.top - 8 : window.innerHeight - 12;
      return bottom - r;
    };
    const ceiling = () => {
      const header = document.querySelector<HTMLElement>(".app-header");
      return (header?.getBoundingClientRect().bottom ?? 0) + r;
    };

    const apply = () => {
      const f = surface ? surfaceTop - r : floor();
      const lift = Math.max(0, f - y);
      ball.style.transform = `translate(${(x - r).toFixed(1)}px, ${(y - r).toFixed(1)}px)`;
      if (texture) texture.style.transform = `rotate(${spin.toFixed(3)}rad)`;
      shadow.style.transform = `translate(${(x - r).toFixed(1)}px, ${(f + r - 7).toFixed(1)}px) scale(${(1 + lift / 300).toFixed(3)})`;
      shadow.style.opacity = Math.max(0.25, 1 - lift / 500).toFixed(3);
    };

    let gone = false;
    const goHome = () => {
      gone = true;
      ballStore.dock({ x, y, vx, vy });
    };

    const step = (dt: number) => {
      if (dragging || gone) return;
      const f = floor();
      const c = ceiling();
      const before = x;
      const prevBottom = y + r;
      surfaceMoved = false;

      // Resting on a tile or panel: ride along with it while it's under us.
      if (surface && vy >= 0) {
        const rect = surface.getBoundingClientRect();
        if (surface.isConnected && x >= rect.left && x <= rect.right && rect.top - r < f && rect.top - r > c) {
          surfaceMoved = Math.abs(rect.top - surfaceTop) > 0.1;
          surfaceTop = rect.top;
          y = rect.top - r;
          vy = 0;
        } else {
          surface = null; // rolled off the edge, or it scrolled away
        }
      } else {
        surface = null;
      }

      if (!surface) {
        vy += GRAVITY * dt;
        y += vy * dt;
      }
      x += vx * dt;

      if (!surface && vy > 0) {
        // The gold range: back on the slider, one point.
        const range = document.querySelector(".hero-object-range")?.getBoundingClientRect();
        if (range && prevBottom <= range.top + 6 && y + r >= range.top && x >= range.left && x <= range.right) {
          goHome();
          return;
        }
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(SURFACES))) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= c || rect.top - r >= f) continue;
          if (prevBottom <= rect.top + 1 && y + r >= rect.top && x >= rect.left + 4 && x <= rect.right - 4) {
            y = rect.top - r;
            if (vy > 160) {
              vy = -vy * FLOOR_BOUNCE;
            } else {
              vy = 0;
              surface = el;
              surfaceTop = rect.top;
            }
            break;
          }
        }
      }

      if (y >= f) {
        y = f;
        vy = vy > 160 ? -vy * FLOOR_BOUNCE : 0;
      } else if (y <= c) {
        y = c;
        vy = Math.abs(vy) * WALL_BOUNCE;
      }
      if (y === f || surface) {
        vx *= Math.exp(-ROLL_FRICTION * dt);
        if (Math.abs(vx) < 6) vx = 0;
      }
      // On the floor it rolls gently into the nearer side margin, so it
      // never comes to rest over the page's text.
      if (y === f && !surface && Math.abs(vx) < 120) {
        const toRight = x > window.innerWidth / 2;
        const edge = toRight ? window.innerWidth - r - 8 : r + 8;
        if (Math.abs(edge - x) > 1) {
          vx += (toRight ? 1 : -1) * 420 * dt;
          vx = Math.max(-260, Math.min(260, vx));
        }
      }
      const left = r + 8;
      const right = window.innerWidth - r - 8;
      if (x < left) {
        x = left;
        vx = Math.abs(vx) * WALL_BOUNCE;
      } else if (x > right) {
        x = right;
        vx = -Math.abs(vx) * WALL_BOUNCE;
      }
      spin += (x - before) / r;
    };

    const atRest = () =>
      !dragging && vx === 0 && vy === 0 && !surfaceMoved && (surface !== null || Math.abs(y - floor()) < 0.5);

    const tick = (now: number) => {
      frame = 0;
      const dt = last ? Math.min(0.033, (now - last) / 1000) : 1 / 60;
      last = now;
      step(dt / 2);
      step(dt / 2);
      apply();
      if (!atRest()) frame = requestAnimationFrame(tick);
      else {
        last = 0;
        // T27: a loose ball left at rest goes back to the slider after 3 s.
        clearTimeout(homeTimer);
        homeTimer = window.setTimeout(() => {
          if (atRest()) ballStore.dock();
        }, 3000);
      }
    };
    const run = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };

    const beginDrag = (id: number, gx: number, gy: number, at: { t: number; x: number; y: number }) => {
      dragging = true;
      clearTimeout(homeTimer);
      pointerId = id;
      grabX = gx;
      grabY = gy;
      downAt = at;
      travelled = 0;
      vx = vy = 0;
      samples = [{ t: at.t, x, y }];
      try {
        ball.setPointerCapture(id);
      } catch {
        dragging = false; // the pointer is already up: just let it fall
      }
      ball.classList.toggle("is-dragging", dragging);
    };

    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      beginDrag(e.pointerId, e.clientX - x, e.clientY - y, { t: e.timeStamp, x: e.clientX, y: e.clientY });
      run();
    };
    const move = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pointerId) return;
      travelled = Math.max(travelled, Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y));
      const before = x;
      x = Math.min(window.innerWidth - r - 8, Math.max(r + 8, e.clientX - grabX));
      y = Math.min(floor(), Math.max(ceiling(), e.clientY - grabY));
      spin += (x - before) / r;
      samples.push({ t: e.timeStamp, x, y });
      while (samples.length > 2 && e.timeStamp - samples[0].t > 90) samples.shift();
      apply();
    };
    const up = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pointerId) return;
      dragging = false;
      ball.classList.remove("is-dragging");
      if (travelled < 6 && e.timeStamp - downAt.t < 260) {
        if (e.timeStamp - lastTap < DOUBLE_TAP_MS) {
          lastTap = 0;
          homeRef.current();
          ballStore.dock();
          return;
        }
        lastTap = e.timeStamp;
        vy = -1050;
        vx = (Math.random() - 0.5) * 300;
      } else if (samples.length > 1) {
        const a = samples[0];
        const z = samples[samples.length - 1];
        const span = Math.max(16, z.t - a.t) / 1000;
        vx = Math.max(-MAX_THROW, Math.min(MAX_THROW, (z.x - a.x) / span));
        vy = Math.max(-MAX_THROW, Math.min(MAX_THROW, (z.y - a.y) / span));
      }
      run();
    };
    const lost = (e: PointerEvent) => {
      if (dragging && e.pointerId === pointerId) up(e);
    };
    const resized = () => {
      r = ball.offsetWidth / 2;
      run();
    };

    ball.addEventListener("pointerdown", down);
    ball.addEventListener("pointermove", move);
    ball.addEventListener("pointerup", up);
    ball.addEventListener("pointercancel", up);
    ball.addEventListener("lostpointercapture", lost);
    window.addEventListener("resize", resized);
    const box = document.querySelector<HTMLElement>(".app-shell-content");
    box?.addEventListener("scroll", run, { passive: true });

    // Freed mid-drag from Home's scene: carry on with the same pointer.
    if (start?.pointerId !== undefined) {
      beginDrag(start.pointerId, start.grabX ?? 0, start.grabY ?? 0, { t: performance.now(), x: x + (start.grabX ?? 0), y: y + (start.grabY ?? 0) });
      travelled = 100; // it is already a drag, never a tap
    }
    apply();
    run();

    return () => {
      ball.removeEventListener("pointerdown", down);
      ball.removeEventListener("pointermove", move);
      ball.removeEventListener("pointerup", up);
      ball.removeEventListener("pointercancel", up);
      ball.removeEventListener("lostpointercapture", lost);
      window.removeEventListener("resize", resized);
      box?.removeEventListener("scroll", run);
      if (frame) cancelAnimationFrame(frame);
      clearTimeout(homeTimer);
    };
  }, []);

  return (
    <div className="free-ball-layer" aria-hidden="true">
      <span className="free-ball-shadow" ref={shadowRef} />
      <span className="free-ball ball-skin" ref={ballRef}>
        <BallSkin />
      </span>
    </div>
  );
}

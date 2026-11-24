import { useEffect, useRef } from "react";
import { ballStore } from "../../lib/ballStore";
import { BallSkin } from "../FreeBall";
import { prefersReducedMotion } from "../../hooks/useOnceVisible";

// Home's hero object (2026-11-16, stage 1 stand-in for the three.js scene):
// a gold range on a recessed track and a polished ball. On load (CSS) the
// range settles and the ball drops into it. Then:
// - the range follows the pointer through a spring (it lags a little, which
//   reads as weight), glides on release and settles;
// - a ball resting on the range sits in a very shallow dip: when the range
//   moves, the ball rolls back and forth from inertia and settles again (a
//   hard shove can roll it off the end onto the track);
// - the ball can be picked up and thrown (gravity, bounce, rolling friction)
//   and tapped to make it hop.
// - drag the ball out of the scene and it comes loose (FreeBall.tsx) and
//   follows the visitor to every page; when it comes back (a double tap on
//   it) it drops onto the range from above.
// Its surface (BallSkin) turns as it rolls; its contact shadow stays on the
// surface under it, spreading and fading as it rises but never vanishing.
// Decorative (aria-hidden), pointer only. The physics loop runs only while
// something moves. Positions are layout pixels in the scene, which is
// rotated by TILT, so pointer positions are rotated back into it.

const TILT = (-6 * Math.PI) / 180;
const RANGE_X0 = 0.3; // CSS start positions, as fractions of the scene width
const BALL_X0 = 0.47;
const GRAVITY = 2600; // px/s^2
const BOUNCE = 0.38;
const ROLL_FRICTION = 2.4; // per second, on the track
const LIFT = 170; // how high the ball can be lifted above the surface
// The range's spring towards the pointer: stiffness and damping (slightly
// under critical, so it settles with the faintest overshoot).
const RANGE_K = 140;
const RANGE_C = 20;
// The ball in its shallow dip on the range: restoring stiffness and damping.
const DIP_K = 55;
const DIP_C = 4.2;
const ROLLING = 5 / 7; // a rolling sphere feels 5/7 of the range's acceleration

export default function HeroObject() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLSpanElement>(null);
  const rangeRef = useRef<HTMLSpanElement>(null);
  const ballRef = useRef<HTMLSpanElement>(null);
  const shadowRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const scene = sceneRef.current;
    const track = trackRef.current;
    const range = rangeRef.current;
    const ball = ballRef.current;
    const shadow = shadowRef.current;
    if (!scene || !track || !range || !ball || !shadow) return;
    // Reduced motion: the ball and range stay a still picture.
    if (prefersReducedMotion()) return;

    let W = 0;
    let H = 0;
    let r = 0;
    let capH = 0;
    let trackH = 0;
    let rangeW = 0;
    // Range
    let rangeX = 0;
    let rangeV = 0;
    let rangeTarget = 0;
    // Ball (world): centre x, bottom b (px down from the scene top), velocity
    let x = 0;
    let b = 0;
    let vx = 0;
    let vy = 0;
    // Ball riding the range: position u on it, its velocity uv, rest spot u0
    let riding = false;
    let u = 0;
    let uv = 0;
    let u0 = 0;
    let squash = 0;
    let spin = 0; // the ball's surface angle, radians
    let away = ballStore.mode() === "free";
    let screenSamples: { t: number; x: number; y: number }[] = [];
    const texture = ball.querySelector<HTMLElement>(".ball-texture");

    let mode: "idle" | "ball" | "range" = "idle";
    let grabX = 0;
    let grabY = 0;
    let downAt = { t: 0, x: 0, y: 0 };
    let travelled = 0;
    let samples: { t: number; x: number; b: number }[] = [];
    let frame = 0;
    let last = 0;

    const onRange = (bx: number) => bx >= rangeX && bx <= rangeX + rangeW;
    const rangeTop = () => H / 2 - capH / 2 + 3;
    const trackTop = () => H / 2 - trackH / 2 + 10;
    const ground = (bx: number) => (onRange(bx) ? rangeTop() : trackTop());

    const startRiding = () => {
      riding = true;
      u = x - rangeX;
      uv = vx - rangeV;
      u0 = Math.min(rangeW - r * 0.6, Math.max(r * 0.6, u));
    };

    const measure = () => {
      W = scene.offsetWidth;
      H = scene.offsetHeight;
      r = ball.offsetWidth / 2;
      capH = range.offsetHeight;
      trackH = track.offsetHeight;
      rangeW = range.offsetWidth;
      rangeX = rangeTarget = RANGE_X0 * W;
      rangeV = 0;
      x = BALL_X0 * W;
      b = rangeTop();
      vx = vy = 0;
      riding = false;
      startRiding();
    };

    const apply = () => {
      scene.classList.toggle("ball-away", away);
      const g = ground(x);
      const lift = Math.max(0, g - b);
      range.style.transform = `translateX(${(rangeX - RANGE_X0 * W).toFixed(2)}px)`;
      const sq = Math.min(0.12, squash);
      ball.style.transform =
        `translate(${(x - BALL_X0 * W).toFixed(2)}px, ${(b - rangeTop()).toFixed(2)}px)` +
        (sq > 0.002 ? ` scale(${(1 + sq).toFixed(3)}, ${(1 - sq).toFixed(3)})` : "");
      ball.style.transformOrigin = "50% 100%";
      if (texture) texture.style.transform = `rotate(${spin.toFixed(3)}rad)`;
      // The contact shadow stays on the surface under the ball; it spreads
      // and fades as the ball rises.
      shadow.style.transform = `translate(${(x - BALL_X0 * W).toFixed(2)}px, ${(g - rangeTop()).toFixed(2)}px) scale(${(1 + lift / 160).toFixed(3)})`;
      shadow.style.opacity = Math.max(0.3, 1 - lift / 190).toFixed(3);
    };

    const step = (dt: number) => {
      const before = x;
      physics(dt);
      spin += (x - before) / Math.max(1, r);
    };

    const physics = (dt: number) => {
      // The range: spring towards its target, soft stop at the track's ends.
      const acc = RANGE_K * (rangeTarget - rangeX) - RANGE_C * rangeV;
      rangeV += acc * dt;
      rangeX += rangeV * dt;
      if (rangeX < 0 || rangeX > W - rangeW) {
        rangeX = Math.min(W - rangeW, Math.max(0, rangeX));
        rangeV *= -0.2;
      }
      squash *= Math.exp(-dt * 14);
      if (mode === "ball" || away) return;

      if (riding) {
        // Rolls against the range's acceleration, pulled back into its dip.
        const ua = -ROLLING * acc - DIP_K * (u - u0) - DIP_C * uv;
        uv += ua * dt;
        u += uv * dt;
        x = rangeX + u;
        vx = rangeV + uv;
        b = rangeTop();
        vy = 0;
        if (u < 0 || u > rangeW) riding = false; // rolled off the end
        return;
      }

      const g = ground(x);
      if (b < g - 0.5 || vy < 0) {
        // In the air: fall, land, bounce.
        vy += GRAVITY * dt;
        b += vy * dt;
        x += vx * dt;
        const g2 = ground(x);
        if (b >= g2) {
          b = g2;
          squash = Math.max(squash, Math.min(0.12, vy / 6000));
          vy = vy > 140 ? -vy * BOUNCE : 0;
          if (vy === 0 && onRange(x)) startRiding();
        }
      } else {
        if (b > g) b += (g - b) * Math.min(1, dt * 16); // the range slid under it
        if (Math.abs(b - g) < 0.5) {
          b = g;
          if (onRange(x)) {
            startRiding();
            return;
          }
        }
        vy = 0;
        vx *= Math.exp(-ROLL_FRICTION * dt);
        x += vx * dt;
      }
      if (x < r) {
        x = r;
        vx = -vx * 0.4;
      } else if (x > W - r) {
        x = W - r;
        vx = -vx * 0.4;
      }
      if (Math.abs(vx) < 4) vx = 0;
    };

    const atRest = () => {
      if (away) return Math.abs(rangeV) < 0.5 && Math.abs(rangeTarget - rangeX) < 0.2;
      const rangeStill = Math.abs(rangeV) < 0.5 && Math.abs(rangeTarget - rangeX) < 0.2;
      const ballStill = riding
        ? Math.abs(uv) < 0.5 && Math.abs(u - u0) < 0.2
        : vx === 0 && vy === 0 && Math.abs(b - ground(x)) < 0.5;
      return rangeStill && ballStill && squash < 0.002;
    };

    const tick = (now: number) => {
      frame = 0;
      const dt = last ? Math.min(0.033, (now - last) / 1000) : 1 / 60;
      last = now;
      // Two half steps keep the springs stable at low frame rates.
      step(dt / 2);
      step(dt / 2);
      apply();
      if (mode !== "idle" || !atRest()) frame = requestAnimationFrame(tick);
      else last = 0;
    };
    const run = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };

    // A screen position in the scene's own (rotated) coordinates.
    const toLocal = (clientX: number, clientY: number): [number, number] => {
      const box = scene.parentElement!.getBoundingClientRect();
      const px = clientX - box.left - box.width / 2;
      const py = clientY - box.top - box.height / 2;
      const c = Math.cos(-TILT);
      const s = Math.sin(-TILT);
      return [px * c - py * s + W / 2, px * s + py * c + H / 2];
    };
    const local = (e: PointerEvent) => toLocal(e.clientX, e.clientY);

    // The load animation uses `translate`/`scale`; finish it before a drag.
    const settleLoad = () => {
      for (const el of [ball, range, track, shadow]) el.getAnimations?.().forEach((a) => a.finish());
    };

    const down = (e: PointerEvent, what: "ball" | "range") => {
      if (e.button !== 0 || (what === "ball" && away)) return;
      e.preventDefault();
      settleLoad();
      const [lx, ly] = local(e);
      mode = what;
      downAt = { t: e.timeStamp, x: e.clientX, y: e.clientY };
      travelled = 0;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      scene.classList.add("is-dragging");
      if (what === "ball") {
        screenSamples = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }];
        riding = false;
        grabX = lx - x;
        grabY = ly - b;
        vx = vy = 0;
        samples = [{ t: e.timeStamp, x, b }];
      } else {
        grabX = lx - rangeX;
      }
      run();
    };

    const move = (e: PointerEvent) => {
      if (mode === "idle") return;
      travelled = Math.max(travelled, Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y));
      const [lx, ly] = local(e);
      if (mode === "ball") {
        screenSamples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
        while (screenSamples.length > 2 && e.timeStamp - screenSamples[0].t > 90) screenSamples.shift();
        const box = scene.parentElement!.getBoundingClientRect();
        const out = 36;
        if (e.clientX < box.left - out || e.clientX > box.right + out || e.clientY < box.top - out || e.clientY > box.bottom + out) {
          // Out of the scene: the ball comes loose and the drag carries on.
          const at = ball.getBoundingClientRect();
          const cx = at.left + at.width / 2;
          const cy = at.top + at.height / 2;
          const a = screenSamples[0];
          const z = screenSamples[screenSamples.length - 1];
          const span = Math.max(16, z.t - a.t) / 1000;
          mode = "idle";
          scene.classList.remove("is-dragging");
          try {
            ball.releasePointerCapture(e.pointerId);
          } catch {
            // already released
          }
          away = true;
          apply();
          ballStore.free({
            x: cx,
            y: cy,
            vx: (z.x - a.x) / span,
            vy: (z.y - a.y) / span,
            pointerId: e.pointerId,
            grabX: e.clientX - cx,
            grabY: e.clientY - cy,
          });
          return;
        }
        x = Math.min(W - r, Math.max(r, lx - grabX));
        const g = ground(x);
        b = Math.min(g, Math.max(g - LIFT, ly - grabY));
        samples.push({ t: e.timeStamp, x, b });
        while (samples.length > 2 && e.timeStamp - samples[0].t > 90) samples.shift();
      } else {
        rangeTarget = Math.min(W - rangeW, Math.max(0, lx - grabX));
      }
      run();
    };

    const up = (e: PointerEvent) => {
      if (mode === "ball") {
        if (travelled < 5 && e.timeStamp - downAt.t < 300) {
          // A tap: a little hop.
          vy = -620;
          vx = (Math.random() - 0.5) * 120;
        } else if (samples.length > 1) {
          const a = samples[0];
          const z = samples[samples.length - 1];
          const span = Math.max(16, z.t - a.t) / 1000;
          vx = Math.max(-1600, Math.min(1600, (z.x - a.x) / span));
          vy = Math.max(-1400, Math.min(1400, (z.b - a.b) / span));
        }
      } else if (mode === "range") {
        // Glide on a little after letting go.
        rangeTarget = Math.min(W - rangeW, Math.max(0, rangeX + rangeV * 0.14));
      }
      mode = "idle";
      scene.classList.remove("is-dragging");
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // already released
      }
      run();
    };

    const onBall = (e: PointerEvent) => down(e, "ball");
    const onRangeDown = (e: PointerEvent) => down(e, "range");
    ball.addEventListener("pointerdown", onBall);
    range.addEventListener("pointerdown", onRangeDown);
    for (const el of [ball, range]) {
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    }

    const unsubscribe = ballStore.subscribe(() => {
      const free = ballStore.mode() === "free";
      if (free === away) return;
      away = free;
      if (!away) {
        riding = false;
        const at = ballStore.dockAt();
        if (at && W) {
          // Dropped into the range on the page: carry on its fall from where
          // it is, and the range gives a little pulse.
          const [lx, ly] = toLocal(at.x, at.y);
          x = Math.min(W - r, Math.max(r, lx));
          b = Math.min(ly + r, ground(x));
          vx = at.vx * 0.5;
          vy = Math.max(0, at.vy);
          range.classList.remove("is-scored");
          void range.offsetWidth; // restart the pulse
          range.classList.add("is-scored");
        } else {
          // Sent back (a double tap, or leaving Home): drop in from above.
          x = rangeX + rangeW / 2;
          b = rangeTop() - 240;
          vx = 0;
          vy = 0;
        }
      }
      apply();
      run();
    });

    measure();
    apply();
    let resized: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resized = new ResizeObserver(() => {
        const w = scene.offsetWidth;
        if (w && w !== W) {
          measure();
          apply();
        }
      });
      resized.observe(scene);
    }

    return () => {
      ball.removeEventListener("pointerdown", onBall);
      range.removeEventListener("pointerdown", onRangeDown);
      for (const el of [ball, range]) {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
      }
      resized?.disconnect();
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="hero-object" aria-hidden="true">
      <div className="hero-object-scene" ref={sceneRef}>
        <span className="hero-object-track slab" ref={trackRef} />
        <span className="hero-object-range slab-range" ref={rangeRef} />
        <span className="hero-object-ball-shadow slab-shadow" ref={shadowRef} />
        <span className="hero-object-ball ball-skin" ref={ballRef}>
          <BallSkin />
        </span>
      </div>
    </div>
  );
}

import { useEffect, useRef } from "react";
import { CardSpark, Grain, Guilloche } from "./league/CardArt";
import { prefersReducedMotion } from "../hooks/useOnceVisible";

// The Research page's company card (2026-11-16): the same material, engraving
// and light as the forecast page's 3D card (CompanyStory), smaller. When a
// company loads it spins at a good pace, then slows gradually and comes to
// rest facing you: it coasts with friction, then brakes evenly to the next
// front-facing angle ahead (never backwards, never a snap). It can be dragged
// to turn it (and tilted a little), with some resistance; let go and it
// coasts the same way. A hold lets go by itself after HOLD_MS. A tap gives
// it a flick. Transforms and opacity only. Its colour is the company's
// difficulty colour (lib/difficulty), as on Home and the company page.

const SLICES = [-7, -5, -3, -1, 1, 3, 5, 7];
const BASE = 1 / 1.2; // laid out larger and scaled down, so text stays sharp
const REST_X = 6; // resting tilt, degrees
const REST_Y = -12;
const START_SPIN = 640; // deg/s when a company loads
const FRICTION = 0.9; // per second, while coasting
const BRAKE_BELOW = 260; // deg/s: from here it brakes evenly to a front
const MAX_BRAKE = 240; // deg/s^2, the gentlest braking it lines up for
const SPRING_K = 30; // tiny leftovers: a critically damped spring to the front
const SPRING_C = 2 * Math.sqrt(30);
const TILT_K = 50;
const TILT_C = 2 * Math.sqrt(50);
const DRAG_DEG_PER_PX = 0.32; // resistance: degrees turned per pixel dragged
const TILT_DEG_PER_PX = 0.18;
const MAX_FLING = 900; // deg/s
const HOLD_MS = 1500;
const RAD = Math.PI / 180;

interface ResearchCardProps {
  name: string;
  ticker: string;
  colour: string; // the company's colour class (lib/difficulty)
  difficulty: string | null; // its approved label, e.g. "Medium to forecast"
  sectorLabel: string | null;
  revenues: (number | null)[];
  foot: string;
}

export default function ResearchCard({ name, ticker, colour, difficulty, sectorLabel, revenues, foot }: ResearchCardProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const sheenRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const rimRefs = useRef<Record<string, HTMLSpanElement | null>>({});

  useEffect(() => {
    const stage = stageRef.current;
    const card = cardRef.current;
    if (!stage || !card) return;

    let ry = REST_Y;
    let rx = REST_X;
    if (prefersReducedMotion()) {
      // Reduced motion: a still card at its resting angle, no spin or drag.
      card.style.transform = `rotateX(${REST_X}deg) rotateY(${REST_Y}deg) scale(${BASE.toFixed(4)})`;
      return;
    }
    let wy = START_SPIN;
    let wx = 0;
    let braking = false;
    let brakeTo = 0;
    let holdTimer = 0;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startRy = 0;
    let startRx = 0;
    let downAt = 0;
    let travelled = 0;
    let samples: { t: number; ry: number }[] = [];
    let frame = 0;
    let last = 0;

    const render = () => {
      card.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) scale(${BASE.toFixed(4)})`;
      const sx = Math.sin(rx * RAD);
      for (const [side, angle] of [
        ["front", ry],
        ["back", ry - 180],
      ] as [string, number][]) {
        const sy = Math.sin(angle * RAD) * (side === "back" ? -1 : 1);
        const facing = Math.max(0, Math.cos(angle * RAD));
        const sheen = sheenRefs.current[side];
        if (sheen) {
          sheen.style.transform = `translateX(${((sy * 150 + sx * 40) / 2.2).toFixed(2)}%)`;
          sheen.style.opacity = (0.5 * facing).toFixed(3);
        }
        const set = (edge: string, v: number) => {
          const el = rimRefs.current[`${side}-${edge}`];
          if (el) el.style.opacity = (v * facing).toFixed(3);
        };
        set("top", 0.4 + 0.4 * Math.max(0, sx));
        set("left", 0.25 + 0.65 * Math.max(0, sy));
        set("right", 0.08 + 0.3 * Math.max(0, -sy));
      }
    };

    const nearestFront = () => REST_Y + 360 * Math.round((ry - REST_Y) / 360);

    // The first front-facing angle ahead that it can reach braking no harder
    // than MAX_BRAKE.
    const frontAhead = () => {
      const dir = Math.sign(wy);
      const need = (wy * wy) / (2 * MAX_BRAKE);
      let k = dir > 0 ? Math.ceil((ry - REST_Y) / 360) : Math.floor((ry - REST_Y) / 360);
      let target = REST_Y + 360 * k;
      while (Math.abs(target - ry) < need || Math.sign(target - ry) !== dir) {
        k += dir;
        target = REST_Y + 360 * k;
      }
      return target;
    };

    const step = (dt: number) => {
      if (dragging) return;
      if (braking) {
        const left = brakeTo - ry;
        const decel = (wy * wy) / (2 * Math.max(0.01, Math.abs(left)));
        wy -= Math.sign(wy) * decel * dt;
        ry += wy * dt;
        if (Math.sign(brakeTo - ry) !== Math.sign(left) || Math.abs(wy) < 2) {
          ry = brakeTo;
          wy = 0;
          braking = false;
        }
      } else if (Math.abs(wy) > BRAKE_BELOW) {
        wy *= Math.exp(-FRICTION * dt);
        ry += wy * dt;
      } else if (Math.abs(wy) > 30) {
        brakeTo = frontAhead();
        braking = true;
      } else {
        wy += (SPRING_K * (nearestFront() - ry) - SPRING_C * wy) * dt;
        ry += wy * dt;
      }
      wx += (TILT_K * (REST_X - rx) - TILT_C * wx) * dt;
      rx += wx * dt;
    };

    const atRest = () =>
      !dragging &&
      Math.abs(wy) < 0.5 &&
      Math.abs(nearestFront() - ry) < 0.05 &&
      Math.abs(wx) < 0.5 &&
      Math.abs(REST_X - rx) < 0.05;

    const tick = (now: number) => {
      frame = 0;
      const dt = last ? Math.min(0.033, (now - last) / 1000) : 1 / 60;
      last = now;
      step(dt / 2);
      step(dt / 2);
      if (atRest()) {
        // Snap to the resting angle and keep the numbers small.
        ry = REST_Y;
        rx = REST_X;
        wy = wx = 0;
      }
      render();
      if (!atRest() || dragging) frame = requestAnimationFrame(tick);
      else last = 0;
    };
    const run = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };

    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragging = true;
      braking = false;
      window.clearTimeout(holdTimer);
      // Holding on lets go by itself, as if the card slipped out of the hand.
      holdTimer = window.setTimeout(() => release(e.pointerId, true), HOLD_MS);
      startX = e.clientX;
      startY = e.clientY;
      startRy = ry;
      startRx = rx;
      downAt = e.timeStamp;
      travelled = 0;
      wy = wx = 0;
      samples = [{ t: e.timeStamp, ry }];
      stage.setPointerCapture(e.pointerId);
      stage.classList.add("is-dragging");
      run();
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      travelled = Math.max(travelled, Math.hypot(dx, dy));
      ry = startRy + dx * DRAG_DEG_PER_PX;
      rx = Math.max(-25, Math.min(25, startRx - dy * TILT_DEG_PER_PX));
      samples.push({ t: e.timeStamp, ry });
      while (samples.length > 2 && e.timeStamp - samples[0].t > 90) samples.shift();
      render();
    };
    const release = (pointerId: number, timedOut: boolean, at = performance.now()) => {
      if (!dragging) return;
      dragging = false;
      window.clearTimeout(holdTimer);
      stage.classList.remove("is-dragging");
      if (!timedOut && travelled < 5 && at - downAt < 300) {
        wy = 420; // a tap: a flick
      } else if (samples.length > 1 && at - samples[samples.length - 1].t < 120) {
        const a = samples[0];
        const z = samples[samples.length - 1];
        wy = Math.max(-MAX_FLING, Math.min(MAX_FLING, (z.ry - a.ry) / (Math.max(16, z.t - a.t) / 1000)));
      }
      try {
        stage.releasePointerCapture(pointerId);
      } catch {
        // already released
      }
      run();
    };
    const up = (e: PointerEvent) => release(e.pointerId, false, e.timeStamp);

    stage.addEventListener("pointerdown", down);
    stage.addEventListener("pointermove", move);
    stage.addEventListener("pointerup", up);
    stage.addEventListener("pointercancel", up);
    stage.addEventListener("lostpointercapture", up);
    render();
    run();
    return () => {
      stage.removeEventListener("pointerdown", down);
      stage.removeEventListener("pointermove", move);
      stage.removeEventListener("pointerup", up);
      stage.removeEventListener("pointercancel", up);
      stage.removeEventListener("lostpointercapture", up);
      window.clearTimeout(holdTimer);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const hasSpark = revenues.filter((v) => v !== null).length >= 2;

  const surface = (side: string) => (
    <div className="card3d-surface">
      <Guilloche />
      <Grain />
      <div
        className="card3d-sheen"
        ref={(el) => {
          sheenRefs.current[side] = el;
        }}
      />
      {["top", "left", "right"].map((edge) => (
        <span
          key={edge}
          className={`card3d-rim card3d-rim-${edge}`}
          ref={(el) => {
            rimRefs.current[`${side}-${edge}`] = el;
          }}
        />
      ))}
    </div>
  );

  return (
    <div className={`research-card-stage ${colour}`} ref={stageRef} aria-hidden="true">
      <div className="card3d card3d-small" ref={cardRef}>
        {SLICES.map((z) => (
          <div className="card3d-slice" key={z} style={{ transform: `translateZ(${z}px)` }} />
        ))}
        <div className="card3d-face card3d-front">
          {surface("front")}
          <div className="card3d-content">
            {(sectorLabel || difficulty) && (
              <span className="card3d-sector">
                {sectorLabel}
                {difficulty && <span className="card3d-difficulty">{difficulty}</span>}
              </span>
            )}
            <span className="card3d-mid">
              <span className="card3d-id">
                <span className="card3d-name">{name}</span>
                <span className="card3d-ticker">{ticker}</span>
              </span>
              {hasSpark && (
                <span className="card3d-spark">
                  <span className="card3d-spark-label">Revenue</span>
                  <CardSpark values={revenues} />
                </span>
              )}
            </span>
            <span className="card3d-foot">
              <span>{foot}</span>
            </span>
          </div>
        </div>
        <div className="card3d-face card3d-back">
          {surface("back")}
          <div className="card3d-content research-card-back">
            {sectorLabel && <span className="card3d-sector">{sectorLabel}</span>}
            <span className="research-card-ticker">{ticker}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

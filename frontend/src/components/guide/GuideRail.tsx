import { type KeyboardEvent, type PointerEvent, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { n } from "../../lib/scoring";
import { BallSkin } from "../FreeBall";
import { Grain, Guilloche } from "../league/CardArt";
import { useGuideLayout } from "./guideLayout";
import { useSliderSizes } from "./GuideSvg";

// The guide's slider (v3, 2026-11-19, Hriday: "the same 3D object as Home's
// hero"). Home's own materials, in CSS (gradients and shadows, so sharp at any
// screen density): the black slab (.slab), the glossy gold capsule
// (.slab-range), the steel ball (.ball-skin + BallSkin) and its contact
// shadow (.slab-shadow). The capsule and its ends are dragged through
// transparent 44px hit areas, which are also keyboard sliders. On a mouse,
// a small knob shows at each end only while you hover, focus or drag; on
// touch screens the capsule's ends are the handles. Balls stack like a dot
// plot; page 5's results are thin marks instead (`marks`). Gold is only ever
// the range, and the marks it holds.

export type Range = [number, number];

export interface RailBall {
  key: string | number;
  value: number;
  // A word above the ball ("Results day").
  label?: string;
}

interface RailProps {
  min: number;
  max: number;
  step?: number;
  ticks?: number[];
  unit?: string;
  // Labels under the rail at a value, instead of numbers (named segments).
  labels?: { at: number; text: string }[];
  range?: Range;
  onRange?: (r: Range) => void;
  balls?: RailBall[];
  // Thin marks on the slab at these values (page 5's ten results): gold
  // inside the range, dim steel outside.
  marks?: number[];
  lazy?: number;
  // A red bracket from the ball to the range's nearest edge, with its cost.
  gapLabel?: string;
  // Room above the rail, in balls: a stack of three needs 3.
  headroom?: number;
  // Separate pills instead of one track (pages 1, 4 and 8).
  segments?: { count: number; picked: number | null };
  // Extra pieces laid on the rail, positioned with x().
  children?: (x: (v: number) => string) => ReactNode;
}

const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Picker tiles (layout pass): Home's card material, taller on desktop.
const TILE_H = { desk: 96, phone: 76 };

// An element's left edge as laid out, ignoring transforms between it and
// `outer` (the tilt): offsets are layout positions, so this is the flat
// position even while the object is turned.
function flatLeft(el: HTMLElement, outer: HTMLElement): number {
  let x = 0;
  let node: HTMLElement | null = el;
  while (node && node !== outer) {
    x += node.offsetLeft;
    node = node.offsetParent as HTMLElement | null;
  }
  // `outer` must be a positioned ancestor (.g2-rail-wrap is); if the chain
  // ever skips it, the element's own box is the next best thing.
  if (node !== outer) return el.getBoundingClientRect().left;
  return outer.getBoundingClientRect().left + outer.clientLeft + x;
}
export const SEGMENT_GAP = 6;
export const MARK_GAP = 4;

// Where each ball rests, like a dot plot: balls that would overlap share one
// column (the first ball's position) and stack straight up, so no ball ever
// half-covers another. On the gold range a ball sits a little higher (by
// `raise`). Returns, for each ball, the value its column stands at and its
// height in px.
export function restingPlaces(
  values: number[],
  px: (v: number) => number,
  inRange: (v: number) => boolean,
  d: number,
  raise = 4
): { at: number; lift: number }[] {
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const out = new Array<{ at: number; lift: number }>(values.length);
  let column: { at: number; count: number } | null = null;
  for (const i of order) {
    if (column && Math.abs(px(values[i]) - px(column.at)) < d) column.count += 1;
    else column = { at: values[i], count: 1 };
    out[i] = { at: column.at, lift: (inRange(column.at) ? raise : 0) + (column.count - 1) * d };
  }
  return out;
}

// Where each mark sits, in px (2026-11-24, Hriday: thin marks never
// overlap; equal values sit `gap` px apart). Marks closer than `gap` form a
// group, spread evenly around the group's average; groups that then touch
// merge, until every pair of neighbours is at least `gap` apart.
export function markPlaces(values: number[], px: (v: number) => number, gap = 4): number[] {
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  let groups = order.map((i) => ({ members: [i], centre: px(values[i]) }));
  const left = (g: { members: number[]; centre: number }) => g.centre - ((g.members.length - 1) / 2) * gap;
  const right = (g: { members: number[]; centre: number }) => g.centre + ((g.members.length - 1) / 2) * gap;
  for (let merged = true; merged; ) {
    merged = false;
    const next: typeof groups = [];
    for (const g of groups) {
      const prev = next[next.length - 1];
      if (prev && left(g) - right(prev) < gap - 1e-9) {
        const count = prev.members.length + g.members.length;
        prev.centre = (prev.centre * prev.members.length + g.centre * g.members.length) / count;
        prev.members.push(...g.members);
        merged = true;
      } else next.push({ members: [...g.members], centre: g.centre });
    }
    groups = next;
  }
  const out = new Array<number>(values.length);
  for (const g of groups) g.members.forEach((i, j) => (out[i] = left(g) + j * gap));
  return out;
}

// Pixel width of an element, kept up to date.
export function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => el.clientWidth > 0 && setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export default function GuideRail(props: RailProps) {
  const {
    min, max, step = 0.5, ticks = [], unit = "%", labels, range, onRange, balls = [], marks = [], lazy, gapLabel,
    headroom = 1, segments, children,
  } = props;
  const layout = useGuideLayout();
  const S = useSliderSizes(layout === "split" || layout === "picker");
  const tiles = !!segments && layout === "picker";
  // Home's tilt (-6deg) on split pages; flat while held or focused (CSS).
  const tilts = layout === "split";
  const wrapRef = useRef<HTMLDivElement>(null);
  const [railRef, width] = useWidth<HTMLDivElement>();
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ part: "low" | "high" | "body"; startX: number; start: Range } | null>(null);

  const frac = (v: number) => (clampTo(v, min, max) - min) / (max - min);
  const px = (v: number) => frac(v) * width;
  const x = (v: number) => `${frac(v) * 100}%`;
  const snap = (v: number) => Math.round(v / step) * step;
  // Pointer maths on the flat position (the wrapper isn't turned), so a
  // drag is exact whether or not the object has finished flattening.
  const valueAt = (clientX: number) => {
    const rail = railRef.current;
    const wrap = wrapRef.current;
    if (!rail || !wrap || rail.offsetWidth === 0) return min;
    return min + ((clientX - flatLeft(rail, wrap)) / rail.offsetWidth) * (max - min);
  };

  function set(next: Range) {
    if (!onRange) return;
    const lo = clampTo(snap(next[0]), min, max);
    const hi = clampTo(snap(next[1]), min, max);
    onRange([Math.min(lo, hi), Math.max(lo, hi)]);
  }

  function down(part: "low" | "high" | "body") {
    return (e: PointerEvent<HTMLElement>) => {
      if (!range) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { part, startX: e.clientX, start: range };
      setDragging(true);
    };
  }

  function move(e: PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d || !range) return;
    if (d.part === "body") {
      const shift = width ? ((e.clientX - d.startX) / width) * (max - min) : 0;
      const w = d.start[1] - d.start[0];
      const lo = clampTo(d.start[0] + shift, min, max - w);
      set([lo, lo + w]);
    } else if (d.part === "low") {
      set([Math.min(valueAt(e.clientX), range[1]), range[1]]);
    } else {
      set([range[0], Math.max(valueAt(e.clientX), range[0])]);
    }
  }

  function up() {
    drag.current = null;
    setDragging(false);
  }

  function keys(part: "low" | "high" | "body") {
    return (e: KeyboardEvent<HTMLElement>) => {
      if (!range) return;
      const delta =
        e.key === "ArrowRight" || e.key === "ArrowUp"
          ? step
          : e.key === "ArrowLeft" || e.key === "ArrowDown"
            ? -step
            : e.key === "PageUp"
              ? step * 4
              : e.key === "PageDown"
                ? -step * 4
                : 0;
      if (!delta) return;
      e.preventDefault();
      e.stopPropagation();
      if (part === "low") set([Math.min(range[0] + delta, range[1]), range[1]]);
      else if (part === "high") set([range[0], Math.max(range[1] + delta, range[0])]);
      else {
        const w = range[1] - range[0];
        const lo = clampTo(range[0] + delta, min, max - w);
        set([lo, lo + w]);
      }
    };
  }

  const tileH = S.phone ? TILE_H.phone : TILE_H.desk;
  const box = tiles ? tileH : S.box;
  const cy = box / 2;
  const trackTop = tiles ? 0 : cy - S.track / 2;
  const capTop = cy - S.capsule / 2;
  // Where a ball's bottom rests: sunk a little into the slab's channel, or on
  // top of the capsule (Home's hero: 10 of 24px into the slab, 3px into the
  // range); on picker tiles, on the tiles' top edge.
  const slabGround = tiles ? 2 : trackTop + S.track * 0.42;
  const capGround = capTop + 3;
  const raise = tiles ? 0 : slabGround - capGround;
  const inRange = (v: number) => !!range && v >= range[0] && v <= range[1];
  const places = restingPlaces(balls.map((b) => b.value), px, inRange, S.ball, raise);
  // Marks: 2px wide on phones, 3px elsewhere, standing a little proud of the capsule.
  const phone = S.phone;
  const markW = phone ? 2 : 3;
  const markH = S.capsule + (phone ? 6 : 10);

  const result = balls.length === 1 ? balls[0].value : null;
  const gapFrom =
    result !== null && range && !inRange(result) ? (result < range[0] ? [result, range[0]] : [range[1], result]) : null;

  // Segments: separate slabs with gaps; the picked one carries a steel capsule.
  const segW = segments ? (width - SEGMENT_GAP * (segments.count - 1)) / segments.count : 0;
  const shadowH = Math.max(8, Math.round(S.ball * 0.18));

  return (
    <div
      className={`g2-rail-wrap ${tilts ? "is-tilted" : ""} ${tiles ? "is-tiles" : ""} ${dragging ? "is-held" : ""}`}
      ref={wrapRef}
      style={{ ["--headroom" as string]: headroom, ["--ball" as string]: `${S.ball}px` }}
    >
      <div className="g2-tilt">
      <div className={`g2-rail ${dragging ? "is-dragging" : ""}`} ref={railRef} style={{ height: box }}>
        {segments && tiles ? (
          Array.from({ length: segments.count }, (_, i) => (
            <span
              key={i}
              className={`sector-tile sector-neutral g3-tile ${segments.picked === i ? "is-picked" : ""}`}
              style={{ left: i * (segW + SEGMENT_GAP), width: segW, height: tileH }}
              aria-hidden="true"
            >
              <span className="tile-material">
                <Guilloche />
                <Grain />
              </span>
              <span className="g3-tile-name">{labels?.[i]?.text}</span>
              {segments.picked === i && <span className="slab-range is-steel g3-tile-edge" />}
            </span>
          ))
        ) : segments ? (
          Array.from({ length: segments.count }, (_, i) => (
            <span key={i} className="slab g2-slab" style={{ left: i * (segW + SEGMENT_GAP), width: segW, top: trackTop, height: S.track }} aria-hidden="true">
              {segments.picked === i && (
                <span
                  className="slab-range is-steel g2-capsule"
                  style={{ left: 4, right: 4, top: (S.track - S.capsule) / 2, height: S.capsule }}
                />
              )}
            </span>
          ))
        ) : (
          <span className="slab g2-slab" style={{ left: 0, right: 0, top: trackTop, height: S.track }} aria-hidden="true" />
        )}
        {range && (
          <span
            className="slab-range g2-capsule"
            style={{ left: px(range[0]) - S.capsule / 2, width: px(range[1]) - px(range[0]) + S.capsule, top: capTop, height: S.capsule }}
            aria-hidden="true"
          />
        )}
        {marks.length > 0 &&
          markPlaces(marks, px, MARK_GAP).map((at, i) => (
            <span
              key={i}
              className={`g2-mark ${inRange(marks[i]) ? "is-in" : ""}`}
              style={{ left: at - markW / 2, width: markW, top: cy - markH / 2, height: markH }}
              aria-hidden="true"
            />
          ))}
        {children?.(x)}
        {range && (
          <>
            <span
              className="g2-range-body"
              style={{ left: x(range[0]), width: `calc(${x(range[1])} - ${x(range[0])})` }}
              role="slider"
              tabIndex={0}
              aria-label="Move your range"
              aria-valuemin={min}
              aria-valuemax={max}
              aria-valuenow={(range[0] + range[1]) / 2}
              aria-valuetext={`${n(range[0])}${unit} to ${n(range[1])}${unit}`}
              onPointerDown={down("body")}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              onKeyDown={keys("body")}
            />
            {(["low", "high"] as const).map((part) => (
              <span
                key={part}
                className="g2-knob-hit"
                style={{ left: x(part === "low" ? range[0] : range[1]) }}
                role="slider"
                tabIndex={0}
                aria-label={part === "low" ? "Low" : "High"}
                aria-valuemin={min}
                aria-valuemax={max}
                aria-valuenow={part === "low" ? range[0] : range[1]}
                aria-valuetext={`${n(part === "low" ? range[0] : range[1])}${unit}`}
                onPointerDown={down(part)}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={up}
                onKeyDown={keys(part)}
              >
                <span className="g2-knob" style={{ width: S.knob, height: S.knob }} aria-hidden="true" />
              </span>
            ))}
          </>
        )}
        {gapFrom && gapLabel && (
          <span
            className={`g2-gap ${result !== null && range && result < range[0] ? "is-below" : "is-above"}`}
            style={{ left: x(gapFrom[0]), width: `calc(${x(gapFrom[1])} - ${x(gapFrom[0])})` }}
          >
            <span className="g2-gap-label">{gapLabel}</span>
          </span>
        )}
        {lazy !== undefined && (
          <span className="g2-lazy" style={{ left: x(lazy), bottom: S.box - trackTop }} aria-hidden="true">
            <svg className="g2-lazy-sofa" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5.5 11V8.5a2.5 2.5 0 0 1 2.5-2.5h8a2.5 2.5 0 0 1 2.5 2.5V11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              <path d="M3 13a2 2 0 0 1 4 0v1.5h10V13a2 2 0 0 1 4 0v4.5H3z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
              <path d="M5.5 17.5V19M18.5 17.5V19" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
            <span className="g2-lazy-post" />
          </span>
        )}
        {balls.map((b, i) => {
          // Only a ball resting on the slab or the capsule casts a shadow there.
          const resting = places[i].lift <= raise + 0.5;
          return (
            <span
              key={b.key}
              className="g2-ball"
              style={{
                left: x(places[i].at),
                top: slabGround - S.ball,
                width: S.ball,
                height: S.ball,
                marginLeft: -S.ball / 2,
                ["--lift" as string]: `${places[i].lift}px`,
              }}
              aria-hidden="true"
            >
              {resting && (
                <span
                  className="slab-shadow g2-ball-shadow"
                  style={{ width: S.ball * 0.8, height: shadowH, left: S.ball * 0.1 + S.ball * 0.08, bottom: -shadowH / 2 + 1 }}
                />
              )}
              <span className="ball-skin g2-ball-skin" style={{ width: S.ball, height: S.ball }}>
                <BallSkin />
              </span>
              {b.label && <span className="g2-ball-label">{b.label}</span>}
            </span>
          );
        })}
      </div>
      {ticks.length > 0 && (
        <div className="g2-scale" aria-hidden="true">
          {(phone ? thinTicks(ticks, px) : ticks).map((t) => (
            <span key={t} className={edgeClass(frac(t))} style={{ left: x(t) }}>
              {n(t)}
              {unit}
            </span>
          ))}
        </div>
      )}
      {labels && !tiles && (
        // Pill names in a grid of equal columns (one per pill, same 6px gaps),
        // so a long name wraps and the row grows with it.
        <div className="g2-pill-names" style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }} aria-hidden="true">
          {labels.map((l) => (
            <span key={l.text}>{l.text}</span>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

// Phones (Hriday, 2026-11-19): at most four scale labels, never closer than
// 48px. Keeps every k-th tick, raising k until both hold.
export function thinTicks(ticks: number[], px: (v: number) => number, maxCount = 4, minGap = 48): number[] {
  if (ticks.length === 0) return ticks;
  for (let step = Math.ceil(ticks.length / maxCount); step <= ticks.length; step++) {
    const pick = ticks.filter((_, i) => i % step === 0);
    if (pick.every((t, i) => i === 0 || px(t) - px(pick[i - 1]) >= minGap)) return pick;
  }
  return ticks.slice(0, 1);
}

// End labels sit inside the rail's ends rather than hanging off them.
function edgeClass(f: number): string {
  return f <= 0.001 ? "is-start" : f >= 0.999 ? "is-end" : "";
}

// A rail split into equal named slabs you tap (page 1's quarters, page 4's
// sectors, page 8's clues). The picked one carries a steel capsule; never gold.
export function SegmentRail({
  names,
  picked,
  onPick,
  ball,
  room = 0,
}: {
  names: string[];
  picked: number | null;
  onPick: (i: number) => void;
  ball?: RailBall;
  // Room kept above the rail for a ball that may come (in balls), so the page
  // doesn't jump when it does; none on rails that never show one.
  room?: number;
}) {
  const count = names.length;
  return (
    <GuideRail
      min={0}
      max={count * 3}
      labels={names.map((text, i) => ({ at: i * 3 + 1.5, text }))}
      balls={ball ? [ball] : []}
      headroom={room}
      segments={{ count, picked }}
    >
      {(x) =>
        names.map((name, i) => (
          <button
            key={name}
            type="button"
            className={`g2-segment ${picked === i ? "is-picked" : ""}`}
            style={{ left: x(i * 3), width: `calc(${x(i * 3 + 3)} - ${x(i * 3)})` }}
            aria-pressed={picked === i}
            aria-label={name}
            onClick={() => onPick(i)}
          />
        ))
      }
    </GuideRail>
  );
}

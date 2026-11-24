import { type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fetchLeagueEvents, fetchPracticeCases } from "../../lib/api";
import { setMystery } from "../../lib/practice";
import { ALPHA, K, n, scoreMetric } from "../../lib/scoring";
import type { PracticeCard } from "../../lib/types";
import PracticeTile from "../practice/PracticeTile";
import GuideRail, { type Range, SegmentRail, useWidth } from "./GuideRail";
import { useSliderSizes } from "./GuideSvg";

// The interactive object on each guide page (v3, 2026-11-19). Wording approved
// by Hriday (vault: Areas/Guide v2 wording (for approval), "v3 restyle"). Each
// object is two pieces laid out by the page: a readout column on the right
// (.g2-side) and the slider or bars along the bottom (.g2-bottom), drawn with
// Home's slider materials (.slab, .slab-range, .ball-skin). Every score here comes
// from lib/scoring.ts, the tested mirror of the league's scoring.py; every
// made-up number says so on the page.

// ---------- Shared: the league's arithmetic written out ----------

// "100 − 8 = 92", "100 − 8 − 20 = 72", "100 − 30 − 100 = 0".
export function scoreSum(low: number, high: number, actual: number): { sum: string; floored: boolean; width: number; miss: number } {
  const width = high - low;
  const miss = actual < low ? low - actual : actual > high ? actual - high : 0;
  const widthCost = K * width;
  const missCost = ((K * 2) / ALPHA) * miss;
  const { base } = scoreMetric(low, high, actual, null);
  const parts = miss > 0 ? `100 − ${n(widthCost)} − ${n(missCost)}` : `100 − ${n(widthCost)}`;
  return { sum: `${parts} = ${n(base)}`, floored: widthCost + missCost > 100, width, miss };
}

// Sums never break inside ("100 − 8 = 92" stays on one line, Hriday
// 2026-11-19): every sum in a sentence is wrapped in a no-wrap span.
const NUM = String.raw`\(?−?\d[\d,]*(?:\.\d+)?%?\)?`;
const SUM = new RegExp(`(${NUM}(?: [−+÷×] ${NUM})+ = ${NUM})`);
export function keepSums(text: string): ReactNode[] {
  return text.split(SUM).map((part, i) => (i % 2 ? <span key={i} className="g2-nowrap">{part}</span> : part));
}

// A made-up note, in two places: beside the object, or (on a phone page that
// is short of room) on one line under the slider's scale. CSS shows one.
function MadeUpNote({ text, under = false }: { text: string; under?: boolean }) {
  return <p className={`g2-note ${under ? "g2-note-under" : "g2-note-side"}`}>{text}</p>;
}

const points = (v: number) => (n(v) === "1" ? "1 point" : `${n(v)} points`);
const minus = (text: string) => text.replace(/^-/, "−");

// A keyboard-and-pointer slider for one value on a bar (pages 2 and 3).
function useBarDrag(
  ref: RefObject<HTMLElement | null>,
  min: number,
  max: number,
  step: number,
  onValue: (v: number) => void,
  onDragging?: (on: boolean) => void
) {
  const dragging = useRef(false);
  const toValue = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width === 0) return min;
    const v = min + ((clientX - r.left) / r.width) * (max - min);
    return Math.min(max, Math.max(min, Math.round(v / step) * step));
  };
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragging.current = true;
      onDragging?.(true);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (dragging.current) onValue(toValue(e.clientX));
    },
    onPointerUp: () => {
      dragging.current = false;
      onDragging?.(false);
    },
    keys: (value: number) => (e: KeyboardEvent<HTMLElement>) => {
      const delta =
        e.key === "ArrowRight" || e.key === "ArrowUp"
          ? step
          : e.key === "ArrowLeft" || e.key === "ArrowDown"
            ? -step
            : e.key === "PageUp"
              ? step * 10
              : e.key === "PageDown"
                ? -step * 10
                : 0;
      if (!delta) return;
      e.preventDefault();
      e.stopPropagation();
      onValue(Math.min(max, Math.max(min, value + delta)));
    },
  };
}

// ---------- Page 1: four quarters, tap one to see when results come out ----------

// The rail is one year from April, in months (0 to 12), split into four equal
// quarters. The ball lands on results day: the last quarter's results come in
// May, so its ball lands in the next year's first quarter.
export const QUARTERS = [
  { label: "Apr to Jun", results: 4.5, text: "Apr to Jun: results due by mid August." },
  { label: "Jul to Sep", results: 7.5, text: "Jul to Sep: results due by mid November." },
  { label: "Oct to Dec", results: 10.5, text: "Oct to Dec: results due by mid February." },
  { label: "Jan to Mar", results: 2, text: "Jan to Mar: results due by the end of May." },
];

export function QuartersObject() {
  const [picked, setPicked] = useState<number | null>(null);
  const q = picked === null ? null : QUARTERS[picked];
  return (
    <>
      <div className="g2-side">
        <p className="g2-prompt">Choose a quarter to see when its results are due.</p>
        <p className="g2-big g2-answer-big" aria-live="polite">
          {q ? q.text : ""}
        </p>
        <p className="g2-note">The financial year here runs from April to March, as it does for most Indian companies.</p>
      </div>
      <div className="g2-bottom">
        <SegmentRail
          names={QUARTERS.map((item) => item.label)}
          picked={picked}
          onPick={setPicked}
          ball={q ? { key: picked as number, value: q.results, label: "Results day" } : undefined}
          room={1.7}
        />
      </div>
    </>
  );
}

// ---------- Page 2: revenue growth from two real numbers ----------

export const MARUTI_LAST = 42344;
export const MARUTI_NOW = 53356;
const BAR_MAX = 70000;
const crore = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")} cr`;

export function growthSum(now: number, last: number): string {
  const pct = ((now - last) / last) * 100;
  const f = (v: number) => Math.round(v).toLocaleString("en-IN");
  return `(${f(now)} − ${f(last)}) ÷ ${f(last)} = ${minus(pct.toFixed(1))}%`;
}

// Desktop: the sum stays on one line, shrunk to fit its column. Phones: it may
// wrap, but only before "=".
function useOneLine(text: string) {
  const ref = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = "";
      let phone = false;
      try {
        phone = window.matchMedia("(max-width: 640px)").matches;
      } catch {
        phone = false;
      }
      if (phone || el.clientWidth === 0) return;
      const max = parseFloat(getComputedStyle(el).fontSize);
      if (el.scrollWidth > el.clientWidth) el.style.fontSize = `${Math.floor((max * el.clientWidth) / el.scrollWidth)}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [text]);
  return ref;
}

export function RevenueObject() {
  const [now, setNow] = useState(MARUTI_NOW);
  const [dragging, setDragging] = useState(false);
  const S = useSliderSizes();
  const barsRef = useRef<HTMLDivElement>(null);
  const drag = useBarDrag(barsRef, 1000, BAR_MAX, 100, setNow, setDragging);
  const madeUp = now !== MARUTI_NOW;
  const sum = growthSum(now, MARUTI_LAST);
  const [before, after] = sum.split(" = ");
  const sumRef = useOneLine(sum);
  const pct = (v: number) => `${(v / BAR_MAX) * 100}%`;
  // A bar: Home's slab, with a steel capsule as long as the revenue (last
  // year's a shade darker). Gold stays for your range.
  const bar = (v: number, kind: "last" | "now") => (
    <>
      <span className="slab g2-slab" style={{ left: 0, right: 0, top: (S.box - S.track) / 2, height: S.track }} aria-hidden="true" />
      <span
        className={`slab-range is-steel g2-capsule ${kind === "last" ? "tone-2" : ""}`}
        style={{ left: 0, width: `max(${S.capsule}px, ${pct(v)})`, top: (S.box - S.capsule) / 2, height: S.capsule }}
        aria-hidden="true"
      />
    </>
  );
  return (
    <>
      <div className="g2-side">
        <p className="g2-prompt">Drag this year's bar to try other figures.</p>
        <p className="g2-big g2-sum g2-one-line" ref={sumRef} aria-live="polite">
          <span className="g2-nowrap">{before}</span> <span className="g2-nowrap">= {after}</span>
        </p>
        {madeUp && (
          <button type="button" className="btn btn-secondary" onClick={() => setNow(MARUTI_NOW)}>
            Show the real figure
          </button>
        )}
      </div>
      <div className="g2-bottom">
        <div className="g2-bars" ref={barsRef}>
          <div className="g2-bar-row">
            <span className="g2-bar-label">
              Jul to Sep 2025 <strong>{crore(MARUTI_LAST)}</strong>
            </span>
            <div className="g2-bar-draw" style={{ height: S.box }}>
              {bar(MARUTI_LAST, "last")}
            </div>
          </div>
          <div className="g2-bar-row">
            <span className="g2-bar-label">
              Jul to Sep 2026 <strong>{crore(now)}</strong>
              {madeUp && <span className="g2-made-up"> made-up example</span>}
            </span>
            <div className={`g2-bar-draw ${dragging ? "is-dragging" : ""}`} style={{ height: S.box }}>
              {bar(now, "now")}
              <span
                className="g2-knob-hit"
                style={{ left: `calc(${pct(now)} - ${S.capsule / 2}px)` }}
                role="slider"
                tabIndex={0}
                aria-label="This year's revenue"
                aria-valuemin={1000}
                aria-valuemax={BAR_MAX}
                aria-valuenow={now}
                aria-valuetext={crore(now)}
                onPointerDown={drag.onPointerDown}
                onPointerMove={drag.onPointerMove}
                onPointerUp={drag.onPointerUp}
                onPointerCancel={drag.onPointerUp}
                onKeyDown={drag.keys(now)}
              >
                <span className="g2-knob" style={{ width: S.knob, height: S.knob }} aria-hidden="true" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------- Page 3: margin, out of every ₹100 ----------

// Made-up cost split (the page says so), in the ratio 55 : 12 : 15.
export function marginSplit(leftOver: number): { materials: number; staff: number; other: number; left: number } {
  const costs = 100 - leftOver;
  const materials = Math.round((costs * 55) / 82);
  const staff = Math.round((costs * 12) / 82);
  return { materials, staff, other: costs - materials - staff, left: leftOver };
}

const SPLIT_GAP = 6;
// The four parts as steel capsules in four tones (darkest = materials,
// brightest = left over); gold stays for your range.
const SPLIT_TONE: Record<string, string> = { materials: "tone-4", staff: "tone-3", other: "tone-2", left: "" };

export function MarginObject() {
  const [left, setLeft] = useState(18);
  const [dragging, setDragging] = useState(false);
  const S = useSliderSizes();
  const [barRef, width] = useWidth<HTMLDivElement>();
  // The knob sits where costs end, so its value is 100 minus what's left.
  const drag = useBarDrag(barRef, 40, 100, 1, (costsEnd) => setLeft(100 - costsEnd), setDragging);
  const s = marginSplit(left);
  const parts = [
    { key: "materials", name: "Materials", v: s.materials },
    { key: "staff", name: "Staff", v: s.staff },
    { key: "other", name: "Other costs", v: s.other },
    { key: "left", name: "Left over", v: s.left },
  ];
  // Separate capsules with 6px gaps, widths in proportion to the rupees.
  const usable = Math.max(0, width - SPLIT_GAP * 3);
  let cursor = 0;
  const pills = parts.map((p) => {
    const w = (p.v / 100) * usable;
    const pill = { ...p, x: cursor, w };
    cursor += w + (p.v > 0 ? SPLIT_GAP : 0);
    return pill;
  });
  const knobX = pills[3].x - SPLIT_GAP / 2;
  const note = "The cost split is a made-up example. Marico's actual margin was 18.2%.";
  return (
    <>
      <div className="g2-side">
        <p className="g2-prompt">Drag the divider to change the costs.</p>
        <p className="g2-big g2-answer-big" aria-live="polite">
          Left over: ₹{left} of ₹100, so the margin is {left}%.
        </p>
        <MadeUpNote text={note} />
      </div>
      <div className="g2-bottom">
        <div className={`g2-split ${dragging ? "is-dragging" : ""}`} ref={barRef} style={{ height: S.box }}>
          <span className="slab g2-slab" style={{ left: 0, right: 0, top: (S.box - S.track) / 2, height: S.track }} aria-hidden="true" />
          {pills.map((p) =>
            p.w > 0 ? (
              <span
                key={p.key}
                className={`slab-range is-steel g2-capsule ${SPLIT_TONE[p.key]}`}
                style={{ left: p.x, width: Math.max(p.w, S.capsule), top: (S.box - S.capsule) / 2, height: S.capsule }}
                aria-hidden="true"
              />
            ) : null
          )}
          <span
            className="g2-knob-hit"
            style={{ left: knobX }}
            role="slider"
            tabIndex={0}
            aria-label="Where costs end"
            aria-valuemin={40}
            aria-valuemax={100}
            aria-valuenow={100 - left}
            aria-valuetext={`Left over: ₹${left}`}
            onPointerDown={drag.onPointerDown}
            onPointerMove={drag.onPointerMove}
            onPointerUp={drag.onPointerUp}
            onPointerCancel={drag.onPointerUp}
            onKeyDown={drag.keys(100 - left)}
          >
            <span className="g2-knob" style={{ width: S.knob, height: S.knob }} aria-hidden="true" />
          </span>
        </div>
        <MadeUpNote under text={note} />
        <ul className="g2-legend">
          {parts.map((p) => (
            <li key={p.key}>
              <span className={`slab-range is-steel g2-swatch ${SPLIT_TONE[p.key]}`} aria-hidden="true" />
              {p.name} <strong>₹{p.v}</strong>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

// ---------- Page 4: each sector's number ----------

// The approved plain lines (2026-11-18) and their clue lines (2026-11-19).
export const SECTORS = [
  {
    name: "Cement",
    line: "How many more tonnes of cement it sold than in the same three months last year.",
    clue: "The government publishes how much cement India made each month, a good hint for the quarter.",
  },
  {
    name: "Autos",
    line: "How many more vehicles it sold, in India and abroad, than in the same three months last year.",
    clue: "Car and tractor makers publish their sales every month, so most of the quarter is known before results day.",
  },
  {
    name: "Everyday goods",
    line: "How much more product it sold in India than in the same three months last year, leaving out price rises.",
    clue: "Read what the company said last quarter about demand in villages and cities.",
  },
  {
    name: "IT services",
    line: "How much more money it made than in the same three months last year, as if exchange rates hadn't changed.",
    clue: "IT companies earn mostly in dollars. This number removes the effect of the rupee's movements, so read what they said about new contracts.",
  },
];

export function SectorObject() {
  const [picked, setPicked] = useState(0);
  const s = SECTORS[picked];
  return (
    <>
      <div className="g2-side" aria-live="polite">
        <p className="g2-lead">{s.line}</p>
        <p className="g2-answer">{s.clue}</p>
      </div>
      <div className="g2-bottom">
        <SegmentRail names={SECTORS.map((x) => x.name)} picked={picked} onPick={setPicked} />
      </div>
    </>
  );
}

// ---------- Page 5: set a range, drop 10 made-up results ----------

// Whole numbers, so equal results stack straight up like a dot plot (at most
// three high) and neighbours sit side by side even on a phone (5% to 16% is
// 11 points: at least 31px a point at 390px). 7 land in the starting range.
export const DROP_RESULTS = [6, 8, 9, 9, 10, 10, 10, 11, 13, 15];
export const DROP_START: Range = [8, 12];

export function caught(range: Range, results = DROP_RESULTS): number {
  return results.filter((v) => v >= range[0] && v <= range[1]).length;
}

// What to do about it, against the 80% target (v3 wording, factual).
export function caughtLine(count: number): string {
  if (count <= 5) return "For 80%, widen it.";
  if (count <= 7) return "For 80%, widen it slightly.";
  if (count === 8) return "This matches the 80% target.";
  if (count === 9) return "For 80%, narrow it slightly. Extra width costs points.";
  return "For 80%, narrow it. Extra width costs points.";
}

export function DropObject() {
  const [range, setRange] = useState<Range>(DROP_START);
  const [dropped, setDropped] = useState(false);
  const [round, setRound] = useState(0);
  const count = caught(range);

  function drop() {
    if (dropped) {
      setDropped(false);
      setRound((r) => r + 1);
      requestAnimationFrame(() => requestAnimationFrame(() => setDropped(true)));
    } else {
      setDropped(true);
    }
  }

  return (
    <>
      <div className="g2-side">
        <p className="g2-prompt">Set your range, then test it against 10 results.</p>
        <div className="g2-readout">
          <button type="button" className="btn btn-secondary" onClick={drop}>
            {dropped ? "Test it again" : "Test this range"}
          </button>
          <div className="g2-count" aria-live="polite">
            {dropped && (
              <>
                <p className="g2-stat">
                  <strong>{count} of 10</strong> results fall inside your range.
                </p>
                <p className="g2-answer">{caughtLine(count)}</p>
              </>
            )}
          </div>
        </div>
        <MadeUpNote text="The 10 results are a made-up example." />
      </div>
      <div className="g2-bottom">
        <GuideRail
          min={5}
          max={16}
          ticks={[6, 8, 10, 12, 14, 16]}
          range={range}
          onRange={setRange}
          balls={DROP_RESULTS.map((v, i) => ({ key: `${round}-${i}`, value: v, delay: i * 90 }))}
          dropped={dropped}
          headroom={3}
        />
        <MadeUpNote under text="The 10 results are a made-up example." />
      </div>
    </>
  );
}

// ---------- Page 6: the score, live ----------

export const MARICO_MARGIN = 18.2;

export function ScoreObject() {
  const [range, setRange] = useState<Range>([16, 20]);
  const s = scoreSum(range[0], range[1], MARICO_MARGIN);
  return (
    <>
      <div className="g2-side" aria-live="polite">
        <p className="g2-prompt">Drag your range to see the score change.</p>
        <p className="g2-big g2-sum g2-nowrap">{s.sum}</p>
        <p className="g2-answer">
          Width: {points(s.width)}. Missed by: {points(s.miss)}.
        </p>
        {s.floored && <p className="g2-answer">Scores cannot go below 0.</p>}
      </div>
      <div className="g2-bottom">
        <GuideRail
          min={10}
          max={26}
          ticks={[10, 14, 18, 22, 26]}
          range={range}
          onRange={setRange}
          balls={[{ key: "result", value: MARICO_MARGIN }]}
          gapLabel="−20 per point"
        />
      </div>
    </>
  );
}

// ---------- Page 7: the lazy guess ----------

export const MARUTI_LAZY = 13.1;
export const MARUTI_GROWTH = 26;

export function lazyLines(range: Range, actual = MARUTI_GROWTH, lazy = MARUTI_LAZY): string[] {
  const middle = (range[0] + range[1]) / 2;
  const { beatLazy } = scoreMetric(range[0], range[1], actual, lazy);
  const tie = Math.abs(Math.abs(middle - actual) - Math.abs(lazy - actual)) < 1e-9;
  return [
    `Your middle: ${n(middle)}%, ${points(Math.abs(middle - actual))} from the result.`,
    `Lazy guess: ${n(lazy)}%, ${points(Math.abs(lazy - actual))} from the result.`,
    beatLazy ? "Your middle is closer: +10 bonus points." : tie ? "Equally close: no bonus." : "The lazy guess is closer: no bonus.",
  ];
}

export function LazyObject() {
  const [range, setRange] = useState<Range>([20, 28]);
  const [mine, theirs, verdict] = lazyLines(range);
  return (
    <>
      <div className="g2-side" aria-live="polite">
        <p className="g2-answer">{mine}</p>
        <p className="g2-answer">{theirs}</p>
        <p className="g2-big">{verdict}</p>
      </div>
      <div className="g2-bottom">
        <GuideRail
          min={5}
          max={35}
          ticks={[5, 10, 15, 20, 25, 30, 35]}
          range={range}
          onRange={setRange}
          balls={[{ key: "result", value: MARUTI_GROWTH }]}
          lazy={MARUTI_LAZY}
        />
      </div>
    </>
  );
}

// ---------- Page 8: the best clues, and where they are on Stackly ----------

export const CLUES = [
  { clue: "The same quarter last year.", where: "The last 8 quarters, on every company page.", research: false },
  { clue: "Last quarter's results.", where: "The last 8 quarters, on every company page.", research: false },
  { clue: "What the company's management said.", where: "Filings and results commentary, in", research: true },
  { clue: "Monthly sales and input costs, such as palm oil, or iron ore for steel makers.", where: "News and price charts, in", research: true },
];

// Stop names under the rail (Hriday, 2026-11-19). Stop 1 starts selected.
export const CLUE_STOPS = ["Last year", "Last quarter", "Managers", "Monthly data"];

export function CluesObject({ onOpenResearch }: { onOpenResearch?: () => void }) {
  const [picked, setPicked] = useState(0);
  const c = CLUES[picked];
  return (
    <>
      <div className="g2-side" aria-live="polite">
        <p className="g2-lead">{c.clue}</p>
        <p className="g2-answer">
          Where: {c.where}
          {c.research && (
            <>
              {" "}
              <button type="button" className="link-button g2-link" onClick={onOpenResearch}>
                Research
              </button>
              .
            </>
          )}
        </p>
      </div>
      <div className="g2-bottom">
        <SegmentRail names={CLUE_STOPS} picked={picked} onPick={setPicked} />
      </div>
    </>
  );
}

// ---------- Page 9: check yourself ----------

interface Question {
  ask: string;
  options: string[];
  correct: number;
  explain: string;
  rail: { min: number; max: number; ticks: number[]; range?: Range; lazy?: number; result: number };
}

// Answers and every number in them are worked out by lib/scoring.ts.
export function quizQuestions(): Question[] {
  const a = scoreSum(10, 14, 12);
  const b = scoreSum(11, 12.5, 12);
  const q1Right = scoreMetric(11, 12.5, 12, null).base > scoreMetric(10, 14, 12, null).base ? 1 : 0;
  const q2 = scoreSum(13, 15, 12);
  const q2Score = n(scoreMetric(13, 15, 12, null).base);
  const q3 = scoreMetric(10, 14, 12, 9);
  return [
    {
      ask: "The result is 12%. Which range scores more?",
      options: ["A: 10% to 14%", "B: 11% to 12.5%"],
      correct: q1Right,
      explain: `B. It is ${n(b.width)} points wide and contains 12%: ${b.sum}. A is ${n(a.width)} points wide: ${a.sum}.`,
      rail: { min: 8, max: 16, ticks: [8, 10, 12, 14, 16], result: 12 },
    },
    {
      ask: "The result is 12%. Your range is 13% to 15%. What is your score?",
      options: ["96", "76", "0"],
      correct: ["96", "76", "0"].indexOf(q2Score),
      explain: `${q2Score}. Width costs ${n(K * q2.width)}, and you missed by ${points(q2.miss)}, which costs ${n(((K * 2) / ALPHA) * q2.miss)}: ${q2.sum}.`,
      rail: { min: 8, max: 18, ticks: [8, 10, 12, 14, 16, 18], range: [13, 15], result: 12 },
    },
    {
      ask: "Last year it was 9%. Your range is 10% to 14% and the result is 12%. Do you get the bonus?",
      options: ["Yes", "No"],
      correct: q3.beatLazy ? 0 : 1,
      explain: `${q3.beatLazy ? "Yes" : "No"}. Your middle, 12%, is ${points(0)} from the result; the lazy guess is ${points(3)} away: ${n(q3.base)} + 10 = ${n(q3.points)}.`,
      rail: { min: 6, max: 16, ticks: [6, 8, 10, 12, 14, 16], range: [10, 14], lazy: 9, result: 12 },
    },
  ];
}

export function QuizObject() {
  const questions = quizQuestions();
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<number | null>(null);
  const q = questions[index];
  // Question 1 shows the range you picked once you answer.
  const shownRange: Range | undefined = q.rail.range ?? (answer === null ? undefined : answer === 0 ? [10, 14] : [11, 12.5]);
  return (
    <>
      <div className="g2-side">
        <p className="g2-lead">{q.ask}</p>
        <div className="g2-options" role="group" aria-label="Answers">
          {q.options.map((opt, i) => (
            <button
              key={opt}
              type="button"
              className={`btn btn-secondary g2-option ${answer === i ? "is-picked" : ""}`}
              aria-pressed={answer === i}
              onClick={() => setAnswer(i)}
            >
              {opt}
            </button>
          ))}
        </div>
        <p className="g2-answer" aria-live="polite">
          {answer !== null && (
            <>
              {answer === q.correct ? "Correct." : "Incorrect."} {keepSums(q.explain)}
            </>
          )}
        </p>
        <div className="g2-readout">
          {answer !== null && index < questions.length - 1 && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setIndex(index + 1);
                setAnswer(null);
              }}
            >
              Next question
            </button>
          )}
          <MadeUpNote text="The numbers here are a made-up example." />
        </div>
      </div>
      <div className="g2-bottom">
        <GuideRail
          key={index}
          min={q.rail.min}
          max={q.rail.max}
          ticks={q.rail.ticks}
          range={shownRange}
          lazy={q.rail.lazy}
          balls={[{ key: `q${index}`, value: q.rail.result }]}
        />
        <MadeUpNote under text="The numbers here are a made-up example." />
      </div>
    </>
  );
}

// ---------- Page 10: your turn ----------

// Three practice companies in Mystery mode, as Home's "Practice while you
// wait" shows them (PracticeTile, three picked at random), without Home's
// 12px "Practice" badge: the guide keeps text at 14px or more, and the
// badge is Home-only (2026-11-18).
function usePracticePicks(count: number): PracticeCard[] | null {
  const [cards, setCards] = useState<PracticeCard[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchPracticeCases(true)
      .then((all) => {
        if (cancelled) return;
        const pool = [...all];
        const picked: PracticeCard[] = [];
        while (picked.length < count && pool.length) picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
        setCards(picked);
      })
      .catch(() => !cancelled && setCards([]));
    return () => {
      cancelled = true;
    };
  }, [count]);
  return cards;
}

export function YourTurnObject() {
  const [anyOpen, setAnyOpen] = useState(false);
  const cards = usePracticePicks(3);
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
    <>
      <div className="g2-side g2-actions">
        {/* A random practice company, with Mystery mode on. */}
        <a className="btn btn-primary" href="#/practice?surprise=1" onClick={() => setMystery(true)}>
          Start a practice forecast
        </a>
        <a className="btn btn-secondary" href="#/practice">
          Choose a practice company
        </a>
        {anyOpen && (
          <a className="btn btn-secondary" href="#/league">
            Forecast an open company
          </a>
        )}
      </div>
      {cards && cards.length > 0 && (
        <div className="g2-bottom g2-practice">
          <ul className="company-grid practice-grid">
            {cards.map((c, i) => (
              <PracticeTile key={c.code} card={c} index={i} scrub={false} />
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../../hooks/useOnceVisible";
import SiteFooter from "../SiteFooter";
import GuideObject, { type ObjectView } from "./GuideObject";
import {
  DOTS,
  LAZY,
  LazyDemo,
  QuarterPicker,
  type Range,
  RangeCatch,
  RESULT,
  ScoreDemo,
  SectorPicker,
  START_RANGES,
  TryOne,
} from "./GuidePieces";

// The guide (#/learn, 2026-11-18, wording approved). Desktop: the gold range
// and ball pinned on the left, showing exactly what the step in focus shows
// (live while its range is dragged), while the step cards scroll past on the
// right with a gold cord whose knot glides to the step in focus. Phones: the
// object sits small and sticky at the top. Reduced motion: nothing glides;
// the object and the cord change in place.

interface Step {
  title: string;
  icon: ReactNode;
  body: ReactNode;
  piece: (ctx: PieceContext) => ReactNode;
}

type Ranges = Record<number, Range>;

// The cards' interactive state, lifted here so the object can follow it.
interface PieceContext {
  ranges: Ranges;
  setRange: (step: number, value: Range) => void;
  quarter: number | null;
  setQuarter: (i: number) => void;
  sector: number | null;
  setSector: (i: number) => void;
}

const icon = (paths: ReactNode) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    {paths}
  </svg>
);

const S = { stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const STEPS: Step[] = [
  {
    title: "Companies report every three months",
    // A year split into four.
    icon: icon(
      <>
        <rect x="3.5" y="3.5" width="17" height="17" rx="3" {...S} />
        <path d="M12 3.5v17M3.5 12h17" {...S} />
        <path d="M6.5 6.8h2.5" {...S} />
      </>,
    ),
    body: (
      <p>
        A year has four quarters. After each one, a company shares its results: how much it sold and how much it
        kept. In India, listed companies must do this within 45 days of a quarter ending (60 days for the last
        quarter of their year).
      </p>
    ),
    piece: (c) => <QuarterPicker picked={c.quarter} setPicked={c.setQuarter} />,
  },
  {
    title: "You forecast three numbers",
    // Three bars.
    icon: icon(<path d="M6 19v-6M12 19V6M18 19v-9" {...S} strokeWidth={2.4} />),
    body: (
      <ul className="guide-list">
        <li>
          <strong>Revenue growth:</strong> how much more (or less) the company sold than in the same quarter last
          year.
        </li>
        <li>
          <strong>Operating margin:</strong> out of every ₹100 it sold, how much was left after paying for
          materials, staff and other running costs.
        </li>
        <li>
          <strong>One sector number:</strong> the number that matters most in its industry. Not every company has
          one.
        </li>
      </ul>
    ),
    piece: (c) => <SectorPicker picked={c.sector} setPicked={c.setSector} />,
  },
  {
    title: "Give a range, not one number",
    // A bracket.
    icon: icon(<path d="M8 4H5v16h3M16 4h3v16h-3M9 12h6" {...S} />),
    body: (
      <p>
        Nobody knows the exact number before it's out. So you pick a low and a high. Aim for a range you'd catch 8
        times out of 10. Too narrow and you'll often miss. Too wide and you lose points for width.
      </p>
    ),
    piece: (c) => <RangeCatch value={c.ranges[2]} onChange={(v) => c.setRange(2, v)} />,
  },
  {
    title: "How your score works",
    // A target.
    icon: icon(
      <>
        <circle cx="12" cy="12" r="8.5" {...S} />
        <circle cx="12" cy="12" r="4.5" {...S} />
        <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      </>,
    ),
    body: (
      <p>
        You start with 100. Each percentage point of width costs 2 points. If the real number lands outside your
        range, each point you missed by costs 20 more. Scores can't go below 0.
      </p>
    ),
    piece: (c) => <ScoreDemo value={c.ranges[3]} onChange={(v) => c.setRange(3, v)} />,
  },
  {
    title: "Beat the lazy guess",
    // A sofa.
    icon: icon(
      <>
        <path d="M5.5 11V8.5a2.5 2.5 0 0 1 2.5-2.5h8a2.5 2.5 0 0 1 2.5 2.5V11" {...S} />
        <path d="M3 13a2 2 0 0 1 4 0v1.5h10V13a2 2 0 0 1 4 0v4.5H3z" {...S} />
        <path d="M5.5 17.5V19M18.5 17.5V19" {...S} />
      </>,
    ),
    body: (
      <p>
        The lazy guess just says: same as last year. If the middle of your range is closer to the real number than
        the lazy guess, you get 10 bonus points. If it's just as close, no bonus.
      </p>
    ),
    piece: (c) => <LazyDemo value={c.ranges[4]} onChange={(v) => c.setRange(4, v)} />,
  },
  {
    title: "Try one",
    // A play arrow.
    icon: icon(
      <>
        <circle cx="12" cy="12" r="8.5" {...S} />
        <path d="M10 8.5v7l5.5-3.5z" {...S} />
      </>,
    ),
    body: (
      <p>
        Practice on a past quarter. The results are already known, so you see your score straight away. Practice
        scores don't count in the league.
      </p>
    ),
    piece: () => <TryOne />,
  },
];

// What the object draws for each step: the same pieces as that step's card.
// Step 1: the four quarters, the newest (or the one tapped) glowing as
// results day. Step 2: three chips, the sector one lit once a sector is
// picked in the card.
function objectView(step: number, c: PieceContext, sectorOpen: boolean): ObjectView {
  const view: ObjectView = {
    quarter: null,
    chips: false,
    sectorLit: false,
    ticks: step >= 2,
    range: null,
    dots: [],
    ball: null,
    lazy: null,
  };
  const ranges = c.ranges;
  if (step === 0) return { ...view, quarter: c.quarter ?? 3 };
  if (step === 1) return { ...view, chips: true, sectorLit: sectorOpen && c.sector !== null };
  if (step === 2) return { ...view, range: ranges[2], dots: DOTS };
  if (step === 3) return { ...view, range: ranges[3], ball: RESULT };
  // Step 5's example, which step 6 keeps as the whole picture.
  if (step >= 4) return { ...view, range: ranges[4], ball: RESULT, lazy: LAZY };
  return view;
}

// The step in focus: the card crossing a line 40% down the screen. At the
// top of the page the line starts at step 1 and moves down as you scroll
// until it reaches 40%, so step 1 is in focus on arrival even though the
// first few cards all sit above 40%.
const FOCUS_LINE = 0.4;

function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

export default function GuidePage() {
  const [active, setActive] = useState(0);
  // A card you click or drag in leads until scrolling moves the focus.
  const [touched, setTouched] = useState<number | null>(null);
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const [ranges, setRanges] = useState<Ranges>(START_RANGES);
  const [quarter, setQuarterState] = useState<number | null>(null);
  const [sector, setSectorState] = useState<number | null>(null);
  const [cordY, setCordY] = useState<number | null>(null);
  const [reduced] = useState(prefersReducedMotion);
  const colRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLLIElement | null)[]>([]);
  const lastActive = useRef(0);
  const focus = touched ?? active;

  useEffect(() => {
    let frame = 0;
    const pick = () => {
      frame = 0;
      const first = cardRefs.current[0];
      if (!first) return;
      const scroller = scrollerOf(first);
      const scrolled = scroller ? scroller.scrollTop : window.scrollY;
      const firstTop = first.getBoundingClientRect().top;
      const line = Math.min(window.innerHeight * FOCUS_LINE, firstTop + scrolled * 2 + 1);
      let next = 0;
      cardRefs.current.forEach((el, i) => {
        const r = el?.getBoundingClientRect();
        if (r && r.height > 0 && r.top <= line) next = i;
      });
      if (next !== lastActive.current) {
        lastActive.current = next;
        setActive(next);
        setTouched(null);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(pick);
    };
    pick();
    document.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      document.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // The knot sits beside the focused card's title, and follows when cards
  // open or close.
  useLayoutEffect(() => {
    const col = colRef.current;
    const measure = () => {
      const card = cardRefs.current[focus];
      const head = card?.querySelector<HTMLElement>(".guide-card-head");
      if (card && head) setCordY(card.offsetTop + head.offsetTop + head.offsetHeight / 2);
    };
    measure();
    if (!col || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(col);
    return () => observer.disconnect();
  }, [focus, open]);

  function toggle(i: number) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  const ctx: PieceContext = {
    ranges,
    setRange: (step, value) => {
      setRanges((prev) => ({ ...prev, [step]: value }));
      setTouched(step);
    },
    quarter,
    setQuarter: (i) => {
      setQuarterState(i);
      setTouched(0);
    },
    sector,
    setSector: (i) => {
      setSectorState(i);
      setTouched(1);
    },
  };

  return (
    <div className={`page guide-page ${reduced ? "is-still" : ""}`}>
      <header className="guide-head">
        <h1 className="page-title guide-title">How to play</h1>
        <p className="guide-lede">Six short steps: what results are, how ranges work and how you score.</p>
      </header>
      <div className="guide-layout">
        <div className="guide-object-col">
          <div className="glass guide-object-pin">
            <GuideObject view={objectView(focus, ctx, open.has(1))} step={focus} />
          </div>
        </div>
        <div className="guide-steps-col" ref={colRef}>
          {cordY !== null && (
            <span className="guide-cord" aria-hidden="true" style={{ ["--cord-y" as string]: `${cordY}px` }}>
              <span className="guide-cord-line" />
              <span className="guide-knot" />
            </span>
          )}
          <ol className="guide-steps">
            {STEPS.map((step, i) => {
              const isOpen = open.has(i);
              const id = `guide-step-${i + 1}`;
              return (
                <li
                  key={step.title}
                  className={`glass guide-card ${i === focus ? "is-focus" : ""} ${isOpen ? "is-open" : ""}`}
                  data-i={i}
                  ref={(el) => {
                    cardRefs.current[i] = el;
                  }}
                  onPointerDown={() => setTouched(i)}
                >
                  <h2 className="guide-card-heading">
                    <button
                      type="button"
                      className="guide-card-head"
                      aria-expanded={isOpen}
                      aria-controls={`${id}-detail`}
                      id={`${id}-title`}
                      onClick={() => {
                        toggle(i);
                        setTouched(i);
                      }}
                    >
                      <span className="guide-card-icon">{step.icon}</span>
                      <span className="guide-card-num" aria-hidden="true">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="guide-card-title">{step.title}</span>
                      <span className="guide-card-plus" aria-hidden="true" />
                    </button>
                  </h2>
                  <div
                    className="guide-card-detail"
                    id={`${id}-detail`}
                    role="region"
                    aria-labelledby={`${id}-title`}
                    hidden={!isOpen}
                  >
                    <div className="guide-card-body">
                      {step.body}
                      {step.piece(ctx)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}

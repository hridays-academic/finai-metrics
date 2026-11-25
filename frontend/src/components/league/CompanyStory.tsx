import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { EventDetail, ResearchHistory, SectorExplainer } from "../../lib/types";
import { formatDay, leagueSeries, previousQuarterEnds, quarterLabel, signedPct, withoutInsight } from "../../lib/leagueFormat";
import { fetchPriceHistory } from "../../lib/api";
import type { PricePoint } from "../../lib/types";
import LockCountdown from "./LockCountdown";
import QuarterSparkline from "./QuarterSparkline";
import { Equation } from "./SectorExplainer";
import { Grain, Guilloche } from "./CardArt";
import DifficultyEdge from "../DifficultyEdge";
import { useSlidingPill } from "../../hooks/useSlidingPill";
import { DIFFICULTY_LABEL, difficultyOf, fromProviderRows } from "../../lib/difficulty";

// The company page's introduction (2026-11-15, v3): a pinned section about
// seven screens tall. A thick 3D company card (CSS transforms, real HTML text
// on its faces, artwork in CardArt.tsx) turns continuously as you scroll,
// reaching a set angle at the middle of each chapter, and flips to its back
// for "Last year". In each chapter it also zooms towards what the text is
// about (FOCUS), and its light (a specular band and edge rims) follows its
// rotation, lit from the top left. The chapter
// text drifts up and cross-fades with the scroll position. Scroll position is
// eased (SMOOTH_MS) so wheel steps glide instead of jumping.
// Every word comes from the page already, except the five chapter labels.
// Reduced motion, or no sticky support: the chapters as a plain stacked list
// with the card flat. Scroll work touches transforms and opacity only.

// Practice (2026-11-18) reuses the story: its own back link, quarter names
// (Mystery mode's relative calendar), a share price already cut to the date
// and indexed (first week = 100), and revenue as an index.
export interface StoryPractice {
  backHref: string;
  backLabel: string;
  quarterName: (end: string) => string;
  prices: { date: string; index: number }[] | null;
  hideDates: boolean;
}

interface CompanyStoryProps {
  event: EventDetail;
  explainer: SectorExplainer | undefined;
  history: ResearchHistory | null;
  sectorName: string;
  hasForecast: boolean;
  onJumpToForm: () => void;
  practice?: StoryPractice;
}

// [rotateX, rotateY, rotateZ, scale] at the middle of each chapter. Chapter 2
// shows the back. LEAD_IN and LEAD_OUT are where the card comes from before
// chapter 1 and goes after chapter 5, so it never stops while you scroll.
// C3 (master plan): about half the old angles, so the card's words stay
// readable while it turns.
const POSES: [number, number, number, number][] = [
  [5, -12, 0, 1],
  [4, 174, 0, 1],
  [-4, 11, -1.5, 1],
  [7, -5, 2, 0.98],
  [3, 14, -1, 0.99],
  [2, 0, 0, 1.04],
];
const LEAD_IN: [number, number, number, number] = [9, -23, 1.5, 0.96];
const LEAD_OUT: [number, number, number, number] = [-2, 7, -1, 1.08];
const KEYS = [LEAD_IN, ...POSES, LEAD_OUT];

// How long the shown position takes to catch up with the scroll (time constant).
const SMOOTH_MS = 220;

// Per chapter, the point the card zooms towards ([x, y] as fractions of the
// card from its centre) and whether it zooms: 01 the name, 02 the numbers on
// the back, 03 the revenue line, 04 the results date and lock, 05 and 06 none.
const FOCUS: [number, number, number][] = [
  [-0.2, -0.02, 1],
  [0, 0.14, 1],
  [0.26, 0.04, 1],
  [-0.08, 0.36, 1],
  [0, 0, 0],
  [0, 0, 0],
];
// The share-price chapter (05): its steps appear one at a time as you
// scroll through it.
const PRICE_CHAPTER = 4;
const ZOOM = 0.12;
// The card's edge: planes every 2px between the faces (at +-10px), close
// enough that no gap shows even when the card is seen almost side-on.
const SLICES = [-9, -7, -5, -3, -1, 1, 3, 5, 7, 9];
// The card is laid out 1.2x its shown size and scaled down, so at the 1.12x
// zoom it is still at or below its laid-out size and its text stays sharp.
const BASE = 1 / 1.2;
const RAD = Math.PI / 180;

// How much a chapter's zoom applies at progress p: 1 around the chapter's
// middle, easing to 0 at its edges, so the card eases back between chapters.
export function zoomAt(p: number): { chapter: number; amount: number } {
  const n = POSES.length;
  const chapter = chapterAt(p, n);
  const d = Math.abs(clamp(p, 0, 1) * n - (chapter + 0.5));
  return { chapter, amount: FOCUS[chapter][2] * smooth(clamp(1 - d / 0.42)) };
}

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const smooth = (t: number) => t * t * (3 - 2 * t);

// Where the card is at story progress p (0..1). It reaches POSES[i] at the
// middle of chapter i and is always moving between them (never a flat hold).
export function poseAt(p: number): [number, number, number, number] {
  const f = clamp(p, 0, 1) * POSES.length + 0.5;
  const i = Math.min(Math.floor(f), KEYS.length - 2);
  const t = f - i;
  const e = 0.6 * t + 0.4 * smooth(t);
  return KEYS[i].map((v, k) => v + (KEYS[i + 1][k] - v) * e) as [number, number, number, number];
}

export function chapterAt(p: number, count = POSES.length): number {
  return Math.min(count - 1, Math.max(0, Math.floor(p * count)));
}

function scroller(): HTMLElement | null {
  return document.querySelector(".app-shell-content");
}

function canPin(): boolean {
  try {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return !reduced && typeof CSS !== "undefined" && CSS.supports("position", "sticky");
  } catch {
    return false;
  }
}

function yearAgo(iso: string): string {
  return `${String(Number(iso.slice(0, 4)) - 1).padStart(4, "0")}${iso.slice(4)}`;
}

function value(v: number | undefined, unit: string): string {
  if (v === undefined) return "N/A";
  return `${v.toFixed(1)}${unit === "%" ? "%" : ` ${unit}`}`;
}

export default function CompanyStory({
  event,
  explainer,
  history,
  sectorName,
  hasForecast,
  onJumpToForm,
  practice,
}: CompanyStoryProps) {
  const [pinned] = useState(canPin);
  const [chapter, setChapter] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const sheenRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const rimRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const shadowRef = useRef<HTMLDivElement>(null);
  const chapterRef = useRef(0);
  const stripRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);

  const scored = event.status === "scored";
  const labels = [
    "How it makes money",
    "Last year's numbers",
    "Where it's heading",
    "Your checklist",
    "Results and the share price",
    scored ? "How it turned out" : "Your turn",
  ];

  // The share price, at least 30 days old, for chapter 05. Its line draws in
  // the first time the chapter comes up.
  const [fetchedPrices, setPrices] = useState<{ points: PricePoint[]; asOf: string | null } | null>(null);
  const prices = practice
    ? practice.prices && {
        points: practice.prices.map((p) => ({ date: p.date, open: p.index, high: p.index, low: p.index, close: p.index, volume: null })),
        asOf: null,
      }
    : fetchedPrices;
  const symbol = event.company.provider_symbol;
  useEffect(() => {
    if (!symbol || practice) return;
    let cancelled = false;
    fetchPriceHistory(symbol)
      .then((r) => !cancelled && setPrices({ points: r.points.slice(-52), asOf: r.price_as_of }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [symbol]);
  const [priceSeen, setPriceSeen] = useState(false);
  useEffect(() => {
    if (chapter === PRICE_CHAPTER) setPriceSeen(true);
  }, [chapter]);

  // Progress through the pinned section, 0 at its top, 1 when it ends.
  const progress = useCallback((): number => {
    const section = sectionRef.current;
    const sticky = stickyRef.current;
    const box = scroller();
    if (!section || !sticky || !box) return 0;
    const top = sticky.getBoundingClientRect().top - section.getBoundingClientRect().top;
    const travel = section.offsetHeight - sticky.offsetHeight;
    return travel > 0 ? clamp(top / travel) : 0;
  }, []);

  const shown = useRef<number | null>(null);
  const chapterEls = useRef<(HTMLDivElement | null)[]>([]);
  const wordEls = useRef<(HTMLSpanElement | null)[]>([]);

  const render = useCallback((p: number) => {
    const [rx, ry, rz, s] = poseAt(p);
    const card = cardRef.current;
    const { chapter: fc, amount } = zoomAt(p);
    const z = 1 + ZOOM * amount;
    if (card) {
      // Pull the focus point halfway to the card's centre while zoomed.
      const pull = 0.5 * amount * BASE * z;
      const tx = -FOCUS[fc][0] * card.offsetWidth * pull;
      const ty = -FOCUS[fc][1] * card.offsetHeight * pull;
      card.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${(s * z * BASE).toFixed(4)})`;
    }
    // Light comes from the top left. The narrow specular band sweeps across
    // each face as it turns, brightest when the face looks at you; the rim on
    // the edge turned towards the light brightens.
    const sx = Math.sin(rx * RAD);
    const faces: [string, number][] = [
      ["front", ry],
      ["back", ry - 180],
    ];
    for (const [side, angle] of faces) {
      const sy = Math.sin(angle * RAD) * (side === "back" ? -1 : 1);
      const facing = Math.max(0, Math.cos(angle * RAD));
      const sheen = sheenRefs.current[side];
      if (sheen) {
        sheen.style.transform = `translateX(${((sy * 150 + sx * 40) / 2.2).toFixed(2)}%)`;
        sheen.style.opacity = (0.6 * facing).toFixed(3);
      }
      const rims = rimRefs.current;
      const set = (edge: string, v: number) => {
        const el = rims[`${side}-${edge}`];
        if (el) el.style.opacity = (v * facing).toFixed(3);
      };
      set("top", 0.4 + 0.4 * Math.max(0, sx));
      set("left", 0.25 + 0.65 * Math.max(0, sy));
      set("right", 0.08 + 0.3 * Math.max(0, -sy));
    }
    if (shadowRef.current) {
      const tilt = Math.abs(Math.cos(ry * RAD));
      shadowRef.current.style.transform = `scaleX(${0.55 + 0.45 * tilt}) scale(${(s * z).toFixed(4)})`;
      shadowRef.current.style.opacity = String(0.55 + 0.3 * tilt);
    }
    const n = POSES.length;
    for (let i = 0; i < n; i++) {
      // d: distance from this chapter's middle, in chapters (-0.5..0.5 inside it).
      // The first chapter is fully shown from the very top (before its
      // middle) and the last one stays shown to the end (after its middle).
      const raw = p * n - (i + 0.5);
      const d = i === 0 ? Math.max(raw, 0) : i === n - 1 ? Math.min(raw, 0) : raw;
      const el = chapterEls.current[i];
      if (el) {
        const vis = clamp((0.5 - Math.abs(d)) / 0.25);
        el.style.opacity = String(vis);
        el.style.transform = `translateY(${(-d * 72).toFixed(1)}px)`;
        el.style.visibility = vis > 0.01 ? "visible" : "hidden";
        if (i === PRICE_CHAPTER) {
          el.querySelectorAll<HTMLElement>(".chapter-steps > li").forEach((li, k) => {
            const on = clamp((d + 0.42 - k * 0.16) / 0.1);
            li.style.opacity = String(0.15 + 0.85 * on);
            li.style.transform = `translateX(${((1 - on) * 16).toFixed(1)}px)`;
          });
        }
      }
      const word = wordEls.current[i];
      if (word) {
        word.style.opacity = String(0.06 * clamp((0.6 - Math.abs(d)) / 0.3));
        word.style.transform = `translate(calc(-50% + ${(-d * 22).toFixed(2)}vw), -50%)`;
      }
    }
    const c = chapterAt(p);
    if (c !== chapterRef.current) {
      chapterRef.current = c;
      setChapter(c);
    }
  }, []);

  useLayoutEffect(() => {
    if (!pinned) return;
    shown.current = progress();
    render(shown.current);
  }, [pinned, progress, render]);

  useEffect(() => {
    if (!pinned) return;
    const box = scroller();
    if (!box) return;
    let frame = 0;
    let last = 0;
    // Ease the shown position towards the scroll position every frame until
    // it arrives, so a wheel step turns the card over ~half a second.
    const tick = (now: number) => {
      frame = 0;
      const target = progress();
      const prev = shown.current ?? target;
      const dt = last ? Math.min(64, now - last) : 16;
      last = now;
      let next = prev + (target - prev) * (1 - Math.exp(-dt / SMOOTH_MS));
      if (Math.abs(target - next) < 0.0004) next = target;
      shown.current = next;
      render(next);
      if (next !== target) frame = requestAnimationFrame(tick);
      else last = 0;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    box.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      box.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [pinned, progress, render]);

  function goToChapter(i: number) {
    const section = sectionRef.current;
    const sticky = stickyRef.current;
    const box = scroller();
    if (!section || !sticky || !box) return;
    const travel = section.offsetHeight - sticky.offsetHeight;
    const stickyTop = sticky.getBoundingClientRect().top - section.getBoundingClientRect().top;
    const target = box.scrollTop - stickyTop + ((i + 0.5) / labels.length) * travel;
    box.scrollTo({ top: target, behavior: "smooth" });
  }

  // Last year's league numbers (the lazy guess), under the event's metrics.
  const lastYearEnd = yearAgo(event.period_end_date);
  const lastYear = event.metrics.map((m) => ({
    key: m.key,
    label: m.label,
    text: value(
      history?.actuals.find((a) => a.period_end_date === lastYearEnd && a.metric_key === m.key)?.value,
      m.unit
    ),
  }));

  const quarters = [...previousQuarterEnds(event.period_end_date, 8)].reverse();
  const quarterName = practice?.quarterName ?? quarterLabel;
  const quarterLabels = quarters.map(quarterName);

  const chapters = [
    <>
      {explainer ? (
        <>
          <p className="chapter-lead">{explainer.lead}</p>
          <Equation explainer={explainer} />
        </>
      ) : (
        event.company.description && <p className="chapter-lead">{event.company.description}</p>
      )}
    </>,
    <ul className="chapter-numbers">
      {lastYear.map((n) => (
        <li key={n.key}>
          <span className="chapter-number-value">{n.text}</span>
          <span className="chapter-number-label">{n.label}</span>
        </li>
      ))}
    </ul>,
    history ? (
      <div className="chapter-trends">
        {/* T2/T25: the league's own numbers, never Yahoo's margin or a revenue index. */}
        <QuarterSparkline
          label="Revenue growth (YoY)"
          values={leagueSeries(history.actuals, "revenue_growth_yoy", quarters)}
          quarterLabels={quarterLabels}
          format={signedPct}
        />
        <QuarterSparkline
          label="Operating margin"
          values={leagueSeries(history.actuals, "operating_margin", quarters)}
          quarterLabels={quarterLabels}
          format={(v) => `${v.toFixed(1)}%`}
        />
      </div>
    ) : (
      <p className="empty-note">Loading...</p>
    ),
    explainer ? (
      <>
        {explainer.key_insight && (
          <blockquote className="chapter-quote">
            <span className="hl-under">{explainer.key_insight}</span>
          </blockquote>
        )}
        <ul className="checklist">
          {withoutInsight(explainer.checklist, explainer.key_insight).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </>
    ) : null,
    <>
      {/* Wording approved by Hriday 2026-11-16 (vault: Areas/Simpler wording
          draft (for approval)). */}
      <ol className="chapter-steps">
        <li>
          <strong>Results day.</strong> The company shares its revenue and profit for the quarter.
        </li>
        <li>
          <strong>People compare.</strong> Investors check the results against what they expected.
        </li>
        <li>
          <strong>The price moves.</strong> Better than expected often lifts the share price, and worse often drops
          it. Often, not always: the whole market and the news move it too.
        </li>
        <li>
          <strong>Prices here are old.</strong> Stackly only shows prices at least 30 days old, so this is a look back,
          not a tip.
        </li>
      </ol>
      {prices && prices.points.length > 1 && (
        <PriceLine
          points={prices.points}
          asOf={prices.asOf}
          drawn={priceSeen || !pinned}
          indexed={!!practice}
          hideDates={practice?.hideDates ?? false}
        />
      )}
    </>,
    scored ? (
      <a className="btn btn-primary btn-arrow" href={`#/results/${event.id}`}>
        {event.submitted ? "See your score" : "See the full results"}
        <span className="btn-arrow-icon" aria-hidden="true" />
      </a>
    ) : (
      <>
        <p className="chapter-lead">
          Pick a low and a high you're pretty sure the result lands between. Too tight and you might miss. Too wide and
          you lose points for playing it safe.
        </p>
        <button type="button" className="btn btn-primary btn-arrow" onClick={onJumpToForm}>
          {hasForecast ? "Edit your forecast" : "Make your forecast"}
          <span className="btn-arrow-icon" aria-hidden="true" />
        </button>
      </>
    ),
  ];

  const level = difficultyOf(fromProviderRows(history?.provider_rows));

  const face = (side: "front" | "back", content: ReactNode) => (
    <div className={`card3d-face card3d-${side}`}>
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
      <div className="card3d-content">{content}</div>
    </div>
  );

  const card = (
    <div className="story-stage" aria-hidden="true">
      <div className="card3d-shadow" ref={shadowRef} />
      <div className="card3d" ref={cardRef}>
        {SLICES.map((z) => (
          <div className="card3d-slice" key={z} style={{ transform: `translateZ(${z}px)` }} />
        ))}
        {face(
          "front",
          <>
            <DifficultyEdge label={level ? DIFFICULTY_LABEL[level] : null} />
            <span className="card3d-sector">{sectorName}</span>
            <span className="card3d-mid">
              <span className="card3d-id">
                <span className="card3d-name">{event.company.name}</span>
              </span>
            </span>
            <span className="card3d-foot">
              {event.results_date && <span>Results {formatDay(event.results_date)}</span>}
              {event.status === "open" && <LockCountdown lockAt={event.lock_at} serverNow={event.server_now} compact />}
            </span>
          </>
        )}
        {face(
          "back",
          <>
            <span className="card3d-sector">{labels[1]}</span>
            <ul className="card3d-numbers">
              {lastYear.map((n) => (
                <li key={n.key}>
                  <span className="card3d-number">{n.text}</span>
                  <span className="card3d-number-label">{n.label}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );

  // The chapter strip's white pill slides from the old chapter to the new
  // one (hooks/useSlidingPill) while the new chapter's name opens and the old
  // one's closes over the same time on the same curve (CSS). Each name opens
  // to its own measured width (--label-w), so the opening runs evenly for
  // the whole slide instead of finishing early.
  useSlidingPill(stripRef, indicatorRef, ".story-tab.is-current", chapter, canPin());
  // The text's own width (padding is added in CSS), measured again once web
  // fonts have loaded (a fallback font measures narrower), with 2px to spare.
  useLayoutEffect(() => {
    let live = true;
    const measure = () => {
      if (!live) return;
      stripRef.current?.querySelectorAll<HTMLElement>(".story-tab-label").forEach((label) => {
        const pad = parseFloat(getComputedStyle(label).paddingLeft) || 0;
        label.style.setProperty("--label-w", `${label.scrollWidth - pad + 2}px`);
      });
    };
    measure();
    document.fonts?.ready.then(measure).catch(() => {});
    return () => {
      live = false;
    };
  }, [labels.join("|")]);

  const heading = (
    <div className="story-title">
      <a className="back-link" href={practice?.backHref ?? "#/league"} data-keep-scroll>
        {practice?.backLabel ?? "← Companies"}
      </a>
      <h1 className="story-company">
        {event.company.name}
      </h1>
    </div>
  );

  if (!pinned) {
    return (
      <section className="story story-flat" aria-label={`${event.company.name}: introduction`}>
        {heading}
        {card}
        <ol className="story-flat-list">
          {chapters.map((body, i) => (
            <li key={i} className="glass panel">
              <h2 className="chapter-head">
                {labels[i]}
              </h2>
              {body}
            </li>
          ))}
        </ol>
      </section>
    );
  }

  return (
    <section className="story" ref={sectionRef} aria-label={`${event.company.name}: introduction`}>
      <div className="story-sticky" ref={stickyRef}>
        {/* C2 (master plan): no giant faded word behind the story (it was cropped mid-word). */}

        <button type="button" className="btn btn-secondary btn-compact story-skip" onClick={onJumpToForm}>
          {scored ? "How it turned out" : "Skip to forecast"}
        </button>

        <div className="story-grid">
          <div className="story-text">
            {heading}
            <div className="story-chapters">
              {chapters.map((body, i) => (
                <div
                  key={i}
                  ref={(el) => {
                    chapterEls.current[i] = el;
                  }}
                  className={`story-chapter ${i === chapter ? "is-current" : ""}`}
                  aria-hidden={i !== chapter}
                  {...(i !== chapter ? { inert: "" } : {})}
                >
                  <h2 className="chapter-head">
                    {labels[i]}
                  </h2>
                  {body}
                </div>
              ))}
            </div>
          </div>
          {card}
        </div>

        <nav className="story-strip" aria-label="Chapters" ref={stripRef}>
          <span className="story-strip-indicator" ref={indicatorRef} aria-hidden="true" />
          {labels.map((l, i) => (
            <button
              type="button"
              key={l}
              className={`story-tab ${i === chapter ? "is-current" : ""}`}
              aria-current={i === chapter ? "step" : undefined}
              aria-label={`0${i + 1} ${l}`}
              title={l}
              onClick={() => goToChapter(i)}
            >
              <span className="story-tab-num">0{i + 1}</span>
              <span className="story-tab-label">{l}</span>
            </button>
          ))}
        </nav>
      </div>
    </section>
  );
}

// A year of weekly closing prices (each at least 30 days old) as one line,
// drawn in from the left the first time its chapter comes up.
// Practice: `indexed` (first week = 100, never rupees) and, in Mystery mode,
// `hideDates`.
function PriceLine({ points, asOf, drawn, indexed = false, hideDates = false }: {
  points: PricePoint[];
  asOf: string | null;
  drawn: boolean;
  indexed?: boolean;
  hideDates?: boolean;
}) {
  const W = 320;
  const H = 72;
  const PAD = 6;
  const closes = points.map((p) => p.close);
  const lo = Math.min(...closes);
  const hi = Math.max(...closes);
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / Math.max(1, points.length - 1);
  const y = (v: number) => (hi === lo ? H / 2 : PAD + ((hi - v) * (H - 2 * PAD)) / (hi - lo));
  const d = closes.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  const last = points[points.length - 1];
  const rupees = (v: number) =>
    indexed ? v.toFixed(0) : `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  const day = (iso: string) => (hideDates ? "" : formatDay(iso, true));
  return (
    <figure className={`sparkline chapter-price ${drawn ? "is-drawn" : "draw-pending"}`}>
      <figcaption className="sparkline-head">
        <span className="sparkline-label">{indexed ? "Share price index" : "Share price"}</span>
        <span className="sparkline-value">
          {rupees(last.close)} <span className="sparkline-when">{day(asOf ?? last.date)}</span>
        </span>
      </figcaption>
      <svg
        className="sparkline-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={
          hideDates
            ? `Share price index, a year of weekly closes before the results: from ${rupees(points[0].close)} to ${rupees(last.close)}.`
            : `Share price, weekly closes from ${formatDay(points[0].date, true)} to ${formatDay(last.date, true)}: from ${rupees(points[0].close)} to ${rupees(last.close)}.`
        }
      >
        <line className="sparkline-base" x1={PAD} x2={W - PAD} y1={H - 1} y2={H - 1} />
        <path className="sparkline-line" d={d} pathLength={1} />
        <circle className="sparkline-dot is-last" cx={x(points.length - 1)} cy={y(last.close)} r={4.5} style={{ animationDelay: "600ms" }} />
      </svg>
      {!hideDates && (
        <div className="sparkline-range" aria-hidden="true">
          <span>{formatDay(points[0].date, true)}</span>
          <span>{formatDay(last.date, true)}</span>
        </div>
      )}
      <p className="footnote">
        {indexed
          ? "Weekly closes in the year before the results, as an index: the first week = 100."
          : "Weekly closes, each at least 30 days old."}
      </p>
    </figure>
  );
}

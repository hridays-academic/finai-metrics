import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../../hooks/useOnceVisible";
import SiteFooter from "../SiteFooter";
import { HeroWaves } from "../league/CardArt";
import { coverAt, currentPage, riseProgress, tiltAt } from "./guideMotion";
import { fetchPracticeCases } from "../../lib/api";
import GuideCompanyCard, { type GuideCompany } from "./GuideCompanyCard";
import {
  CluesObject, DropObject, LazyObject, MarginObject, QuartersObject, QuizObject, RevenueObject, ScoreObject, SectorObject,
  YourTurnObject,
} from "./guideObjects";

// The guide, #/learn (v3, 2026-11-19, Hriday: it must look like the same
// product as Home). Ten full-screen pages that stack as you scroll, like the
// services pages of kigo.studio (motion only): every page is sticky in ONE
// container with a one-screen spacer after it (the dwell, where it sits flat
// to be read and used). The next page rises with the normal scroll, tilted
// -7deg, and straightens as its top reaches the top; the page underneath
// shrinks to 0.96 and darkens to 35%. All of it is scrubbed by the scroll
// position of .app-shell-content (the app's scroller), in one rAF-throttled
// listener, transform and opacity only. Reduced motion: the pages simply
// scroll. The last page is not sticky: it scrolls on like a normal page, so
// it can be taller than the screen (its practice tiles on phones).
// Look: Home's own parts. The page background with Home's hero wave lines,
// Home's headline as the title (last word gold), the facts in the guide
// strip's panel, Home's body text, Home's slider object and the site's
// buttons. Real-company pages show a small version of that company's tile.

interface Fact {
  num: string;
  line: string;
}

interface Page {
  // The title in Home's headline style: the words before the gold one, and the gold word.
  title: [string, string];
  facts: Fact[];
  text: string;
  // A real company whose numbers the page uses: its small card sits beside them.
  company?: GuideCompany;
  // "clues" is filled in by GuidePage (it needs the Research link).
  object: ReactNode | "clues";
}

// Wording approved by Hriday 2026-11-19 (vault: Areas/Guide v2 wording (for
// approval), "v3 restyle"; page 10's title "First forecast").
const PAGES: Page[] = [
  {
    title: ["Quarterly", "results"],
    facts: [
      { num: "4", line: "results each year" },
      { num: "45", line: "days at most to report them" },
      { num: "3", line: "numbers you forecast for each" },
    ],
    text:
      "A company's financial year is divided into four quarters of three months. After each quarter, the company publishes its results: how much it sold and how much profit it made. Companies listed in India must report within 45 days, or within 60 days after the last quarter of the year. You forecast three numbers before results day.",
    object: <QuartersObject />,
  },
  {
    title: ["Revenue", "growth"],
    company: "maruti",
    facts: [
      { num: "₹53,356 cr", line: "Maruti Suzuki's sales, Jul to Sep 2026" },
      { num: "₹42,344 cr", line: "the same months a year earlier" },
      { num: "26%", line: "revenue growth" },
    ],
    text:
      "Revenue is the money a company receives from its sales, before any costs. Revenue growth compares a quarter with the same quarter a year earlier: (this year − last year) ÷ last year. Maruti Suzuki's revenue rose from ₹42,344 crore to ₹53,356 crore, so it grew 26%. One crore is 1,00,00,000 rupees.",
    object: <RevenueObject />,
  },
  {
    title: ["Operating", "margin"],
    company: "marico",
    facts: [
      { num: "₹100", line: "of sales" },
      { num: "₹18", line: "left over at Marico" },
      { num: "18.2%", line: "Marico's operating margin" },
    ],
    text:
      "Operating margin is the share of sales left after paying for materials, staff and other running costs. From July to September 2026, Marico had about ₹18 left from every ₹100 of sales, so its operating margin was 18.2%. A higher margin means more of each sale is left over.",
    object: <MarginObject />,
  },
  {
    title: ["Sector", "number"],
    facts: [
      { num: "4", line: "sectors in the league" },
      { num: "1", line: "extra number for each company" },
      { num: "12", line: "sales reports a year from car and tractor makers" },
    ],
    text:
      "Each sector has one number that says the most about its quarter, and you forecast it as well. Not every company publishes this number, so some companies have only two numbers to forecast.",
    object: <SectorObject />,
  },
  {
    title: ["Your", "range"],
    facts: [
      { num: "80%", line: "how confident your range should be" },
      { num: "8 of 10", line: "results should fall inside it" },
      { num: "2", line: "points lost for each point of width" },
    ],
    text:
      "No one knows the exact number before results day, so you give a range: a low and a high. Aim for a range that would contain the actual result 8 times out of 10. A narrow range misses often. A wide range rarely misses, but width reduces your score.",
    object: <DropObject />,
  },
  {
    title: ["How you", "score"],
    company: "marico",
    facts: [
      { num: "100", line: "points to start" },
      { num: "−2", line: "for each point of width" },
      { num: "−20", line: "for each point you miss by" },
    ],
    text:
      "Each number you forecast starts at 100 points. Each percentage point of your range's width costs 2 points. If the result falls outside your range, each point you missed by costs 20 more. Scores cannot go below 0. Here the result is Marico's actual operating margin: 18.2%.",
    object: <ScoreObject />,
  },
  {
    title: ["The lazy", "guess"],
    company: "maruti",
    facts: [
      { num: "+10", line: "bonus points" },
      { num: "13.1%", line: "Maruti Suzuki's growth a year before" },
      { num: "26%", line: "its actual growth" },
    ],
    text:
      "The lazy guess assumes the number will be the same as last year. If the middle of your range is closer to the result than the lazy guess, you earn 10 bonus points. If it is equally close, there is no bonus. For Maruti Suzuki, the lazy guess was 13.1%; its revenue actually grew 26%.",
    object: <LazyObject />,
  },
  {
    title: ["Where to", "look"],
    facts: [
      { num: "1 year", line: "back: the same season" },
      { num: "1 quarter", line: "back: the latest results" },
      { num: "4", line: "sources worth checking" },
    ],
    text:
      "Good forecasts start from facts. Begin with the same quarter last year, because seasonal patterns repeat: festivals, monsoons and harvests come round every year. Then look at what has changed since.",
    object: "clues",
  },
  {
    title: ["Check", "yourself"],
    facts: [
      { num: "3", line: "questions" },
      { num: "0", line: "points at stake" },
      { num: "+10", line: "bonus for beating the lazy guess" },
    ],
    text: "Three questions to check your understanding. Choose an answer to see the working.",
    object: <QuizObject />,
  },
  {
    title: ["First", "forecast"],
    facts: [
      { num: "7", line: "practice companies" },
      { num: "3", line: "numbers to forecast for each" },
      { num: "80%", line: "the confidence to aim for" },
    ],
    text:
      "Start with a practice company. Its results are already published, so you see your score immediately. Mystery mode hides the company's name, so you forecast from the numbers alone. When a company opens for forecasts, you can forecast it in the league.",
    object: <YourTurnObject />,
  },
];

export const PAGE_COUNT = PAGES.length;

function scroller(): HTMLElement | null {
  return document.querySelector(".app-shell-content");
}

const INTERACTIVE = "input, textarea, select, button, a, [role='slider'], [contenteditable='true']";

export default function GuidePage({ onOpenResearch }: { onOpenResearch?: () => void }) {
  const [still] = useState(prefersReducedMotion);
  const [practiceCount, setPracticeCount] = useState<number | null>(null);
  const stackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPracticeCases(true)
      .then((c) => !cancelled && setPracticeCount(c.length))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Phones: when a page doesn't fit, first hide the prompt (the button says
  // it), then put the made-up note on one line under the slider's scale.
  // Measured again when a readout grows. Offsets, not rects, so a tilted page
  // measures true; against the bottom padding, which Chrome's scrollHeight
  // ignores for a flex child.
  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (!stack) return;
    const tighten = (inner: HTMLElement) => {
      inner.classList.remove("is-tight-a", "is-tight-b");
      const phone = window.matchMedia?.("(max-width: 640px)").matches ?? false;
      if (!phone || inner.clientHeight === 0 || inner.closest(".is-last")) return;
      const pad = parseFloat(getComputedStyle(inner).paddingBottom);
      const over = () =>
        Math.max(...[...inner.children].map((c) => (c as HTMLElement).offsetTop + (c as HTMLElement).offsetHeight)) -
        (inner.clientHeight - pad);
      if (over() > 0) inner.classList.add("is-tight-a");
      if (over() > 0) inner.classList.add("is-tight-b");
    };
    const fitAll = () => stack.querySelectorAll<HTMLElement>(".g2-inner").forEach(tighten);
    fitAll();
    document.fonts?.ready.then(fitAll).catch(() => {});
    window.addEventListener("resize", fitAll);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver((entries) => {
        for (const e of entries) {
          const inner = (e.target as HTMLElement).closest<HTMLElement>(".g2-inner");
          if (inner) tighten(inner);
        }
      });
      stack.querySelectorAll(".g2-side, .g2-bottom").forEach((el) => ro?.observe(el));
    }
    return () => {
      window.removeEventListener("resize", fitAll);
      ro?.disconnect();
    };
  }, []);
  const [current, setCurrent] = useState(0);
  const pageRefs = useRef<(HTMLElement | null)[]>([]);
  const sheetRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dimRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const spacerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const currentRef = useRef(0);

  // Each page's resting scroll position: its top at the top of the visible area.
  function restingTop(i: number): number | null {
    const box = scroller();
    const page = pageRefs.current[i];
    if (!box || !page) return null;
    const boxTop = box.getBoundingClientRect().top;
    // The last page isn't sticky; it rests where the others stick.
    const first = pageRefs.current[0] ?? page;
    const stickTop = parseFloat(getComputedStyle(first).top) || 0;
    // Page i's natural top is the bottom of the spacer before it (spacers
    // never stick, so their position is real).
    const before = i === 0 ? page.parentElement : spacerRefs.current[i - 1];
    if (!before) return null;
    const natural = i === 0 ? before.getBoundingClientRect().top : before.getBoundingClientRect().bottom;
    return box.scrollTop + natural - boxTop - stickTop;
  }

  useEffect(() => {
    const box = scroller();
    if (!box) return;
    let frame = 0;
    const paint = () => {
      frame = 0;
      const boxTop = box.getBoundingClientRect().top;
      const first = pageRefs.current[0];
      if (!first) return;
      const stickTop = parseFloat(getComputedStyle(first).top) || 0;
      const height = first.offsetHeight;
      const progress = PAGES.map((_, i) => {
        if (i === 0) return 1;
        const spacer = spacerRefs.current[i - 1];
        if (!spacer) return 0;
        const top = spacer.getBoundingClientRect().bottom - boxTop - stickTop;
        return riseProgress(top, height);
      });
      if (!still) {
        progress.forEach((p, i) => {
          const sheet = sheetRefs.current[i];
          if (!sheet) return;
          const next = progress[i + 1] ?? 0;
          const { scale, dim } = coverAt(next);
          const tilt = tiltAt(p);
          sheet.style.transform = tilt === 0 && scale === 1 ? "" : `rotate(${tilt.toFixed(3)}deg) scale(${scale.toFixed(4)})`;
          const shade = dimRefs.current[i];
          if (shade) shade.style.opacity = dim ? dim.toFixed(3) : "0";
          // Only the page rising and the page it covers are in motion.
          const moving = (p > 0 && p < 1) || (next > 0 && next < 1);
          sheet.style.willChange = moving ? "transform" : "";
        });
      }
      const c = currentPage(progress);
      if (c !== currentRef.current) {
        currentRef.current = c;
        setCurrent(c);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    paint();
    box.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      box.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [still]);

  // Space / Page Down: the next page; Shift+Space / Page Up: the previous one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const forward = (e.key === " " && !e.shiftKey) || e.key === "PageDown";
      const back = (e.key === " " && e.shiftKey) || e.key === "PageUp";
      if (!forward && !back) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.(INTERACTIVE)) return;
      const box = scroller();
      if (!box) return;
      const here = box.scrollTop;
      const tops = PAGES.map((_, i) => restingTop(i));
      let goTo: number | null = null;
      if (forward) {
        goTo = tops.find((t) => t !== null && t > here + 2) ?? null;
      } else {
        const earlier = tops.filter((t): t is number => t !== null && t < here - 2);
        goTo = earlier.length ? earlier[earlier.length - 1] : null;
      }
      if (goTo === null) return;
      e.preventDefault();
      box.scrollTo({ top: goTo, behavior: still ? "auto" : "smooth" });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [still]);

  return (
    <div className="guide2-page">
      <h1 className="visually-hidden">How to play</h1>
      <div className={`g2-stack ${still ? "is-still" : ""}`} ref={stackRef}>
        {PAGES.map((page, i) => (
          <PageSection
            key={page.title.join(" ")}
            page={
              page.object === "clues"
                ? { ...page, object: <CluesObject onOpenResearch={onOpenResearch} /> }
                : i === PAGES.length - 1 && practiceCount
                  ? { ...page, facts: [{ num: String(practiceCount), line: "practice companies" }, ...page.facts.slice(1)] }
                  : page
            }
            index={i}
            sectionRef={(el) => {
              pageRefs.current[i] = el;
            }}
            sheetRef={(el) => {
              sheetRefs.current[i] = el;
            }}
            dimRef={(el) => {
              dimRefs.current[i] = el;
            }}
            spacerRef={(el) => {
              spacerRefs.current[i] = el;
            }}
          />
        ))}
      </div>
      <p className="g2-counter" aria-hidden="true">
        {current + 1} / {PAGES.length}
      </p>
      <div className="page guide2-foot">
        <SiteFooter />
      </div>
    </div>
  );
}

interface SectionProps {
  page: Page;
  index: number;
  sectionRef: (el: HTMLElement | null) => void;
  sheetRef: (el: HTMLDivElement | null) => void;
  dimRef: (el: HTMLSpanElement | null) => void;
  spacerRef: (el: HTMLDivElement | null) => void;
}

function PageSection({ page, index, sectionRef, sheetRef, dimRef, spacerRef }: SectionProps) {
  const id = `g2-title-${index + 1}`;
  const last = index === PAGE_COUNT - 1;
  return (
    <>
      <section className={`g2-page ${last ? "is-last" : ""}`} aria-labelledby={id} ref={sectionRef}>
        <div className="g2-sheet" ref={sheetRef}>
          <HeroWaves />
          {/* Phones: how far through the guide, as a hairline along the top. */}
          <span className="g2-progress" style={{ ["--share" as string]: (index + 1) / PAGE_COUNT }} aria-hidden="true" />
          <div className="g2-inner">
            <p className="visually-hidden">
              Page {index + 1} of {PAGE_COUNT}
            </p>
            <div className="g2-top">
              <h2 className="hero-title g2-title" id={id}>
                {page.title[0]} <span className="hero-title-gold">{page.title[1]}</span>
              </h2>
              {/* Desktop: the company's card beside the facts. */}
              <div className="g2-facts-row">
                <ul className="g2-facts strip-panel">
                  {page.facts.map((f) => (
                    <li key={f.line}>
                      <span className="g2-fact-num">{f.num}</span> <span className="g2-fact-line">{f.line}</span>
                    </li>
                  ))}
                </ul>
                {page.company && <GuideCompanyCard company={page.company} className="g2-company-desk" />}
              </div>
            </div>
            {/* Phones: the card sits at the right of the text, which flows round it. */}
            <div className="g2-text">
              {page.company && <GuideCompanyCard company={page.company} className="g2-company-phone" />}
              <p>{page.text}</p>
            </div>
            {page.object as ReactNode}
          </div>
          <span className="g2-dim" ref={dimRef} aria-hidden="true" />
        </div>
      </section>
      {!last && <div className="g2-dwell" ref={spacerRef} aria-hidden="true" />}
    </>
  );
}

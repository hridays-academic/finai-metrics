import { type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// "Why it matters" for news, video, filing and world-event cards. A 2-line
// summary is always visible; the "Why it matters" button opens the full
// approved paragraph and its cause-and-effect chain, in a glass popover
// (mouse and trackpad) or a bottom sheet (touch). Click only, never hover.
// Portalled to <body>, so nothing can clip it; flipped and shifted to stay on
// screen. Closes on a second click, a click outside, Escape or ×; opening
// one closes any other.

const GAP = 10;
const EDGE = 8;
const SWIPE_CLOSE = 80;

export interface WhyContent {
  title: string;
  chain?: string | null;
  explanation?: string | null;
}

// The one open popover or sheet on the page, so opening another closes it.
let closeOpen: (() => void) | null = null;

function Chain({ chain }: { chain: string }) {
  const steps = chain.split("→").map((s) => s.trim()).filter(Boolean);
  return (
    <ol className="why-chain" aria-label="Cause and effect">
      {steps.map((s, i) => (
        <li key={i}>
          {i > 0 && (
            <span className="why-chain-arrow" aria-hidden="true">
              →
            </span>
          )}
          <span className="why-chain-step">{s}</span>
        </li>
      ))}
    </ol>
  );
}

function Body({ content }: { content: WhyContent }) {
  return (
    <>
      {content.chain && <Chain chain={content.chain} />}
      {content.explanation && <p className="why-explanation">{content.explanation}</p>}
    </>
  );
}

type Place = { top: number; left: number; arrowX: number; side: "top" | "bottom" };

export function useWhyItMatters<T extends HTMLElement>(content: WhyContent) {
  const id = useId();
  const has = Boolean(content.explanation || content.chain);
  const anchorRef = useRef<T>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<null | "popover" | "sheet">(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [drag, setDrag] = useState(0);
  const [tick, setTick] = useState(0); // re-place the popover after a scroll or resize
  const touchY = useRef<number | null>(null);
  const dragRef = useRef(0); // read on touchend, which can run before a re-render

  // refocus: return focus to the button (Escape, ×, a second click, Close).
  const close = useCallback((refocus = false) => {
    setMode(null);
    setPlace(null);
    dragRef.current = 0;
    setDrag(0);
    if (refocus) anchorRef.current?.focus();
  }, []);
  const quietClose = useCallback(() => close(false), [close]);

  const open = () => {
    if (!has) return;
    if (closeOpen && closeOpen !== quietClose) closeOpen();
    closeOpen = quietClose;
    setMode(window.matchMedia("(hover: hover) and (pointer: fine)").matches ? "popover" : "sheet");
  };

  useEffect(() => {
    if (!mode && closeOpen === quietClose) closeOpen = null;
  }, [mode, quietClose]);
  useEffect(
    () => () => {
      if (closeOpen === quietClose) closeOpen = null;
    },
    [quietClose]
  );

  useLayoutEffect(() => {
    if (mode !== "popover" || !anchorRef.current || !popRef.current) return;
    const a = anchorRef.current.getBoundingClientRect();
    const p = popRef.current.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    let side: Place["side"] = "top";
    let top = a.top - p.height - GAP;
    if (top < EDGE) {
      side = "bottom";
      top = Math.min(a.bottom + GAP, vh - p.height - EDGE);
    }
    const centre = a.left + a.width / 2;
    const left = Math.min(Math.max(centre - p.width / 2, EDGE), vw - p.width - EDGE);
    setPlace({ top: Math.max(top, EDGE), left, arrowX: Math.min(Math.max(centre - left, 16), p.width - 16), side });
  }, [mode, tick]);

  // Focus moves into the popover (once placed) or the sheet.
  const placed = place !== null;
  useEffect(() => {
    if (mode === "popover" && placed) popRef.current?.focus({ preventScroll: true });
    if (mode === "sheet") sheetRef.current?.focus();
  }, [mode, placed]);

  useEffect(() => {
    if (!mode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    // A click outside the popover and its button closes it (the sheet's
    // backdrop handles its own).
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (mode === "popover" && !popRef.current?.contains(t) && !anchorRef.current?.contains(t)) close(false);
    };
    // Follow the button while the page scrolls; close once it leaves the screen.
    const onMove = () => {
      if (mode !== "popover") return;
      const a = anchorRef.current?.getBoundingClientRect();
      if (!a || a.bottom < 0 || a.top > window.innerHeight) close(false);
      else setTick((t) => t + 1);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, { capture: true, passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, { capture: true });
    };
  }, [mode, close]);

  const triggerProps = {
    ref: anchorRef,
    type: "button" as const,
    "aria-expanded": mode !== null,
    "aria-controls": mode ? id : undefined,
    "aria-haspopup": "dialog" as const,
    onClick: () => (mode ? close(true) : open()),
  };

  let overlay: ReactNode = null;
  if (mode === "popover") {
    overlay = createPortal(
      <div
        ref={popRef}
        id={id}
        role="dialog"
        aria-label={content.title}
        tabIndex={-1}
        className={`tooltip why-popover ${place ? `tooltip-${place.side} is-placed` : ""}`}
        style={place ? { top: place.top, left: place.left, ["--arrow-x" as string]: `${place.arrowX}px` } : undefined}
        onKeyDown={(e) => {
          // Tabbing out of the popover goes back to its button, so keyboard
          // users carry on through the page from where they were.
          if (e.key === "Tab" && (e.shiftKey || e.target !== popRef.current)) {
            e.preventDefault();
            close(true);
          }
        }}
      >
        <div className="why-popover-head">
          <div className="tooltip-title">{content.title}</div>
          <button type="button" className="why-close" aria-label="Close" onClick={() => close(true)}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <Body content={content} />
        <span className="tooltip-arrow" aria-hidden="true" />
      </div>,
      document.body
    );
  } else if (mode === "sheet") {
    overlay = createPortal(
      <div className="why-sheet-backdrop" onClick={() => close(true)}>
        <div
          ref={sheetRef}
          id={id}
          role="dialog"
          aria-modal="true"
          aria-label={content.title}
          tabIndex={-1}
          className="why-sheet"
          style={drag ? { transform: `translateY(${drag}px)` } : undefined}
          onClick={(e) => e.stopPropagation()}
          onTouchStart={(e) => (touchY.current = e.touches[0].clientY)}
          onTouchMove={(e) => {
            if (touchY.current === null) return;
            dragRef.current = Math.max(0, e.touches[0].clientY - touchY.current);
            setDrag(dragRef.current);
          }}
          onTouchEnd={() => {
            touchY.current = null;
            if (dragRef.current > SWIPE_CLOSE) close(true);
            else {
              dragRef.current = 0;
              setDrag(0);
            }
          }}
        >
          <span className="why-sheet-handle" aria-hidden="true" />
          <div className="tooltip-title">{content.title}</div>
          <Body content={content} />
          <button type="button" className="btn btn-secondary btn-block" onClick={() => close(true)}>
            Close
          </button>
        </div>
      </div>,
      document.body
    );
  }

  return { triggerProps, overlay, has };
}

// The always-visible part: a 2-line summary and the "Why it matters" button.
export function WhySummary({
  summary,
  triggerProps,
  has,
  label = "Why it matters",
}: {
  summary: string;
  triggerProps: ReturnType<typeof useWhyItMatters<HTMLButtonElement>>["triggerProps"];
  has: boolean;
  label?: string;
}) {
  return (
    <div className="why">
      <p className="why-summary">{summary}</p>
      {has && (
        <button {...triggerProps} className="why-label">
          {label}
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}

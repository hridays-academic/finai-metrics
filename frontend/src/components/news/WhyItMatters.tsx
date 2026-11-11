import { type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

// "Why it matters" for news, video, filing and world-event cards. A 2-line
// summary is always visible; the full approved paragraph and its
// cause-and-effect chain open in a glass popover on hover or focus (desktop)
// or a bottom sheet on tap (phones). Portalled to <body>, so nothing can
// clip it; flipped and shifted to stay on screen. Escape closes either.

const GAP = 10;
const EDGE = 8;
const CLOSE_DELAY = 160; // lets the pointer travel from the card to the popover
const SWIPE_CLOSE = 80;

export interface WhyContent {
  title: string;
  chain?: string | null;
  explanation?: string | null;
}

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
      <div className="tooltip-title">{content.title}</div>
      {content.chain && <Chain chain={content.chain} />}
      {content.explanation && <p className="why-explanation">{content.explanation}</p>}
    </>
  );
}

type Place = { top: number; left: number; arrowX: number; side: "top" | "bottom" };

export function useWhyItMatters<T extends HTMLElement>(content: WhyContent) {
  const id = useId();
  const has = Boolean(content.explanation || content.chain);
  const canHover = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches,
    []
  );
  const anchorRef = useRef<T>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [mode, setMode] = useState<null | "popover" | "sheet">(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [drag, setDrag] = useState(0);
  const [tick, setTick] = useState(0); // re-place the popover after a scroll or resize
  const touchY = useRef<number | null>(null);
  const dragRef = useRef(0); // read on touchend, which can run before a re-render

  const cancelClose = () => window.clearTimeout(timer.current);
  const close = useCallback(() => {
    window.clearTimeout(timer.current);
    setMode((m) => {
      if (m === "sheet") anchorRef.current?.focus();
      return null;
    });
    setPlace(null);
    dragRef.current = 0;
    setDrag(0);
  }, []);
  const scheduleClose = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(close, CLOSE_DELAY);
  };
  const openPopover = () => {
    if (!has) return;
    cancelClose();
    setMode("popover");
  };

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

  useEffect(() => {
    if (!mode) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    if (mode === "sheet") sheetRef.current?.focus();
    // Follow the anchor (focusing an off-screen label scrolls it into view);
    // close only once the anchor has left the screen.
    const onMove = () => {
      if (mode !== "popover") return;
      const a = anchorRef.current?.getBoundingClientRect();
      if (!a || a.bottom < 0 || a.top > window.innerHeight) close();
      else setTick((t) => t + 1);
    };
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, { capture: true, passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, { capture: true });
    };
  }, [mode, close]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const cardProps = has && canHover ? { onMouseEnter: openPopover, onMouseLeave: scheduleClose } : {};

  const triggerProps = {
    ref: anchorRef,
    type: "button" as const,
    "aria-expanded": mode !== null,
    "aria-controls": mode ? id : undefined,
    "aria-haspopup": "dialog" as const,
    onFocus: () => canHover && openPopover(),
    onBlur: () => mode === "popover" && scheduleClose(),
    onClick: () => {
      if (!has) return;
      if (canHover) {
        if (mode) close();
        else openPopover();
      } else {
        setMode("sheet");
      }
    },
  };

  let overlay: ReactNode = null;
  if (mode === "popover") {
    overlay = createPortal(
      <div
        ref={popRef}
        id={id}
        role="dialog"
        aria-label={content.title}
        className={`tooltip why-popover ${place ? `tooltip-${place.side} is-placed` : ""}`}
        style={place ? { top: place.top, left: place.left, ["--arrow-x" as string]: `${place.arrowX}px` } : undefined}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        <Body content={content} />
        <span className="tooltip-arrow" aria-hidden="true" />
      </div>,
      document.body
    );
  } else if (mode === "sheet") {
    overlay = createPortal(
      <div className="why-sheet-backdrop" onClick={close}>
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
            if (dragRef.current > SWIPE_CLOSE) close();
            else {
              dragRef.current = 0;
              setDrag(0);
            }
          }}
        >
          <span className="why-sheet-handle" aria-hidden="true" />
          <Body content={content} />
          <button type="button" className="btn btn-secondary btn-block" onClick={close}>
            Close
          </button>
        </div>
      </div>,
      document.body
    );
  }

  return { cardProps, triggerProps, overlay, has };
}

// The always-visible part: a 2-line summary and the "Why it matters" label.
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

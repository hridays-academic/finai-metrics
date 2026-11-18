import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// First-visit spotlight (2026-11-18, wording approved): the whole site dims
// except a cut-out around Home's guide strip, with one line, "Show me" and
// "Skip". App.tsx decides when it shows (guideSeen.ts); this only draws it.
// While open the app behind is inert, focus starts on "Show me" and stays in
// the dialog, and Escape skips. Under reduced motion it appears without a fade.

const PAD = 10; // space between the strip and the cut-out's edge
const GAP = 14; // space between the cut-out and the message

interface Props {
  targetId: string;
  onShowMe: () => void;
  onSkip: () => void;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export default function SpotlightIntro({ targetId, onShowMe, onSkip }: Props) {
  const [box, setBox] = useState<Box | null>(null);
  const showRef = useRef<HTMLButtonElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const skipLatest = useRef(onSkip);
  skipLatest.current = onSkip;

  // Follow the strip if the page scrolls or resizes underneath.
  useLayoutEffect(() => {
    const target = document.getElementById(targetId);
    if (!target) return;
    target.scrollIntoView({ block: "nearest" });
    let frame = 0;
    const measure = () => {
      frame = 0;
      const r = target.getBoundingClientRect();
      setBox({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(target);
    return () => {
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, true);
      observer?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [targetId]);

  // Everything behind is inert while the spotlight is open.
  useEffect(() => {
    const shell = document.querySelector(".app-shell");
    shell?.setAttribute("inert", "");
    showRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        skipLatest.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      shell?.removeAttribute("inert");
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // Tab and Shift+Tab move between the two buttons only.
  function trapTab(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    const first = showRef.current;
    const last = skipRef.current;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }

  const below = box ? box.top + box.height + GAP + 140 < window.innerHeight : true;
  // The message lines up with the strip but never runs off the screen.
  const cardWidth = Math.min(380, window.innerWidth - 32);
  const left = box ? Math.min(Math.max(16, box.left), window.innerWidth - cardWidth - 16) : 16;
  const cardStyle = box
    ? below
      ? { top: box.top + box.height + GAP, left, width: cardWidth }
      : { bottom: window.innerHeight - box.top + GAP, left, width: cardWidth }
    : undefined;

  return createPortal(
    <div className="spotlight" role="presentation">
      <div
        className="spotlight-hole"
        aria-hidden="true"
        style={box ? { top: box.top, left: box.left, width: box.width, height: box.height } : { inset: 0 }}
      />
      <div
        className="spotlight-card"
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to Stackly"
        aria-describedby="spotlight-line"
        style={cardStyle}
        onKeyDown={trapTab}
      >
        <p id="spotlight-line" className="spotlight-line">
          New here? This short guide shows you how to play.
        </p>
        <div className="spotlight-actions">
          <button type="button" className="btn btn-primary" ref={showRef} onClick={onShowMe}>
            Show me
          </button>
          <button type="button" className="btn btn-tertiary" ref={skipRef} onClick={onSkip}>
            Skip
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

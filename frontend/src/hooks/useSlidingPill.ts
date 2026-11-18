import { useEffect, useRef, type RefObject } from "react";

// One highlight pill that slides between tabs (2026-11-18): the company
// story's chapter strip and Research's section bar. Hriday asked for it
// "smoother and slower": 900 ms on an ease-in-out sine curve, and the story's
// chapter names open over the same time on the same curve (app.css), so the
// pill and the tab it lands on move as one. It follows the tab's live size
// every frame, so it always lands exactly on the tab. Starts from wherever
// it is, so a change mid-slide never jumps. Without `animate` (reduced
// motion) it jumps.
export const PILL_MS = 900;

export function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

export function useSlidingPill(
  stripRef: RefObject<HTMLElement | null>,
  pillRef: RefObject<HTMLElement | null>,
  currentSelector: string,
  key: unknown,
  animate: boolean
) {
  const at = useRef<{ x: number; w: number } | null>(null);

  useEffect(() => {
    const strip = stripRef.current;
    const pill = pillRef.current;
    if (!strip || !pill) return;
    const tabFor = () => strip.querySelector<HTMLElement>(currentSelector);
    const place = (x: number, w: number) => {
      pill.style.transform = `translateX(${x.toFixed(1)}px)`;
      pill.style.width = `${w.toFixed(1)}px`;
      at.current = { x, w };
    };
    const from = at.current;
    const duration = from && animate ? PILL_MS : 0;
    const start = performance.now();
    let frame = 0;
    let done = false;
    const step = (now: number) => {
      const tab = tabFor();
      if (!tab) return;
      const t = duration ? Math.min(1, (now - start) / duration) : 1;
      const e = easeInOutSine(t);
      const x = from ? from.x + (tab.offsetLeft - from.x) * e : tab.offsetLeft;
      const w = from ? from.w + (tab.offsetWidth - from.w) * e : tab.offsetWidth;
      place(x, w);
      if (t < 1) frame = requestAnimationFrame(step);
      else done = true;
    };
    frame = requestAnimationFrame(step);
    // A resize, or the page being shown again after display: none, re-seats
    // the pill (only once any slide has finished).
    const reseat = () => {
      const tab = tabFor();
      if (tab && done) place(tab.offsetLeft, tab.offsetWidth);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reseat);
    observer?.observe(strip);
    window.addEventListener("resize", reseat);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", reseat);
    };
  }, [stripRef, pillRef, currentSelector, key, animate]);
}

import { useEffect, useRef, useState } from "react";

// The page's scrollbar on mouse devices (2026-11-17). The browser's own one
// takes a gutter the page can't paint into, so full-width parts (Home's
// "How it works" band, the company story) looked cut off at the right. This
// one floats over the page instead: a recessed socket with a thick glossy
// pill that casts a shadow on what's under it. Wheel, keyboard and touchpad
// scrolling are the browser's own; this only mirrors the position, and can
// be dragged, or clicked above/below the pill to move a screen. Decorative
// for assistive tech (aria-hidden): the page scrolls as usual without it.
// Phones and touch screens keep their own overlay scrollbar (not rendered).

function finePointer(): boolean {
  try {
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  } catch {
    return false;
  }
}

const MIN_THUMB = 56;

export default function PageScrollbar() {
  const [on] = useState(finePointer);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!on) return;
    const box = document.querySelector<HTMLElement>(".app-shell-content");
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!box || !track || !thumb) return;
    document.documentElement.classList.add("custom-scrollbar");

    let frame = 0;
    let thumbH = MIN_THUMB;
    let dragging = false;
    let startY = 0;
    let startScroll = 0;

    const room = () => Math.max(1, track.clientHeight - thumbH);
    const max = () => Math.max(0, box.scrollHeight - box.clientHeight);

    const layout = () => {
      frame = 0;
      const m = max();
      track.classList.toggle("is-hidden", m <= 1);
      if (m <= 1) return;
      thumbH = Math.max(MIN_THUMB, (track.clientHeight * box.clientHeight) / box.scrollHeight);
      thumb.style.height = `${thumbH.toFixed(1)}px`;
      thumb.style.transform = `translateY(${((box.scrollTop / m) * room()).toFixed(1)}px)`;
    };
    const kick = () => {
      if (!frame) frame = requestAnimationFrame(layout);
    };

    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      if (e.target === thumb) {
        dragging = true;
        startY = e.clientY;
        startScroll = box.scrollTop;
        track.setPointerCapture(e.pointerId);
        track.classList.add("is-dragging");
      } else {
        // Above or below the pill: move a screen that way.
        const above = e.clientY < thumb.getBoundingClientRect().top;
        box.scrollBy({ top: (above ? -1 : 1) * box.clientHeight * 0.9, behavior: "smooth" });
      }
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      box.scrollTop = startScroll + ((e.clientY - startY) * max()) / room();
    };
    const up = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      track.classList.remove("is-dragging");
      try {
        track.releasePointerCapture(e.pointerId);
      } catch {
        // already released
      }
    };

    track.addEventListener("pointerdown", down);
    track.addEventListener("pointermove", move);
    track.addEventListener("pointerup", up);
    track.addEventListener("pointercancel", up);
    box.addEventListener("scroll", kick, { passive: true });
    window.addEventListener("resize", kick);
    // Pages, panels and views come and go: the page's height changes.
    const changed = new MutationObserver(kick);
    changed.observe(box, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    const sized = typeof ResizeObserver !== "undefined" ? new ResizeObserver(kick) : null;
    sized?.observe(box);
    layout();

    return () => {
      document.documentElement.classList.remove("custom-scrollbar");
      track.removeEventListener("pointerdown", down);
      track.removeEventListener("pointermove", move);
      track.removeEventListener("pointerup", up);
      track.removeEventListener("pointercancel", up);
      box.removeEventListener("scroll", kick);
      window.removeEventListener("resize", kick);
      changed.disconnect();
      sized?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [on]);

  if (!on) return null;
  return (
    <div className="page-scrollbar" ref={trackRef} aria-hidden="true">
      <div className="page-scrollbar-thumb" ref={thumbRef} />
    </div>
  );
}

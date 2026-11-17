import { type RefObject, useEffect, useState } from "react";

// True while `ref`'s element fits in the viewport below the top bar, so a
// sticky side column is pinned only when nothing in it (a Save button) can
// end up off screen. Taller than the screen: it scrolls with the page.
// Also false on narrow screens, where the column sits under the page.
const WIDE = "(min-width: 1100px)";

// `mounted`: pass true once the element is rendered (the effect re-attaches).
export function usePinIfFits(ref: RefObject<HTMLElement>, mounted: boolean, margin = 32): boolean {
  const [fits, setFits] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const topbar = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--topbar-height")) || 56;
    const check = () => {
      const wide = typeof window.matchMedia === "function" && window.matchMedia(WIDE).matches;
      setFits(wide && el.offsetHeight + topbar() + margin * 2 <= window.innerHeight);
    };
    check();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(check) : null;
    observer?.observe(el);
    window.addEventListener("resize", check);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", check);
    };
  }, [ref, mounted, margin]);

  return fits;
}

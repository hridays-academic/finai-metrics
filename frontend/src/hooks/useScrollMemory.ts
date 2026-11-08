import { useEffect, useLayoutEffect, useRef } from "react";

// The content column (.app-shell-content) is the scroller, not the window,
// so the browser's own scroll restoration never applies. This remembers its
// position per page, in memory for this tab only.
const positions = new Map<string, number>();
let freshAt = 0;

const USER_INPUT = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

function scroller(): HTMLElement | null {
  return document.querySelector(".app-shell-content");
}

// Opening a page through a link starts it at the top, like a normal page
// load. Switching tabs and Back/Forward return to where you were.
export function markFreshNavigation(): void {
  freshAt = Date.now();
}

export function scrollPageToTop(): void {
  scroller()?.scrollTo({ top: 0, behavior: "smooth" });
}

// The page may still be loading, so keep trying each frame until it's tall
// enough, for up to 5s, unless the visitor scrolls first.
function restore(el: HTMLElement, target: number): () => void {
  let frame = 0;
  const started = performance.now();
  const stop = () => {
    cancelAnimationFrame(frame);
    for (const t of USER_INPUT) el.removeEventListener(t, stop);
  };
  const step = () => {
    el.scrollTop = target;
    if (Math.abs(el.scrollTop - target) <= 1 || performance.now() - started > 5000) return stop();
    frame = requestAnimationFrame(step);
  };
  for (const t of USER_INPUT) el.addEventListener(t, stop, { passive: true });
  step();
  return stop;
}

export function useScrollMemory(pageKey: string): void {
  const current = useRef(pageKey);

  useEffect(() => {
    const el = scroller();
    if (!el) return;
    const onScroll = () => positions.set(current.current, el.scrollTop);
    // In-app links count as a fresh visit, except "back" links that are
    // marked to keep their page's place.
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.("a[href^='#/']");
      if (link && !link.hasAttribute("data-keep-scroll")) markFreshNavigation();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("click", onClick, true);
    return () => {
      el.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  // A layout effect, so the new page is at its place before it's painted.
  // The scroll event for the outgoing page's last position has already been
  // recorded; the clamp from hiding it fires later, under the new key.
  useLayoutEffect(() => {
    if (current.current === pageKey) return;
    current.current = pageKey;
    const el = scroller();
    if (!el) return;
    const fresh = Date.now() - freshAt < 1000;
    freshAt = 0;
    return restore(el, fresh ? 0 : positions.get(pageKey) ?? 0);
  }, [pageKey]);
}

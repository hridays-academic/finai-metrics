import { useEffect } from "react";

// Everything with a scroll entrance (app.css).
const ANIMATED = ".reveal, .reveal-row, .reveal-item, .tile, .how-steps > li";

// Scroll-driven animations (animation-timeline: view()) do the reveals in
// CSS, and each one finishes by the time its element is fully on screen.
// Two jobs remain for script:
// - A safety net in every browser: once the page can't scroll any further,
//   anything on screen still mid-entrance gets `.is-settled` (its final
//   state), so nothing at the end of a short page is left half faded.
// - Where a browser lacks scroll-driven animations, CSS hides `.reveal` and
//   `.reveal-row` until they're marked `.is-visible`, and this marks them as
//   they enter the viewport (watching for new ones as pages render).
// Nothing runs under reduced motion (the CSS shows everything).
export function useRevealFallback(): void {
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const scroller = document.querySelector<HTMLElement>(".app-shell-content");
    function settle() {
      if (!scroller || scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 2) return;
      const bottom = scroller.getBoundingClientRect().bottom;
      document.querySelectorAll<HTMLElement>(ANIMATED).forEach((el) => {
        if (el.classList.contains("is-settled")) return;
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.top < bottom) el.classList.add("is-settled", "is-visible");
      });
    }

    const needsFallback =
      typeof IntersectionObserver !== "undefined" &&
      !(typeof CSS !== "undefined" && CSS.supports("animation-timeline: view()"));
    const io = needsFallback
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              entry.target.classList.add("is-visible");
              io?.unobserve(entry.target);
            }
          },
          { rootMargin: "0px 0px -8% 0px" }
        )
      : null;
    const watch = () =>
      io &&
      document.querySelectorAll(".reveal:not(.is-visible), .reveal-row:not(.is-visible)").forEach((n) => io.observe(n));

    let queued = false;
    const schedule = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        watch();
        settle();
      });
    };
    schedule();
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
    scroller?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      io?.disconnect();
      mo.disconnect();
      scroller?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);
}

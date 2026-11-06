import { useEffect } from "react";

// Scroll-driven animations (animation-timeline: view()) do the panel and row
// reveals in CSS. Where a browser lacks them, CSS hides `.reveal` and
// `.reveal-row` until they're marked `.is-visible`, and this marks them as
// they enter the viewport (watching for new ones as pages render). Nothing
// runs under reduced motion (the CSS shows everything).
export function useRevealFallback(): void {
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || typeof MutationObserver === "undefined") return;
    if (typeof CSS !== "undefined" && CSS.supports("animation-timeline: view()")) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px" }
    );
    const watch = () =>
      document.querySelectorAll(".reveal:not(.is-visible), .reveal-row:not(.is-visible)").forEach((n) => io.observe(n));
    watch();
    let queued = false;
    const mo = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        watch();
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, []);
}

import { useEffect } from "react";

// A soft specular light that follows the pointer across glass panels and
// buttons (app.css: `.lg .glass::after`, `.lg .btn::after`). One shared
// listener for the whole app; work is batched into one requestAnimationFrame
// per frame, which reads the hovered elements' rects first and then only
// writes CSS variables (--mx, --my, --light), so it never forces layout
// between writes. Mouse/trackpad only: off for touch and pen, and off under
// prefers-reduced-motion.
const LIT_SELECTOR = ".btn, .glass";

export function useCursorLight(): void {
  useEffect(() => {
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let lit: HTMLElement[] = [];
    let frame = 0;
    let last: PointerEvent | null = null;

    function clear() {
      for (const el of lit) el.style.removeProperty("--light");
      lit = [];
    }

    function update() {
      frame = 0;
      if (!last) return;
      const { clientX, clientY } = last;
      const start = last.target instanceof Element ? last.target : null;
      // The innermost button plus the glass panel it sits on, if any.
      const next: HTMLElement[] = [];
      let el = start?.closest<HTMLElement>(LIT_SELECTOR) ?? null;
      while (el && next.length < 2) {
        next.push(el);
        el = el.parentElement?.closest<HTMLElement>(".glass") ?? null;
      }
      const rects = next.map((n) => n.getBoundingClientRect());
      for (const old of lit) if (!next.includes(old)) old.style.removeProperty("--light");
      next.forEach((n, i) => {
        n.style.setProperty("--mx", `${clientX - rects[i].left}px`);
        n.style.setProperty("--my", `${clientY - rects[i].top}px`);
        n.style.setProperty("--light", "1");
      });
      lit = next;
    }

    function onMove(e: PointerEvent) {
      if (e.pointerType !== "mouse") return;
      last = e;
      if (!frame) frame = requestAnimationFrame(update);
    }

    function onLeave() {
      last = null;
      clear();
    }

    let active = false;
    function sync() {
      const want = finePointer.matches && !reducedMotion.matches;
      if (want === active) return;
      active = want;
      if (want) {
        document.addEventListener("pointermove", onMove, { passive: true });
        document.documentElement.addEventListener("pointerleave", onLeave);
      } else {
        document.removeEventListener("pointermove", onMove);
        document.documentElement.removeEventListener("pointerleave", onLeave);
        cancelAnimationFrame(frame);
        frame = 0;
        clear();
      }
    }

    sync();
    finePointer.addEventListener("change", sync);
    reducedMotion.addEventListener("change", sync);
    return () => {
      finePointer.removeEventListener("change", sync);
      reducedMotion.removeEventListener("change", sync);
      document.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(frame);
      clear();
    };
  }, []);
}

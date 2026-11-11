import { useEffect } from "react";

// A soft specular light on glass, tiles and buttons that follows the
// pointer (--mx, --my, --light; app.css). One shared listener; work is
// batched into one requestAnimationFrame per frame, which reads the hovered
// elements' rects first and then only writes CSS variables, so it never
// forces layout between writes. Mouse/trackpad only (off for touch and pen)
// and off under prefers-reduced-motion.
const LIT = ".btn, .tile, .picker-row, .glass";

export function useCursorLight(): void {
  useEffect(() => {
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let lit: HTMLElement[] = [];
    let frame = 0;
    let last: PointerEvent | null = null;

    function reset(el: HTMLElement) {
      el.style.removeProperty("--light");
    }

    function clear() {
      lit.forEach(reset);
      lit = [];
    }

    function update() {
      frame = 0;
      if (!last) return;
      const { clientX, clientY } = last;
      const start = last.target instanceof Element ? last.target : null;
      // The innermost button or tile, plus the glass panel it sits on.
      const next: HTMLElement[] = [];
      let el = start?.closest<HTMLElement>(LIT) ?? null;
      while (el && next.length < 3) {
        next.push(el);
        el = el.parentElement?.closest<HTMLElement>(".glass, .tile, .picker-row") ?? null;
      }
      const rects = next.map((n) => n.getBoundingClientRect());
      for (const old of lit) if (!next.includes(old)) reset(old);
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

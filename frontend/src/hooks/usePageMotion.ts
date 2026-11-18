import { useEffect } from "react";

// The scroll motion on every page (2026-11-16, redesign v3; started on Home).
// Tied to the scroll position both ways: every top-level glass panel rises
// and settles as it comes up the screen; Home's company tiles tip up out of
// a slight 3D lean (the right column a beat after the left) and its "How it
// works" band grows to full width while its steps rise at different speeds.
//
// What moves: every `.glass.panel` in the main column that isn't inside
// another glass surface, plus anything marked data-scrub="tile|panel|title|
// step|band|row" (data-i: its order). The shown scroll position eases towards
// the real one (SMOOTH_MS) so wheel steps glide. Positions come from
// offsetTop, which ignores transforms, so the motion never feeds back into
// its own input; reads happen before writes. Once an element has fully
// arrived its transform is cleared, so settled content is plain (sharp text,
// no stray layers). Off under reduced motion. Elements in hidden views
// (display: none) are skipped.

const SMOOTH_MS = 160;

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (t: number) => 1 - (1 - t) ** 3;

function layoutTop(el: HTMLElement): number {
  let top = 0;
  let node: HTMLElement | null = el;
  while (node) {
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return top;
}

// How far into the screen an element has come (0 = just below the bottom,
// 1 = `span` of the screen height above it), by kind.
const SPAN: Record<string, number> = { tile: 0.55, panel: 0.45, title: 0.3, step: 0.5, band: 0.75, row: 0.4 };

// [transform, opacity, arrived]
function style(kind: string, i: number, t: number, phone: boolean): [string, number, boolean] {
  switch (kind) {
    case "tile": {
      const col = phone ? 0 : i % 2;
      const e = easeOut(clamp(t * 1.15 - col * 0.15));
      return [
        `perspective(1400px) translate3d(0, ${((1 - e) * 120).toFixed(1)}px, 0) rotateX(${((1 - e) * 24).toFixed(2)}deg) scale(${(0.86 + 0.14 * e).toFixed(4)})`,
        clamp(e * 1.5),
        e >= 0.999,
      ];
    }
    case "title": {
      const e = easeOut(clamp(t));
      return [`translate3d(0, ${((1 - e) * 40).toFixed(1)}px, 0)`, clamp(e * 1.3), e >= 0.999];
    }
    case "step": {
      const e = easeOut(clamp(t * 1.2 - i * 0.12));
      return [`translate3d(0, ${((1 - e) * (70 + i * 40)).toFixed(1)}px, 0)`, clamp(e * 1.4), e >= 0.999];
    }
    case "row": {
      // Rows and small cards inside a panel; side-by-side ones cascade.
      const e = easeOut(clamp(t * 1.15 - (phone ? 0 : (i % 3) * 0.12)));
      return [`translate3d(0, ${((1 - e) * 56).toFixed(1)}px, 0) scale(${(0.96 + 0.04 * e).toFixed(4)})`, clamp(e * 1.4), e >= 0.999];
    }
    case "band": {
      const e = easeOut(clamp(t));
      return [`scale(${(0.86 + 0.14 * e).toFixed(4)}, ${(0.92 + 0.08 * e).toFixed(4)})`, 1, e >= 0.999];
    }
    default: {
      // panel
      const e = easeOut(clamp(t * 1.1 - i * 0.08));
      return [`translate3d(0, ${((1 - e) * 90).toFixed(1)}px, 0) scale(${(0.94 + 0.06 * e).toFixed(4)})`, clamp(e * 1.4), e >= 0.999];
    }
  }
}

function moving(root: HTMLElement): HTMLElement[] {
  const marked = Array.from(root.querySelectorAll<HTMLElement>("[data-scrub]"));
  const panels = Array.from(root.querySelectorAll<HTMLElement>(".glass.panel")).filter(
    (el) => !el.parentElement?.closest(".glass, [data-scrub]") && !el.hasAttribute("data-scrub")
  );
  return [...marked, ...panels];
}

export function usePageMotion(): void {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".app-main");
    const box = document.querySelector<HTMLElement>(".app-shell-content");
    if (!root || !box) return;
    let phoneQuery: MediaQueryList | null = null;
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      phoneQuery = window.matchMedia("(max-width: 640px)");
    } catch {
      return;
    }

    let shown = box.scrollTop;
    let frame = 0;
    let last = 0;

    const draw = () => {
      const els = moving(root).filter((el) => el.offsetParent !== null);
      const boxTop = layoutTop(box);
      const boxScreenTop = box.getBoundingClientRect().top;
      const vh = box.clientHeight;
      const tops = els.map((el) => layoutTop(el) - boxTop - shown + boxScreenTop);
      const phone = phoneQuery?.matches ?? false;
      els.forEach((el, n) => {
        const kind = el.dataset.scrub ?? "panel";
        const t = (vh - tops[n]) / (vh * (SPAN[kind] ?? 0.5));
        const [transform, opacity, arrived] = style(kind, Number(el.dataset.i ?? 0), t, phone);
        el.style.transform = arrived ? "" : transform;
        el.style.opacity = arrived || opacity >= 1 ? "" : opacity.toFixed(3);
      });
    };

    const tick = (now: number) => {
      frame = 0;
      const target = box.scrollTop;
      const dt = last ? Math.min(64, now - last) : 16;
      last = now;
      shown += (target - shown) * (1 - Math.exp(-dt / SMOOTH_MS));
      if (Math.abs(target - shown) < 0.5) shown = target;
      draw();
      if (shown !== target) frame = requestAnimationFrame(tick);
      else last = 0;
    };
    const kick = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };

    root.classList.add("motion-on");
    draw();
    box.addEventListener("scroll", kick, { passive: true });
    window.addEventListener("resize", kick);
    window.addEventListener("hashchange", kick);
    // New content (a page opened, panels loaded) and views shown or hidden.
    const changed = new MutationObserver(kick);
    changed.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });

    return () => {
      box.removeEventListener("scroll", kick);
      window.removeEventListener("resize", kick);
      window.removeEventListener("hashchange", kick);
      changed.disconnect();
      if (frame) cancelAnimationFrame(frame);
      root.classList.remove("motion-on");
      moving(root).forEach((el) => {
        el.style.transform = "";
        el.style.opacity = "";
      });
    };
  }, []);
}

import { useEffect, useRef } from "react";

// The living background behind the glass (app.css: "Wallpaper"). Four large,
// pre-blurred colour fields drift and morph on their own CSS loops
// (transform/opacity only). This component adds two things CSS can't:
// - a gentle parallax toward the mouse (eased in requestAnimationFrame, only
//   ever writing --px/--py on this element), desktop pointer only;
// - pausing every animation while the tab is hidden.
// Under prefers-reduced-motion the CSS keeps it static and this does nothing.
export default function Wallpaper() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onVisibility = () => {
      if (document.hidden) el.dataset.paused = "";
      else delete el.dataset.paused;
    };
    document.addEventListener("visibilitychange", onVisibility);

    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let target = { x: 0, y: 0 };
    let current = { x: 0, y: 0 };
    let frame = 0;

    function step() {
      current = {
        x: current.x + (target.x - current.x) * 0.05,
        y: current.y + (target.y - current.y) * 0.05,
      };
      el!.style.setProperty("--px", current.x.toFixed(3));
      el!.style.setProperty("--py", current.y.toFixed(3));
      const settled = Math.abs(target.x - current.x) < 0.002 && Math.abs(target.y - current.y) < 0.002;
      frame = settled || document.hidden ? 0 : requestAnimationFrame(step);
    }

    function onMove(e: PointerEvent) {
      if (e.pointerType !== "mouse" || !finePointer.matches || reducedMotion.matches) return;
      target = { x: (e.clientX / window.innerWidth) * 2 - 1, y: (e.clientY / window.innerHeight) * 2 - 1 };
      if (!frame) frame = requestAnimationFrame(step);
    }
    document.addEventListener("pointermove", onMove, { passive: true });

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="wallpaper" ref={ref} aria-hidden="true">
      <div className="wall-layer wall-layer-far">
        <i className="wall-field wall-field-1" />
        <i className="wall-field wall-field-2" />
      </div>
      <div className="wall-layer wall-layer-near">
        <i className="wall-field wall-field-3" />
        <i className="wall-field wall-field-4" />
      </div>
      <div className="wall-tint" />
    </div>
  );
}

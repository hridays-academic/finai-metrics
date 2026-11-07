import { type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Every tooltip / hover box renders here: portalled to <body> (the top
// layer for our purposes), so no panel, transform or overflow can put it
// underneath something or clip it. A matching glass panel with an arrow;
// above the trigger by default, flipped below and shifted sideways to stay
// on screen. Opens on hover, focus or tap; closes on leave, blur, Escape,
// scroll and resize.

const GAP = 10; // trigger to tooltip, room for the arrow
const EDGE = 8; // minimum distance from the viewport edge

type Placement = { top: number; left: number; arrowX: number; side: "top" | "bottom" };

export function useTooltip<T extends HTMLElement>(content: ReactNode) {
  const id = useId();
  const triggerRef = useRef<T>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Placement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setPlace(null);
  }, []);

  // Measure after the tooltip renders (hidden), then place it.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !tipRef.current) return;
    const t = triggerRef.current.getBoundingClientRect();
    const tip = tipRef.current.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    let side: Placement["side"] = "top";
    let top = t.top - tip.height - GAP;
    if (top < EDGE && t.bottom + GAP + tip.height <= vh - EDGE) {
      side = "bottom";
      top = t.bottom + GAP;
    }
    const centre = t.left + t.width / 2;
    const left = Math.min(Math.max(centre - tip.width / 2, EDGE), vw - tip.width - EDGE);
    const arrowX = Math.min(Math.max(centre - left, 16), tip.width - 16);
    setPlace({ top: Math.max(top, EDGE), left, arrowX, side });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
    };
  }, [open, close]);

  const triggerProps = {
    ref: triggerRef,
    tabIndex: 0,
    "aria-describedby": open ? id : undefined,
    onMouseEnter: () => setOpen(true),
    onMouseLeave: close,
    onFocus: () => setOpen(true),
    onBlur: close,
    onClick: () => setOpen(true),
  };

  const tooltip = open
    ? createPortal(
        <div
          ref={tipRef}
          id={id}
          role="tooltip"
          className={`tooltip ${place ? `tooltip-${place.side} is-placed` : ""}`}
          style={place ? { top: place.top, left: place.left, ["--arrow-x" as string]: `${place.arrowX}px` } : undefined}
        >
          {content}
          <span className="tooltip-arrow" aria-hidden="true" />
        </div>,
        document.body
      )
    : null;

  return { triggerProps, tooltip, open };
}

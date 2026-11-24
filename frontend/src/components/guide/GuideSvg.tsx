import { useEffect, useState } from "react";

// Sizes for the guide's slider (2026-11-19 v3, Hriday: "the same 3D object as
// Home's hero"). The slab, gold capsule and steel ball are Home's own materials
// (.slab, .slab-range, .ball-skin in app.css) at Home's proportions: on tall
// screens exactly Home's desktop sizes, otherwise Home's smaller sizes, and on
// phones the same object scaled to fit a dot plot of 10 results.

export interface SliderSizes {
  track: number;
  capsule: number;
  knob: number;
  ball: number;
  box: number; // the slider's height; the slab runs along its middle
}

export const TALL: SliderSizes = { track: 24, capsule: 38, knob: 26, ball: 76, box: 46 };
export const DESKTOP: SliderSizes = { track: 18, capsule: 28, knob: 20, ball: 54, box: 36 };
export const PHONE: SliderSizes = { track: 11, capsule: 16, knob: 12, ball: 30, box: 24 };
const PHONE_QUERY = "(max-width: 640px)";
const TALL_QUERY = "(min-width: 641px) and (min-height: 880px)";

function pick(): SliderSizes {
  try {
    if (window.matchMedia(PHONE_QUERY).matches) return PHONE;
    if (window.matchMedia(TALL_QUERY).matches) return TALL;
  } catch {
    // no matchMedia: desktop sizes
  }
  return DESKTOP;
}

// Home's hero object (layout pass, 2026-11-24): its desktop sizes everywhere
// but phones, where Home uses its smaller set (.hero-object at <=860px).
function pickHome(): SliderSizes {
  return isPhone() ? DESKTOP : TALL;
}

function isPhone(): boolean {
  try {
    return window.matchMedia(PHONE_QUERY).matches;
  } catch {
    return false;
  }
}

// The sizes for this screen, updated when it crosses a breakpoint. `home`:
// the layout-pass pages, at Home's hero scale. `phone` is the screen, not
// the size set (the Home set is the same object on a phone and a desktop).
export function useSliderSizes(home = false): SliderSizes & { phone: boolean } {
  const read = () => ({ ...(home ? pickHome() : pick()), phone: isPhone() });
  const [sizes, setSizes] = useState(read);
  useEffect(() => {
    const on = () => setSizes(read());
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [home]);
  return sizes;
}

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

// The sizes for this screen, updated when it crosses a breakpoint.
export function useSliderSizes(): SliderSizes {
  const [sizes, setSizes] = useState(pick);
  useEffect(() => {
    const on = () => setSizes(pick());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return sizes;
}

import { useCallback, useEffect, useLayoutEffect, useState } from "react";

// One choice, saved per browser: Light or Dark, set as `data-mode` on <html>
// (theme.css). Until a visitor picks one in Settings, the device's
// light/dark setting decides (Light if unknown), and it keeps following the
// device.
export type ThemeMode = "dark" | "light";

// Charts use this only as a useEffect dependency, to know when to re-read
// CSS variables for their lightweight-charts canvas.
export type Theme = ThemeMode;

const MODE_KEY = "stackly-mode"; // was "finai-metrics-mode"; public/theme-init.js moves it
// Left over from earlier designs; deleted so nobody keeps a theme that no
// longer exists (Aurora/Graphite palettes, 2026-11-15; the old single key).
const OLD_KEYS = ["finai-metrics-palette", "finai-metrics-theme", "finai-metrics-mode"];

function readStored(): ThemeMode | null {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

function deviceQuery(): MediaQueryList | null {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)");
  } catch {
    return null;
  }
}

function deviceMode(): ThemeMode {
  return deviceQuery()?.matches ? "dark" : "light";
}

export function useTheme(): { mode: ThemeMode; theme: Theme; setMode: (m: ThemeMode) => void } {
  const [chosen, setChosen] = useState<ThemeMode | null>(readStored);
  const [device, setDevice] = useState<ThemeMode>(deviceMode);
  const mode = chosen ?? device;

  useEffect(() => {
    try {
      for (const k of OLD_KEYS) localStorage.removeItem(k);
    } catch {
      // storage unavailable: nothing to clean up
    }
    document.documentElement.removeAttribute("data-palette");
    const q = deviceQuery();
    if (!q) return;
    const onChange = () => setDevice(q.matches ? "dark" : "light");
    q.addEventListener("change", onChange);
    return () => q.removeEventListener("change", onChange);
  }, []);

  // useLayoutEffect, not useEffect: the chart components read CSS variables
  // via getComputedStyle in their own effects. A child's effect fires before
  // its parent's, so with a plain useEffect here the charts would read the
  // previous colours (a real, reported bug). All layout effects run before
  // any plain effect, which fixes the ordering.
  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-mode", mode);
  }, [mode]);

  const setMode = useCallback((m: ThemeMode) => {
    setChosen(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // storage unavailable: the choice still applies for this visit
    }
  }, []);

  return { mode, theme: mode, setMode };
}

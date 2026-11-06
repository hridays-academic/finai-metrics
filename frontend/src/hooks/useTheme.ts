import { useCallback, useLayoutEffect, useState } from "react";

// One axis since the 2026-11 design pass: light or dark. (The green/blue
// colour themes were removed; git history has them.)
export type ThemeMode = "dark" | "light";

// Charts use this only as a useEffect dependency, to know when to re-read
// CSS variables for their lightweight-charts canvas.
export type Theme = ThemeMode;

const MODE_KEY = "finai-metrics-mode";
const LEGACY_THEME_KEY = "finai-metrics-theme";

function getInitialMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(MODE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // storage unavailable -- fall through to the default
  }
  return "dark";
}

export function useTheme(): {
  mode: ThemeMode;
  theme: Theme;
  setMode: (m: ThemeMode) => void;
} {
  const [mode, setModeState] = useState<ThemeMode>(getInitialMode);

  // useLayoutEffect, not useEffect: the chart components read CSS variables
  // via getComputedStyle in their own effects. A child's effect fires before
  // its parent's, so with a plain useEffect here the charts would read the
  // previous mode's colours (a real, reported bug). All layout effects run
  // before any plain effect, which fixes the ordering.
  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-mode", mode);
    try {
      localStorage.setItem(MODE_KEY, mode);
      localStorage.removeItem(LEGACY_THEME_KEY);
    } catch {
      // storage unavailable -- the mode still applies for this visit
    }
  }, [mode]);

  const setMode = useCallback((m: ThemeMode) => setModeState(m), []);

  return { mode, theme: mode, setMode };
}

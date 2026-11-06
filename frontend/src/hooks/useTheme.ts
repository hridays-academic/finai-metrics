import { useCallback, useLayoutEffect, useState } from "react";

// Two independent choices, both saved per browser:
// - mode: light or dark;
// - palette: the Liquid Glass colour theme, Aurora (default) or Graphite.
// They're set as `data-mode` / `data-palette` on <html> (theme.css).
export type ThemeMode = "dark" | "light";
export type Palette = "aurora" | "graphite";

// Charts use this only as a useEffect dependency, to know when to re-read
// CSS variables for their lightweight-charts canvas. Either choice changes
// those variables, so both are in it.
export type Theme = `${ThemeMode}-${Palette}`;

const MODE_KEY = "finai-metrics-mode";
const PALETTE_KEY = "finai-metrics-palette";
const LEGACY_THEME_KEY = "finai-metrics-theme";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable -- the choice still applies for this visit
  }
}

function getInitialMode(): ThemeMode {
  const stored = read(MODE_KEY);
  return stored === "light" ? "light" : "dark";
}

function getInitialPalette(): Palette {
  return read(PALETTE_KEY) === "graphite" ? "graphite" : "aurora";
}

export function useTheme(): {
  mode: ThemeMode;
  palette: Palette;
  theme: Theme;
  setMode: (m: ThemeMode) => void;
  setPalette: (p: Palette) => void;
} {
  const [mode, setModeState] = useState<ThemeMode>(getInitialMode);
  const [palette, setPaletteState] = useState<Palette>(getInitialPalette);

  // useLayoutEffect, not useEffect: the chart components read CSS variables
  // via getComputedStyle in their own effects. A child's effect fires before
  // its parent's, so with a plain useEffect here the charts would read the
  // previous colours (a real, reported bug). All layout effects run before
  // any plain effect, which fixes the ordering.
  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-mode", mode);
    document.documentElement.setAttribute("data-palette", palette);
    write(MODE_KEY, mode);
    write(PALETTE_KEY, palette);
    try {
      localStorage.removeItem(LEGACY_THEME_KEY);
    } catch {
      // nothing to clean up
    }
  }, [mode, palette]);

  const setMode = useCallback((m: ThemeMode) => setModeState(m), []);
  const setPalette = useCallback((p: Palette) => setPaletteState(p), []);

  return { mode, palette, theme: `${mode}-${palette}`, setMode, setPalette };
}

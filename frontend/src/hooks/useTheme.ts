import { useCallback, useLayoutEffect, useState } from "react";

// Two independent axes (2026-08) -- ThemeName picks the color identity,
// ThemeMode picks light/dark appearance within it. See theme.css for the
// resulting 2x2 matrix of actual palettes.
export type ThemeName = "money" | "classic";
export type ThemeMode = "dark" | "light";

// Combined identifier, exported as `Theme` for PriceChart.tsx/
// PriceForecastChart.tsx -- both only ever use this as a useEffect
// dependency to know when to re-read CSS variables for their
// lightweight-charts canvas (which can't pick up new CSS custom
// properties on its own), never branching on the literal value. Either
// axis changing means different CSS variable values, so both need to be
// reflected in the one value those effects depend on.
export type Theme = `${ThemeName}-${ThemeMode}`;

const THEME_KEY = "finai-metrics-theme";
const MODE_KEY = "finai-metrics-mode";

function getInitialThemeName(): ThemeName {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "money" || stored === "classic") return stored;
  // "money" (lowkey money-green & black) is the default theme (2026-08) --
  // "classic" is the original theme, kept fully intact and selectable in
  // SettingsPanel.tsx's theme picker as a no-code-change revert path.
  return "money";
}

function getInitialMode(): ThemeMode {
  const stored = localStorage.getItem(MODE_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return "dark";
}

export function useTheme(): {
  themeName: ThemeName;
  mode: ThemeMode;
  theme: Theme;
  setThemeName: (t: ThemeName) => void;
  setMode: (m: ThemeMode) => void;
} {
  const [themeName, setThemeNameState] = useState<ThemeName>(getInitialThemeName);
  const [mode, setModeState] = useState<ThemeMode>(getInitialMode);

  // useLayoutEffect, not useEffect -- see the Theme type comment above:
  // PriceChart.tsx/PriceForecastChart.tsx each have their own effect that
  // reads CSS variables via getComputedStyle (cssVar()) right after this
  // one runs. React runs ALL useLayoutEffects (in every component) before
  // ANY useEffect in the same commit, regardless of parent/child position
  // -- but within the same effect type, a child's effect still fires
  // before its parent's. useTheme() lives in App.tsx (the root); the two
  // chart components are deep descendants. With a plain useEffect here,
  // their child effects fired *before* this parent effect had actually
  // flipped the data-theme/data-mode attributes, so they read the
  // *previous* combination's colors and never corrected themselves until
  // some unrelated re-render happened to trigger another read -- matching
  // a user-reported bug where the charts "glitched" specifically after a
  // theme/mode change, and specifically after a search (since that's the
  // only time these two chart components are mounted at all).
  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-theme", themeName);
    document.documentElement.setAttribute("data-mode", mode);
    localStorage.setItem(THEME_KEY, themeName);
    localStorage.setItem(MODE_KEY, mode);
  }, [themeName, mode]);

  const setThemeName = useCallback((t: ThemeName) => setThemeNameState(t), []);
  const setMode = useCallback((m: ThemeMode) => setModeState(m), []);

  return { themeName, mode, theme: `${themeName}-${mode}`, setThemeName, setMode };
}

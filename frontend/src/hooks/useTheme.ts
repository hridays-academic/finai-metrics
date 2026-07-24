import { useCallback, useLayoutEffect, useState } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "finai-metrics-theme";

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return "dark"; // dark mode is the default theme for this app
}

export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void; toggleTheme: () => void } {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  // useLayoutEffect, not useEffect -- PriceChart.tsx/PriceForecastChart.tsx
  // each have their own [theme]-triggered effect that reads CSS variables
  // via getComputedStyle (cssVar()) to re-theme their lightweight-charts
  // canvases, since a <canvas> can't just pick up new CSS custom properties
  // on its own. React runs ALL useLayoutEffects (in every component) before
  // ANY useEffect in the same commit, regardless of parent/child position --
  // but within the same effect type, child effects still fire before parent
  // effects. This hook lives in App.tsx (the root), and those charts are
  // deep descendants, so a plain useEffect here would let their effects
  // (children) run and read the CSS variables BEFORE this one (the parent)
  // had actually flipped the `data-theme` attribute -- reading the stale
  // theme's colors and never correcting them until some unrelated re-render
  // happened to trigger a re-read. That's what read as charts "glitching"
  // after a dark/light toggle. useLayoutEffect here guarantees the
  // attribute (and therefore every CSS variable) is already updated before
  // those child useEffects ever run.
  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggleTheme = useCallback(
    () => setThemeState((prev) => (prev === "dark" ? "light" : "dark")),
    []
  );

  return { theme, setTheme, toggleTheme };
}

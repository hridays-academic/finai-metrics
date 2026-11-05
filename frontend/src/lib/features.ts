// Feature flags. The Return Calculator and Market Simulator are hidden while
// the app focuses on the Results League (2026-10); their code stays in place.
// Paper Trading joined them (2026-11) because it shows ~15-minute-delayed
// prices; bringing it back also needs ENABLE_PAPER_TRADING=true on the
// backend. Set VITE_SHOW_EXTRA_TOOLS=true at build time to bring them back.
export const SHOW_EXTRA_TOOLS = import.meta.env.VITE_SHOW_EXTRA_TOOLS === "true";

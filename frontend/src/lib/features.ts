// Feature flags. The Return Calculator and Market Simulator are hidden while
// the app focuses on the Results League (2026-10); their code stays in place.
// Set VITE_SHOW_EXTRA_TOOLS=true at build time to bring them back.
export const SHOW_EXTRA_TOOLS = import.meta.env.VITE_SHOW_EXTRA_TOOLS === "true";

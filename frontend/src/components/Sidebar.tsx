export type View = "search" | "calculator" | "simulator" | "trading";

interface SidebarProps {
  view: View;
  onChange: (view: View) => void;
}

// Slim icon rail pinned to the left edge, full viewport height -- the app's
// primary nav between the three top-level pages (stock search, return
// calculator, market simulator). Icons match Header.tsx's gear icon: 1.6
// stroke width, currentColor, no fill, so all icon-buttons in the app read
// as one family.
export default function Sidebar({ view, onChange }: SidebarProps) {
  return (
    <nav className="sidebar" aria-label="Primary">
      <button
        type="button"
        className={`sidebar-icon-button ${view === "search" ? "active" : ""}`}
        aria-label="Stock search"
        aria-current={view === "search"}
        title="Stock search"
        onClick={() => onChange("search")}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M20 20L15.8 15.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>

      <button
        type="button"
        className={`sidebar-icon-button ${view === "calculator" ? "active" : ""}`}
        aria-label="Return calculator"
        aria-current={view === "calculator"}
        title="Return calculator"
        onClick={() => onChange("calculator")}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="4.5" y="2.5" width="15" height="19" rx="2.2" stroke="currentColor" strokeWidth="1.8" />
          <rect x="7" y="5" width="10" height="4.2" rx="0.8" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="8.4" cy="13.3" r="1" fill="currentColor" />
          <circle cx="12" cy="13.3" r="1" fill="currentColor" />
          <circle cx="15.6" cy="13.3" r="1" fill="currentColor" />
          <circle cx="8.4" cy="17" r="1" fill="currentColor" />
          <circle cx="12" cy="17" r="1" fill="currentColor" />
          <circle cx="15.6" cy="17" r="1" fill="currentColor" />
        </svg>
      </button>

      <button
        type="button"
        className={`sidebar-icon-button ${view === "simulator" ? "active" : ""}`}
        aria-label="Market simulator"
        aria-current={view === "simulator"}
        title="Market simulator"
        onClick={() => onChange("simulator")}
      >
        {/* Solid bars (real past history) crossed by a dashed rising line
            (a simulated/hypothetical path) -- distinguishes this from the
            calculator's icon at a glance without needing a dice/random
            glyph that wouldn't obviously read as "stock market" on its own. */}
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M5 20V13M11 20V9M17 20V15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path
            d="M4 11L9.5 6L14.5 9L20 3.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="1 3.2"
          />
        </svg>
      </button>

      <button
        type="button"
        className={`sidebar-icon-button ${view === "trading" ? "active" : ""}`}
        aria-label="Paper trading"
        aria-current={view === "trading"}
        title="Paper trading"
        onClick={() => onChange("trading")}
      >
        {/* A candlestick pair -- the most unambiguous "trading" glyph,
            distinct from the calculator's grid+dots and the simulator's
            solid-bars-plus-dashed-line at a glance. */}
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M7 3v4M7 15v6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <rect x="4.5" y="7" width="5" height="8" rx="1" stroke="currentColor" strokeWidth="1.6" />
          <path d="M17 3v9M17 19v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <rect x="14.5" y="9" width="5" height="10" rx="1" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
    </nav>
  );
}

export type View = "search" | "calculator";

interface SidebarProps {
  view: View;
  onChange: (view: View) => void;
}

// Slim icon rail pinned to the left edge, full viewport height -- the app's
// primary nav between the two top-level pages (stock search, return
// calculator). Icons match Header.tsx's gear icon: 1.6 stroke width,
// currentColor, no fill, so all icon-buttons in the app read as one family.
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
    </nav>
  );
}

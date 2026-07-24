import Logo from "./Logo";
import type { UserPublic } from "../lib/types";

interface HeaderProps {
  onOpenSettings: () => void;
  onOpenAuth: () => void;
  onGoHome: () => void;
  user: UserPublic | null;
}

export default function Header({ onOpenSettings, onOpenAuth, onGoHome, user }: HeaderProps) {
  return (
    <header className="app-header">
      <Logo onClick={onGoHome} />
      <div className="app-header-actions">
        <button
          className="icon-button"
          aria-label={user ? `Account -- signed in as ${user.name}` : "Sign in"}
          title={user ? `Signed in as ${user.name}` : "Sign in"}
          onClick={onOpenAuth}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="M4.5 19.5c1.5-3.5 5-5 7.5-5s6 1.5 7.5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          {/* Small dot when signed in -- same badge convention as the sidebar's
              active-view highlight, just a corner indicator instead of a fill. */}
          {user && <span className="icon-button-badge" aria-hidden="true" />}
        </button>
        <button
          className="icon-button"
          aria-label="Settings"
          title="Settings"
          onClick={onOpenSettings}
        >
          {/* Gear icon, light grey via CSS (--text-tertiary) per design spec */}
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7Z"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="M19.4 13a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V19a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H4a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 5.6 8.09a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H10a1.65 1.65 0 0 0 1-1.51V2a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V8a1.65 1.65 0 0 0 1.51 1H20a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
              stroke="currentColor"
              strokeWidth="1.6"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}

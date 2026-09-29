import { useEffect, useState } from "react";
import Header from "./components/Header";
import SettingsPanel from "./components/SettingsPanel";
import AuthPanel from "./components/AuthPanel";
import Sidebar, { type View } from "./components/Sidebar";
import CompanySearch from "./components/CompanySearch";
import MetricsDashboard from "./components/MetricsDashboard";
import ReturnCalculator from "./components/ReturnCalculator";
import StockMarketSimulator from "./components/StockMarketSimulator";
import PaperTrading from "./components/PaperTrading";
import ResetPasswordPanel from "./components/ResetPasswordPanel";
import { useTheme } from "./hooks/useTheme";
import { fetchCompany, fetchMe, ApiError } from "./lib/api";
import { getAuthToken } from "./lib/auth";
import type { CompanyFinancialsResponse, UserPublic } from "./lib/types";

export default function App() {
  const { theme, themeName, mode, setThemeName, setMode } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  // Sign-in is purely for activity tracking, not a gate on using the app --
  // every existing feature works fully signed-out, this is additive.
  const [user, setUser] = useState<UserPublic | null>(null);
  // Set once, synchronously, from the URL a password-reset email links to
  // (main.py's /api/auth/forgot-password builds "<origin>/?reset_token=...").
  // Read directly from location.search rather than a router -- this app has
  // no client-side routing at all (see App.tsx's plain view-state pattern
  // elsewhere), so a query param is the simplest way to support one single
  // deep-linkable case without adding a router just for this.
  const [resetToken, setResetToken] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("reset_token")
  );
  const [view, setView] = useState<View>("search");
  const [company, setCompany] = useState<CompanyFinancialsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped on "go home" to force CompanySearch to remount, clearing its
  // internal (uncontrolled) search-box text along with everything else.
  const [homeKey, setHomeKey] = useState(0);

  useEffect(() => {
    // The app used to keep a user's own Tapetide API key here. That
    // integration is gone; delete any key a previous version left behind.
    try {
      localStorage.removeItem("finai_tapetide_key");
    } catch {
      // storage unavailable (e.g. private mode) -- nothing to clean up
    }
    // Restore a signed-in session from localStorage's token on page load --
    // fetchMe() returns null (not an error) for a missing/expired token, so
    // this is safe to call unconditionally rather than checking the token
    // exists first.
    if (getAuthToken()) {
      fetchMe().then(setUser);
    }
  }, []);

  async function handleSearch(query: string) {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCompany(query);
      setCompany(data);
    } catch (err) {
      setCompany(null);
      setError(err instanceof ApiError ? err.message : "Failed to fetch company data.");
    } finally {
      setLoading(false);
    }
  }

  // Clicking the logo goes back to the empty state, same as a fresh page
  // load -- no network call, just resets local state.
  function handleGoHome() {
    setView("search");
    setCompany(null);
    setLoading(false);
    setError(null);
    setHomeKey((k) => k + 1);
  }

  return (
    <div className="app-shell">
      {/* Full-viewport ambient background -- see .app-backdrop in app.css. */}
      <div className="app-backdrop" aria-hidden="true">
        <div className="app-backdrop-glow" />
      </div>

      <Sidebar view={view} onChange={setView} />

      <div className="app-shell-content">
        <Header
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenAuth={() => setAuthOpen(true)}
          onGoHome={handleGoHome}
          user={user}
        />

        {/* All four top-level views stay mounted at all times now (2026-09),
            toggled purely via CSS (.view-wrapper/.view-hidden, see app.css) --
            switching tabs used to unmount whichever branch a ternary wasn't
            rendering, silently discarding Return Calculator's/Simulator's own
            picked-stock and form state every time, unlike the search page
            (which never lost its data on tab-switch only because `company`
            happens to live in this component, not because the branch itself
            avoided unmounting). Real user complaint: had to re-search/re-pick
            a stock every time they came back to a tab. None of the three
            has a mount-time network effect (all only fetch on explicit user
            action -- picking a stock), so keeping all four alive in the
            background costs nothing extra. Paper Trading (added 2026-09,
            see CLAUDE.md) additionally gates its own live-quote polling on
            `visible` (this view being the active one) for the same reason --
            see PaperTrading.tsx/useLiveQuotes.ts. */}
        <main className="app-main">
          <div className={`view-wrapper ${view === "search" ? "" : "view-hidden"}`}>
            <CompanySearch
              key={homeKey}
              onSearch={handleSearch}
              loading={loading}
              error={error}
            />

            <div className="content-grid">
              <div className="metrics-pane">
                {company ? (
                  <MetricsDashboard data={company} theme={theme} />
                ) : (
                  <div className="empty-state">
                    {/* A real magnifying glass -- the circle IS the lens
                        (fully containing the trend line inside it, not
                        overlapping/clipping it), with an actual handle
                        extending from the rim. Reads unambiguously as
                        "search," which the previous version (a checkmark
                        line with an off-center ring randomly behind it,
                        the line's own end poking outside the circle)
                        didn't -- that one had no real reason for the
                        circle to be there at all. */}
                    <div className="empty-state-icon" aria-hidden="true">
                      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.8" />
                        <path
                          d="M6 12.5L9 9L11.5 10.8L14.5 6.5"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path d="M15.3 15.3L20.5 20.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                      </svg>
                    </div>
                    <h2>No company loaded yet</h2>
                    <p>Search an NSE/BSE-listed company above to see its financial metrics.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className={`view-wrapper ${view === "calculator" ? "" : "view-hidden"}`}>
            <ReturnCalculator theme={theme} />
          </div>

          <div className={`view-wrapper ${view === "simulator" ? "" : "view-hidden"}`}>
            <StockMarketSimulator theme={theme} />
          </div>

          <div className={`view-wrapper ${view === "trading" ? "" : "view-hidden"}`}>
            <PaperTrading theme={theme} visible={view === "trading"} />
          </div>
        </main>
      </div>

      {settingsOpen && (
        <SettingsPanel
          themeName={themeName}
          mode={mode}
          onSetThemeName={setThemeName}
          onSetMode={setMode}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {authOpen && (
        // Doesn't close itself on a successful sign in/up -- the panel
        // switches to the "Your Account" + activity view in place instead,
        // so signing in visibly shows something happened rather than just
        // vanishing (only the small badge on the header icon would've
        // hinted otherwise).
        <AuthPanel user={user} onAuthChange={setUser} onClose={() => setAuthOpen(false)} />
      )}

      {/* Shown when a visitor arrives from a password-reset email link
          ("?reset_token=..."), read once on mount -- see the state
          declaration above for why a query param rather than a router. */}
      {resetToken && (
        <ResetPasswordPanel
          token={resetToken}
          onDone={() => {
            setResetToken(null);
            // Strips the token out of the URL so it doesn't linger in
            // browser history / survive a reload and re-trigger this.
            const url = new URL(window.location.href);
            url.searchParams.delete("reset_token");
            window.history.replaceState({}, "", url.toString());
          }}
        />
      )}

    </div>
  );
}

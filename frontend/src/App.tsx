import { useEffect, useRef, useState } from "react";
import Header from "./components/Header";
import SettingsPanel from "./components/SettingsPanel";
import AuthPanel from "./components/AuthPanel";
import TapetideKeyGate from "./components/TapetideKeyGate";
import Sidebar, { type View } from "./components/Sidebar";
import CompanySearch from "./components/CompanySearch";
import MetricsDashboard from "./components/MetricsDashboard";
import ReturnCalculator from "./components/ReturnCalculator";
import StockMarketSimulator from "./components/StockMarketSimulator";
import PaperTrading from "./components/PaperTrading";
import { useTheme } from "./hooks/useTheme";
import { fetchCompany, fetchQuota, fetchMe, ApiError } from "./lib/api";
import { getAuthToken } from "./lib/auth";
import { getTapetideKey, setTapetideKey } from "./lib/tapetideKey";
import type { CompanyFinancialsResponse, QuotaStatus, UserPublic } from "./lib/types";

export default function App() {
  const { theme, themeName, mode, setThemeName, setMode } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  // Read synchronously (localStorage, not a fetch) so there's no flash of
  // ungated content before the gate can render -- see TapetideKeyGate.tsx.
  const [tapetideKey, setTapetideKeyState] = useState<string | null>(() => getTapetideKey());
  // Sign-in is purely for activity tracking, not a gate on using the app --
  // every existing feature works fully signed-out, this is additive. It
  // does now feed into the Tapetide gate too, though (see the effect below
  // and TapetideKeyGate.tsx): a returning signed-in user's saved key can
  // fill in `tapetideKey` above without ever showing the gate.
  const [user, setUser] = useState<UserPublic | null>(null);
  // True once the stored-auth-token check below has resolved (or there was
  // never a token to check, in which case this starts true) -- lets
  // TapetideKeyGate.tsx avoid flashing its "sign in / sign up" welcome step
  // for a split second before a returning user's session (and possibly
  // their saved key) has actually loaded.
  const [sessionChecked, setSessionChecked] = useState<boolean>(() => !getAuthToken());
  const [view, setView] = useState<View>("search");
  const [company, setCompany] = useState<CompanyFinancialsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local estimate of Tapetide's daily quota (see backend's QuotaStatus) --
  // fetched on mount and refreshed after every search/price-history load, so
  // the "~N searches left today" counter next to the search box stays current.
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  // ISO timestamp for when Tapetide's daily quota resets, learned from
  // whichever request last saw its quota-exceeded message (analyst consensus
  // or price history silently falling back to yfinance).
  const [tapetideResetAt, setTapetideResetAt] = useState<string | null>(null);
  // Bumped on "go home" to force CompanySearch to remount, clearing its
  // internal (uncontrolled) search-box text along with everything else.
  const [homeKey, setHomeKey] = useState(0);
  // Session-only (not persisted) -- dismissing the sign-in nudge just hides
  // it until the next full page load, doesn't set a "never show again" flag.
  const [signInBannerDismissed, setSignInBannerDismissed] = useState(false);

  // A search fires TWO quota refreshes -- one right after /api/company
  // resolves (handleSearch's finally, below), and a second, more-accurate
  // one once /api/price-history finishes (handleTapetideResetAtChange,
  // via PriceChart -- price history is 3 of the search's 5 Tapetide
  // calls, so the first refresh reflects an incomplete count). Nothing
  // guarantees the second call's response arrives after the first's, so
  // without this guard the *earlier*, less-accurate response could land
  // second and silently overwrite the correct one -- a real, intermittently
  // reproducing bug caught via live testing, not a hypothetical. Only ever
  // apply the response from the most recently *initiated* call.
  const quotaRequestId = useRef(0);

  function refreshQuota() {
    const requestId = ++quotaRequestId.current;
    fetchQuota()
      .then((data) => {
        if (requestId === quotaRequestId.current) setQuota(data);
      })
      .catch(() => {
        // Best-effort -- the counter just doesn't render if this fails.
      });
  }

  useEffect(() => {
    refreshQuota();
    // Restore a signed-in session from localStorage's token on page load --
    // fetchMe() returns null (not an error) for a missing/expired token, so
    // this is safe to call unconditionally rather than checking the token
    // exists first.
    if (getAuthToken()) {
      fetchMe()
        .then((u) => {
          setUser(u);
          // Only adopt the account's saved key if this browser doesn't
          // already have one -- never clobber a key someone's actively
          // using locally just because they happen to also be signed into
          // an account with a different saved key.
          if (u?.tapetide_key && !getTapetideKey()) {
            setTapetideKey(u.tapetide_key);
            setTapetideKeyState(u.tapetide_key);
          }
        })
        .finally(() => setSessionChecked(true));
    }
  }, []);

  async function handleSearch(query: string) {
    setLoading(true);
    setError(null);
    setTapetideResetAt(null);
    try {
      const data = await fetchCompany(query);
      setCompany(data);
      if (data.tapetide_reset_at) setTapetideResetAt(data.tapetide_reset_at);
    } catch (err) {
      setCompany(null);
      setError(err instanceof ApiError ? err.message : "Failed to fetch company data.");
    } finally {
      setLoading(false);
      refreshQuota();
    }
  }

  function handleTapetideResetAtChange(resetAt: string | null) {
    if (resetAt) setTapetideResetAt(resetAt);
    refreshQuota();
  }

  // Clicking the logo goes back to the empty state, same as a fresh page
  // load -- no network call, just resets local state.
  function handleGoHome() {
    setView("search");
    setCompany(null);
    setLoading(false);
    setError(null);
    setTapetideResetAt(null);
    setHomeKey((k) => k + 1);
  }

  return (
    <div className="app-shell">
      <Sidebar view={view} onChange={setView} />

      <div className="app-shell-content">
        <Header
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenAuth={() => setAuthOpen(true)}
          onGoHome={handleGoHome}
          user={user}
        />

        {/* Additive nudge, not a gate -- see "Accounts & activity tracking"
            in CLAUDE.md. Every feature below still works with this dismissed
            (or never signed in at all). */}
        {!user && !signInBannerDismissed && (
          <div className="signin-banner" role="status">
            <span>You're not signed in -- sign in to keep track of your search activity.</span>
            <div className="signin-banner-actions">
              <button type="button" className="signin-banner-link" onClick={() => setAuthOpen(true)}>
                Sign In
              </button>
              <button
                type="button"
                className="signin-banner-dismiss"
                aria-label="Dismiss"
                onClick={() => setSignInBannerDismissed(true)}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
        )}

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
              quota={quota}
              tapetideResetAt={tapetideResetAt}
            />

            <div className="content-grid">
              <div className="metrics-pane">
                {company ? (
                  <MetricsDashboard
                    data={company}
                    theme={theme}
                    onTapetideResetAtChange={handleTapetideResetAtChange}
                  />
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
            <ReturnCalculator quota={quota} onQuotaSpent={refreshQuota} theme={theme} />
          </div>

          <div className={`view-wrapper ${view === "simulator" ? "" : "view-hidden"}`}>
            <StockMarketSimulator quota={quota} onQuotaSpent={refreshQuota} theme={theme} />
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
          user={user}
          onTapetideKeyChange={() => {
            setTapetideKeyState(getTapetideKey());
            refreshQuota();
          }}
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

      {/* Blocking overlay, not conditionally rendered instead of the app --
          the app tree stays fully mounted underneath so there's something
          real (blurred) behind the gate rather than a blank page. Every
          Tapetide-touching request behind it will 400 until this clears --
          the gate still blocks all interaction regardless. */}
      {!tapetideKey && (
        <TapetideKeyGate
          user={user}
          sessionChecked={sessionChecked}
          onAuthChange={setUser}
          onKeySet={() => {
            setTapetideKeyState(getTapetideKey());
            refreshQuota();
          }}
        />
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
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
import AdminPage from "./components/AdminPage";
import SiteFooter from "./components/SiteFooter";
import Wallpaper from "./components/Wallpaper";
import LegalPage from "./components/LegalPage";
import TermsPrompt from "./components/TermsPrompt";
import LeagueHome from "./components/league/LeagueHome";
import ForecastPage from "./components/league/ForecastPage";
import ResultsPage from "./components/league/ResultsPage";
import ResearchLanding from "./components/news/ResearchLanding";
import { clearRoute, leaveRoute, navigate, replaceRoute, useHashRoute } from "./lib/router";
import { clearForecastDrafts } from "./lib/forecastDrafts";
import { useTheme } from "./hooks/useTheme";
import { useCursorLight } from "./hooks/useCursorLight";
import { useRevealFallback } from "./hooks/useRevealFallback";
import { markFreshNavigation, scrollPageToTop, useScrollMemory } from "./hooks/useScrollMemory";
import { SHOW_EXTRA_TOOLS } from "./lib/features";
import { fetchCompany, fetchMe, recordVisit, ApiError } from "./lib/api";
import { getAuthToken } from "./lib/auth";
import type { CompanyFinancialsResponse, UserPublic } from "./lib/types";

// A company or results page opened from Home.
type HomePage = { name: "event" | "results"; id: number } | null;

function samePage(a: HomePage, b: HomePage): boolean {
  return a?.name === b?.name && a?.id === b?.id;
}

// One aggregate count per page load (see recordVisit). Module-level so React
// StrictMode's dev-only double effect run can't count a load twice.
let visitRecorded = false;

export default function App() {
  const { theme, mode, palette, setMode, setPalette } = useTheme();
  useCursorLight();
  useRevealFallback();
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
  // Home (the league stock picker) is the landing page (2026-10).
  const [view, setView] = useState<View>("home");
  // Hash routes (#/event/12, #/admin) take over the main area. #/league is
  // just another address for Home.
  const route = useHashRoute();
  const showHome = route?.name === "league" || (view === "home" && route === null);
  const isLegalRoute = route?.name === "privacy" || route?.name === "terms";
  // A company page belongs to Home in the nav; admin and legal pages to nothing.
  const navView: View | null =
    route?.name === "admin" || isLegalRoute ? null : route !== null ? "home" : view;
  const [company, setCompany] = useState<CompanyFinancialsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `homeAt` is where Home was last (its list, or a page opened from it),
  // so the Home tab can return there. `keptPage` is the last page opened
  // from Home, kept mounted (hidden) even under the list, so Back/Forward and
  // tab switches return to it with its scroll and typed inputs intact. Both
  // update during render, not in an effect, so they never lag the route.
  const homePage: HomePage = route?.name === "event" || route?.name === "results" ? route : null;
  const [homeAt, setHomeAt] = useState<HomePage>(homePage);
  if (navView === "home" && !samePage(homeAt, homePage)) setHomeAt(homePage);
  const [keptPage, setKeptPage] = useState<HomePage>(homePage);
  if (homePage && !samePage(keptPage, homePage)) setKeptPage(homePage);
  // Home's list mounts on first view and then stays, like Research.
  const [homeListMounted, setHomeListMounted] = useState(showHome);
  if (showHome && !homeListMounted) setHomeListMounted(true);

  const pageKey = route
    ? route.name === "league"
      ? "home"
      : "id" in route
        ? `${route.name}:${route.id}`
        : route.name
    : view;
  useScrollMemory(pageKey);

  // Unsaved forecast drafts belong to whoever typed them: drop them on
  // sign-out or a switch of account (but keep them through signing in).
  const previousUserId = useRef<number | null>(null);
  useEffect(() => {
    const id = user?.id ?? null;
    if (previousUserId.current !== null && previousUserId.current !== id) clearForecastDrafts();
    previousUserId.current = id;
  }, [user?.id]);

  useEffect(() => {
    if (!visitRecorded) {
      visitRecorded = true;
      recordVisit(resetToken ? "reset_password" : route ? route.name : "home");
    }
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

  // A company page's "Open in Research": load that company on Research and
  // remember the page, for "Back to forecast".
  const [researchFrom, setResearchFrom] = useState<{ eventId: number; name: string } | null>(null);
  const [researchPrefill, setResearchPrefill] = useState<string | undefined>(undefined);
  function openInResearch(symbol: string, from: { eventId: number; name: string }) {
    setResearchFrom(from);
    setResearchPrefill(symbol);
    markFreshNavigation();
    leaveRoute();
    setView("search");
    handleSearch(symbol);
  }

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

  // Tabs keep their place. Tapping the tab you're on goes back to its start:
  // Home's company page returns to the list, anything else scrolls to the top.
  function handleChangeView(next: View) {
    setResearchFrom(null);
    if (next === navView) {
      if (next === "home" && homePage) {
        leaveRoute();
        setView("home");
      } else {
        scrollPageToTop();
      }
      return;
    }
    setView(next);
    if (next === "home" && homeAt) replaceRoute(`#/${homeAt.name}/${homeAt.id}`);
    else clearRoute();
  }

  // Only reachable for admins (Sidebar renders the button for is_admin only).
  // A history entry, so Back returns to the page you came from.
  function handleOpenAdmin() {
    setResearchFrom(null);
    if (route?.name === "admin") scrollPageToTop();
    else navigate("#/admin");
  }

  // The logo behaves like the Home tab. Research keeps its loaded company.
  function handleGoHome() {
    handleChangeView("home");
  }

  return (
    // `lg` = the Liquid Glass layer (2026-11), on every page.
    <div className="app-shell lg">
      <Wallpaper />

      <Sidebar
        view={navView}
        onChange={handleChangeView}
        user={user}
        adminActive={route?.name === "admin"}
        onOpenAdmin={handleOpenAdmin}
      />

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
          {/* Kept mounted once seen (it refetches its lists each time it's
              shown), so its scroll position and companies survive. */}
          {homeListMounted && (
            <div className={`view-wrapper ${showHome ? "" : "view-hidden"}`}>
              <LeagueHome user={user} onOpenAuth={() => setAuthOpen(true)} visible={showHome} />
            </div>
          )}

          <div className={`view-wrapper ${view === "search" && route === null ? "" : "view-hidden"}`}>
            <CompanySearch
              onSearch={handleSearch}
              loading={loading}
              error={error}
              prefill={researchPrefill}
              backTo={researchFrom}
              onBack={() => setResearchFrom(null)}
            />

            <div className="content-grid">
              <div className="metrics-pane">
                {company ? <MetricsDashboard data={company} theme={theme} /> : <ResearchLanding />}
                <SiteFooter />
              </div>
            </div>
          </div>

          {/* Hidden behind a flag while the league is the focus (lib/features.ts). */}
          {SHOW_EXTRA_TOOLS && (
            <>
              <div className={`view-wrapper ${view === "calculator" && route === null ? "" : "view-hidden"}`}>
                <ReturnCalculator theme={theme} />
              </div>

              <div className={`view-wrapper ${view === "simulator" && route === null ? "" : "view-hidden"}`}>
                <StockMarketSimulator theme={theme} />
              </div>

              {/* Also hidden because it shows ~15-minute-delayed prices; its
                  backend endpoints need ENABLE_PAPER_TRADING too. */}
              <div className={`view-wrapper ${view === "trading" && route === null ? "" : "view-hidden"}`}>
                <PaperTrading theme={theme} visible={view === "trading" && route === null} />
              </div>
            </>
          )}

          {route?.name === "admin" && (
            <div className="view-wrapper">
              <AdminPage user={user} onOpenAuth={() => setAuthOpen(true)} />
            </div>
          )}
          {(route?.name === "privacy" || route?.name === "terms") && (
            <div className="view-wrapper">
              <LegalPage kind={route.name} />
            </div>
          )}
          {keptPage?.name === "results" && (
            <div className={`view-wrapper ${route?.name === "results" ? "" : "view-hidden"}`}>
              <ResultsPage key={keptPage.id} eventId={keptPage.id} user={user} onOpenAuth={() => setAuthOpen(true)} />
            </div>
          )}
          {keptPage?.name === "event" && (
            <div className={`view-wrapper ${route?.name === "event" ? "" : "view-hidden"}`}>
              <ForecastPage
                key={keptPage.id}
                eventId={keptPage.id}
                user={user}
                onUserChange={setUser}
                onOpenAuth={() => setAuthOpen(true)}
                theme={theme}
                onOpenInResearch={openInResearch}
                visible={route?.name === "event"}
              />
            </div>
          )}
        </main>
      </div>

      {settingsOpen && (
        <SettingsPanel
          user={user}
          onAccountDeleted={() => {
            setUser(null);
            setSettingsOpen(false);
          }}
          mode={mode}
          palette={palette}
          onSetPalette={setPalette}
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

      {/* Accounts created before the Terms/Privacy Policy existed (or before
          their latest version) agree here on their next visit. Hidden on
          the legal pages themselves so they can be read first. */}
      {user?.needs_terms && !isLegalRoute && <TermsPrompt onAgreed={setUser} onSignedOut={() => setUser(null)} />}

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

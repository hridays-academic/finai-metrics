import { lazy, Suspense, useEffect, useRef, useState } from "react";
import Header from "./components/Header";
import SettingsPanel from "./components/SettingsPanel";
import AuthPanel from "./components/AuthPanel";
import Sidebar, { type View } from "./components/Sidebar";
import CompanySearch from "./components/CompanySearch";
import ResetPasswordPanel from "./components/ResetPasswordPanel";
import SiteFooter from "./components/SiteFooter";
import FreeBall from "./components/FreeBall";
import PageScrollbar from "./components/PageScrollbar";
import { ballStore } from "./lib/ballStore";
import SpotlightIntro from "./components/SpotlightIntro";
import { guideFlagStored, guideSeenHere, markGuideSeenHere, spotlightDecision, startedOnHome } from "./lib/guideSeen";
import TermsPrompt from "./components/TermsPrompt";
import LeagueHome from "./components/league/LeagueHome";
import { clearWorkspaceMemory } from "./lib/workspaceMemory";
import { clearRoute, leaveRoute, navigate, useHashRoute } from "./lib/router";
import NotFound from "./components/NotFound";
import { setPageTitle, titleForRoute } from "./lib/pageMeta";
import { clearForecastDrafts } from "./lib/forecastDrafts";
import { useTheme } from "./hooks/useTheme";
import { markFreshNavigation, scrollPageToTop, useScrollMemory } from "./hooks/useScrollMemory";
import { SHOW_EXTRA_TOOLS } from "./lib/features";
import { fetchCompany, fetchMe, markGuideSeen, recordVisit, ApiError } from "./lib/api";
import { getAuthToken } from "./lib/auth";
import type { CompanyFinancialsResponse, UserPublic } from "./lib/types";

// S5/S7 (master plan): each page downloads when first opened; admin only for admins.
const MetricsDashboard = lazy(() => import("./components/MetricsDashboard"));
const ReturnCalculator = lazy(() => import("./components/ReturnCalculator"));
const StockMarketSimulator = lazy(() => import("./components/StockMarketSimulator"));
const PaperTrading = lazy(() => import("./components/PaperTrading"));
const AdminPage = lazy(() => import("./components/AdminPage"));
const LegalPage = lazy(() => import("./components/LegalPage"));
const GuidePage = lazy(() => import("./components/guide/GuidePage"));
const PracticePage = lazy(() => import("./components/practice/PracticePage"));
const PracticeCasePage = lazy(() => import("./components/practice/PracticeCasePage"));
const ForecastPage = lazy(() => import("./components/league/ForecastPage"));
const ResultsPage = lazy(() => import("./components/league/ResultsPage"));
const WorkspacePage = lazy(() => import("./components/workspace/WorkspacePage"));
const ResearchLanding = lazy(() => import("./components/news/ResearchLanding"));
const QuickRound = lazy(() => import("./components/play/QuickRound"));

// A company, results or research workspace page opened from Home.
type HomePage = { name: "event" | "results" | "workspace"; id: number } | null;

function samePage(a: HomePage, b: HomePage): boolean {
  return a?.name === b?.name && a?.id === b?.id;
}

// One aggregate count per page load (see recordVisit). Module-level so React
// StrictMode's dev-only double effect run can't count a load twice.
let visitRecorded = false;

export default function App() {
  const { theme, choice, setChoice } = useTheme();
  // S10/M1/M2 (master plan): no scroll rise-in or tilt; content is visible on arrival.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  // Sign-in is purely for activity tracking, not a gate on using the app --
  // every existing feature works fully signed-out, this is additive.
  const [user, setUser] = useState<UserPublic | null>(null);
  // False until a stored sign-in has been checked, so the first-visit
  // spotlight can wait to learn whether this account has already seen it.
  const [authChecked, setAuthChecked] = useState(() => !getAuthToken());
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
  // The loose ball plays on Home only: leaving Home puts it back on the slider.
  useEffect(() => {
    if (!showHome) ballStore.dock();
  }, [showHome]);
  const isLegalRoute = route?.name === "privacy" || route?.name === "terms";
  // A company page belongs to Home in the nav; admin, legal pages and the
  // guide to nothing.
  // Quick rounds (#/play) are practice, so they light the Practice tab.
  const showPractice = route?.name === "practice" || route?.name === "play" || (route === null && view === "practice");
  // T17 (master plan): Research has its own address, #/research.
  const showResearch = route?.name === "research" || (route === null && view === "search");
  // T22: exactly one tab lit; none on the guide, legal, admin or not-found pages.
  const navView: View | null =
    route?.name === "admin" || isLegalRoute || route?.name === "learn" || route?.name === "notfound"
      ? null
      : showPractice
        ? "practice"
        : showResearch
          ? "search"
          : route !== null
            ? "home"
            : view;
  // B5: the browser title follows the page.
  useEffect(() => {
    const t = titleForRoute(route);
    if (t !== undefined) setPageTitle(route === null && view === "search" ? "Research" : t);
  }, [route, view]);
  // Back/Forward between tabs: the view follows the address.
  useEffect(() => {
    if (route?.name === "research") setView("search");
    else if (route === null) setView((v) => (v === "search" || v === "practice" ? "home" : v));
  }, [route]);
  const [company, setCompany] = useState<CompanyFinancialsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `homeAt` is where Home was last (its list, or a page opened from it),
  // so the Home tab can return there. `keptPage` is the last page opened
  // from Home, kept mounted (hidden) even under the list, so Back/Forward and
  // tab switches return to it with its scroll and typed inputs intact. Both
  // update during render, not in an effect, so they never lag the route.
  const homePage: HomePage =
    route?.name === "event" || route?.name === "results" || route?.name === "workspace" ? route : null;
  const [homeAt, setHomeAt] = useState<HomePage>(homePage);
  if (navView === "home" && !samePage(homeAt, homePage)) setHomeAt(homePage);
  const [keptPage, setKeptPage] = useState<HomePage>(homePage);
  if (homePage && !samePage(keptPage, homePage)) setKeptPage(homePage);
  // Home's list mounts on first view and then stays, like Research.

  const pageKey = route
    ? route.name === "league"
      ? "home"
      : "id" in route
        ? `${route.name}:${route.id}`
        : route.name === "practice" && route.code
          ? `practice:${route.code}`
          : route.name
    : view;
  useScrollMemory(pageKey);

  // Unsaved forecast drafts belong to whoever typed them: drop them on
  // sign-out or a switch of account (but keep them through signing in).
  const previousUserId = useRef<number | null>(null);
  useEffect(() => {
    const id = user?.id ?? null;
    if (previousUserId.current !== null && previousUserId.current !== id) {
      clearForecastDrafts();
      clearWorkspaceMemory();
    }
    previousUserId.current = id;
  }, [user?.id]);

  useEffect(() => {
    if (!visitRecorded) {
      visitRecorded = true;
      if (route?.name !== "notfound")
        recordVisit(resetToken ? "reset_password" : route ? (route.name === "research" ? "search" : route.name) : "home");
    }
    // The app used to keep a user's own Tapetide API key here. That
    // integration is gone; delete any key a previous version left behind.
    try {
      localStorage.removeItem("finai_tapetide_key");
      // Z2: Paper Trading's tutorial flag is dead (the feature is hidden).
      localStorage.removeItem("finai_paper_trading_tutorial_seen");
    } catch {
      // storage unavailable (e.g. private mode) -- nothing to clean up
    }
    // Restore a signed-in session from localStorage's token on page load --
    // fetchMe() returns null (not an error) for a missing/expired token, so
    // this is safe to call unconditionally rather than checking the token
    // exists first.
    if (getAuthToken()) {
      fetchMe()
        .then(setUser)
        .finally(() => setAuthChecked(true));
    }
  }, []);

  // First-visit spotlight (2026-11-18): once per browser and once per
  // account, only when this page load started on Home (never after a shared
  // link), and never on top of the reset-password or terms prompts. Decided
  // once per page load.
  const [spotlight, setSpotlight] = useState(false);
  const spotlightDecided = useRef(false);
  useEffect(() => {
    if (spotlightDecided.current || !authChecked || !showHome) return;
    spotlightDecided.current = true;
    const decision = spotlightDecision({
      startedOnHome: startedOnHome(),
      seenHere: guideSeenHere(),
      resetToken: resetToken !== null,
      user,
    });
    if (decision === "remember") markGuideSeenHere();
    if (decision === "show") setSpotlight(true);
  }, [authChecked, showHome, resetToken, user]);

  // Seen in this browser before signing in: the account remembers it too.
  useEffect(() => {
    if (user && !user.guide_seen && !spotlight && guideFlagStored()) {
      markGuideSeen().then(setUser).catch(() => {});
    }
  }, [user, spotlight]);

  function closeSpotlight(showMe: boolean) {
    setSpotlight(false);
    markGuideSeenHere();
    if (user) markGuideSeen().then(setUser).catch(() => {});
    if (showMe) {
      markFreshNavigation();
      navigate("#/learn");
    } else {
      requestAnimationFrame(() => document.querySelector<HTMLElement>("#guide-entry a")?.focus());
    }
  }

  // A company page's "Open in Research": load that company on Research and
  // remember the page, for "Back to forecast".
  const [researchFrom, setResearchFrom] = useState<{ eventId: number; name: string } | null>(null);
  const [researchPrefill, setResearchPrefill] = useState<string | undefined>(undefined);
  function openInResearch(symbol: string, from: { eventId: number; name: string }) {
    setResearchFrom(from);
    setResearchPrefill(symbol);
    markFreshNavigation();
    navigate("#/research");
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
  function handleChangeView(next: View, viaLink = false) {
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
    // Home, Practice and Research are links (Sidebar): the click itself moves
    // to their address. The logo and the hidden extra tools come through here.
    if (!viaLink) {
      if (next === "home") navigate(homeAt ? `#/${homeAt.name}/${homeAt.id}` : "#/");
      else if (next === "practice") navigate("#/practice");
      else if (next === "search") navigate("#/research");
      else clearRoute();
    }
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
    <div className="app-shell">
      <div className="app-shell-content">
        <Header
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenAuth={() => setAuthOpen(true)}
          onGoHome={handleGoHome}
          user={user}
          nav={
            <Sidebar
              view={navView}
              onChange={(v) => handleChangeView(v, true)}
              hrefs={{ home: homeAt ? `#/${homeAt.name}/${homeAt.id}` : "#/" }}
              user={user}
              adminActive={route?.name === "admin"}
              onOpenAdmin={handleOpenAdmin}
            />
          }
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
          <Suspense fallback={<div className="page page-loading" aria-busy="true" />}>
          {/* S3/S8 (master plan): only the page on screen is mounted, so hidden
              pages make no requests and run no effects. Places survive through
              useScrollMemory and lib/forecastDrafts; Research's company lives here. */}
          {showHome && <LeagueHome user={user} onOpenAuth={() => setAuthOpen(true)} visible />}

          {showResearch && (
            <div className="page research-page">
              <CompanySearch
                visible={showResearch}
                onSearch={handleSearch}
                loading={loading}
                error={error}
                prefill={researchPrefill}
                backTo={researchFrom}
                onBack={() => setResearchFrom(null)}
              />
              {company ? <MetricsDashboard data={company} theme={theme} /> : <ResearchLanding />}
              <SiteFooter />
            </div>
          )}

          {/* Hidden behind a flag while the league is the focus (lib/features.ts). */}
          {SHOW_EXTRA_TOOLS && (
            <>
              {view === "calculator" && route === null && <ReturnCalculator theme={theme} />}
              {view === "simulator" && route === null && <StockMarketSimulator theme={theme} />}

              {/* Also hidden because it shows ~15-minute-delayed prices; its
                  backend endpoints need ENABLE_PAPER_TRADING too. */}
              {view === "trading" && route === null && <PaperTrading theme={theme} visible />}
            </>
          )}

          {route?.name === "notfound" && <NotFound />}
          {route?.name === "play" && <QuickRound />}
          {route?.name === "learn" && (
            <div className="view-wrapper">
              <GuidePage onOpenResearch={() => handleChangeView("search")} />
            </div>
          )}
          {showPractice && route?.name === "practice" && route.code ? (
            <div className="view-wrapper">
              <PracticeCasePage key={route.code} code={route.code} onOpenAuth={() => setAuthOpen(true)} />
            </div>
          ) : (
            showPractice &&
            route?.name !== "play" && (
              <div className="view-wrapper">
                <PracticePage user={user} />
              </div>
            )
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
          {route?.name === "results" && (
            <ResultsPage key={route.id} eventId={route.id} user={user} onOpenAuth={() => setAuthOpen(true)} />
          )}
          {route?.name === "workspace" && (
              <WorkspacePage
                key={route.id}
                eventId={route.id}
                user={user}
                onUserChange={setUser}
                onOpenAuth={() => setAuthOpen(true)}
                theme={theme}
                visible
              />
          )}
          {route?.name === "event" && (
              <ForecastPage
                key={route.id}
                eventId={route.id}
                user={user}
                onUserChange={setUser}
                onOpenAuth={() => setAuthOpen(true)}
                theme={theme}
                onOpenInResearch={openInResearch}
                visible
              />
          )}
          </Suspense>
        </main>
        {/* The loose ball, once dragged out of Home's scene: Home only (FreeBall.tsx). */}
        {showHome && <FreeBall onHome={() => handleChangeView("home")} />}
        {/* The page's floating scrollbar on mouse devices (PageScrollbar.tsx). */}
        <PageScrollbar />
      </div>

      {settingsOpen && (
        <SettingsPanel
          user={user}
          onAccountDeleted={() => {
            setUser(null);
            setSettingsOpen(false);
          }}
          choice={choice}
          onSetChoice={setChoice}
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

      {spotlight && showHome && (
        <SpotlightIntro targetId="guide-entry" onShowMe={() => closeSpotlight(true)} onSkip={() => closeSpotlight(false)} />
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

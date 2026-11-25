import { type MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import ErrorState from "../ErrorState";
import {
  ApiError, fetchLeagueConfig, fetchLeagueEvent, fetchMyForecast, fetchOutcome, fetchResearchHistory, fetchWorkspace,
} from "../../lib/api";
import { takeFormJump } from "../../lib/forecastDrafts";
import type { Theme } from "../../hooks/useTheme";
import type { EventDetail, EventOutcome, Forecast, LeagueConfig, ResearchHistory, UserPublic } from "../../lib/types";
import { formatCrore, formatDay, lastQuarterValues, lastYearValues, latestLeague, metricFacts, quarterLabel } from "../../lib/leagueFormat";
import ForecastForm from "./ForecastForm";
import LockCountdown, { formatIst } from "./LockCountdown";
import ProfileModal from "./ProfileModal";
import ResearchPanel from "./ResearchPanel";
import SectorExplainer from "./SectorExplainer";
import CompanyStory from "./CompanyStory";
import { colourClass, difficultyOf, fromProviderRows } from "../../lib/difficulty";
import SiteFooter from "../SiteFooter";
import { LEAGUE_FOOTNOTE, OutcomeList } from "./outcome";
import { setPageTitle } from "../../lib/pageMeta";
import FinePrint from "../FinePrint";

function quarterName(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

// The numbers a forecaster wants first, as big figures with their source.
export function KeyStats({ event, history, historyError }: {
  event: EventDetail;
  history: ResearchHistory | null;
  historyError: string | null;
  outcome?: EventOutcome | null;
}) {
  const loading = !history && !historyError;
  const latest = history?.provider_rows[0];
  const when = latest ? `Quarter to ${quarterName(latest.period_end_date)}` : loading ? "Loading" : "Not available";
  const show = (text: string | null) => (loading ? "..." : text ?? "N/A");
  // T2: the league's newest margin, never Yahoo's (a different definition).
  const margin = latestLeague(history?.actuals, "operating_margin");
  return (
    <div className="key-stats">
      <dl className="hero-stats">
        <div>
          <dt>Revenue</dt>
          <dd>{show(formatCrore(latest?.revenue))}</dd>
          <dd className="hero-stat-sub">{when}, Yahoo Finance</dd>
        </div>
        <div>
          <dt>Profit</dt>
          <dd>{show(formatCrore(latest?.net_income))}</dd>
          <dd className="hero-stat-sub">{when}, Yahoo Finance</dd>
        </div>
        <div>
          <dt>Operating margin</dt>
          <dd>{show(margin ? `${margin.value.toFixed(1)}%` : null)}</dd>
          <dd className="hero-stat-sub">{margin ? `Quarter to ${quarterName(margin.end)}, league figure` : when}</dd>
        </div>
      </dl>
      <ul className="grouped-list hero-dates">
        <li className="list-row">
          <span className="list-row-main">
            <span className="list-row-title">{event.status === "scored" ? "Results are in" : "Results expected"}</span>
            <span className="list-row-sub">{event.season_label} results</span>
          </span>
          <span className="list-row-value">{formatDay(event.results_date)}</span>
        </li>
        <li className="list-row">
          <span className="list-row-main">
            <span className="list-row-title">Forecasts</span>
            <span className="list-row-sub">{formatIst(event.lock_at)}</span>
          </span>
          <span className="list-row-value">
            <LockCountdown lockAt={event.lock_at} serverNow={event.server_now} compact />
          </span>
        </li>
      </ul>
      {history && (
        <FinePrint>
          Revenue and profit: {history.provider_source}. Latest quarter available
          {history.provider_as_of ? `, fetched ${formatDay(history.provider_as_of, true)}` : ""}. Definitions are in Research below.
        </FinePrint>
      )}
    </div>
  );
}

interface ForecastPageProps {
  eventId: number;
  user: UserPublic | null;
  onUserChange: (u: UserPublic) => void;
  onOpenAuth: () => void;
  theme: Theme;
  onOpenInResearch: (symbol: string, from: { eventId: number; name: string }) => void;
  // False while another tab is showing; the page stays mounted so its place and inputs survive.
  visible: boolean;
}

export default function ForecastPage({ eventId, user, onUserChange, onOpenAuth, theme, onOpenInResearch, visible }: ForecastPageProps) {
  const [event, setEvent] = useState<EventDetail | null>(null);
  // B5: "Mphasis · Stackly" once the company has loaded.
  useEffect(() => {
    if (event) setPageTitle(event.company.name);
  }, [event]);
  const [config, setConfig] = useState<LeagueConfig | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [history, setHistory] = useState<ResearchHistory | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<EventOutcome | null>(null);
  const [stepsDone, setStepsDone] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [ev, cfg, mine] = await Promise.all([
        fetchLeagueEvent(eventId),
        fetchLeagueConfig(),
        user ? fetchMyForecast(eventId) : Promise.resolve(null),
      ]);
      setEvent(ev);
      setConfig(cfg);
      setForecast(mine);
      setLoadedFor(`${eventId}:${user?.id ?? "anon"}:${ev.status}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load this event.");
    }
  }, [eventId, user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  // Progress for the workspace button; refreshed when the page is shown again.
  useEffect(() => {
    if (!user || !visible) return;
    let cancelled = false;
    fetchWorkspace(eventId)
      .then((w) => !cancelled && setStepsDone(w.state ? w.state.done.length : null))
      .catch(() => !cancelled && setStepsDone(null));
    return () => {
      cancelled = true;
    };
  }, [eventId, user?.id, visible]);

  // Arriving from the worksheet's "Use as a starting point": go to the form.
  const ready = event !== null && config !== null;
  useEffect(() => {
    if (ready && visible && takeFormJump(eventId)) {
      requestAnimationFrame(() => document.getElementById("forecast")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }, [ready, visible, eventId]);

  // Refresh on coming back (the lock may have passed meanwhile). The form
  // only remounts if the event's status changed, so typed inputs stay.
  const wasVisible = useRef(visible);
  useEffect(() => {
    if (visible && !wasVisible.current) load();
    wasVisible.current = visible;
  }, [visible, load]);

  // After scoring: the actual numbers replace the forecast form.
  const scored = event?.status === "scored";
  useEffect(() => {
    if (!scored) return setOutcome(null);
    let cancelled = false;
    fetchOutcome(eventId)
      .then((o) => !cancelled && setOutcome(o))
      .catch(() => !cancelled && setOutcome(null));
    return () => {
      cancelled = true;
    };
  }, [eventId, scored, user?.id]);

  // Shared by the key figures in the header and the research section.
  const companyId = event?.company.id;
  useEffect(() => {
    if (companyId === undefined) return;
    let cancelled = false;
    setHistory(null);
    setHistoryError(null);
    fetchResearchHistory(companyId)
      .then((h) => !cancelled && setHistory(h))
      .catch((err) => !cancelled && setHistoryError(err instanceof ApiError ? err.message : "Couldn't load history."));
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  if (error) {
    return (
      <div className="page">
        <a className="back-link" href="#/league" data-keep-scroll>← Companies</a>
        <ErrorState message={error} />
      </div>
    );
  }
  if (!event || !config) {
    return (
      <div className="page">
        <p className="empty-note">Loading...</p>
      </div>
    );
  }

  const explainer = config.sector_explainers.find((e) => e.sector === event.company.sector);
  const hasKpiTemplate = config.kpi_templates.some((t) => t.sector === event.company.sector);
  const noDisclosedKpi = hasKpiTemplate && !event.metrics.some((m) => m.key === "sector_kpi");

  // A plain "#forecast" link would be read as a route by the hash router, so scroll instead.
  function jumpToForm(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    document.getElementById("forecast")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className={`page company-page round-page company-colour ${colourClass(difficultyOf(fromProviderRows(history?.provider_rows)))}`}>

      {/* C1 (master plan): the round comes first; the story is optional below. */}
      <header className="glass panel company-facts">
        <a className="back-link" href="#/league" data-keep-scroll>
          ← Companies
        </a>
        <h1 className="hero-title round-title">{event.company.name}</h1>
        <p className="meta">
          <span>{event.season_label} results</span>
          <span>
            quarter ending{" "}
            {new Date(`${event.period_end_date}T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}
          </span>
        </p>
        <KeyStats event={event} history={history} historyError={historyError} outcome={outcome} />
        <div className="hero-actions">
          {event.status === "open" && (
            <a className="btn btn-secondary jump-to-form" href="#forecast" onClick={jumpToForm}>
              {forecast ? "Edit your forecast" : "Make your forecast"}
            </a>
          )}
          <a className="btn btn-secondary" href={`#/workspace/${event.id}`}>
            {stepsDone ? `Continue research (${stepsDone} of 10 steps done)` : "Open research workspace"}
          </a>
        </div>
      </header>

      <div className="round-main">
        {event.status === "scored" ? (
          <ScoredPanel event={event} outcome={outcome} />
        ) : (
          <section id="forecast" className="glass panel forecast-section" aria-labelledby="forecast-title">
            <h2 className="panel-title" id="forecast-title">
              Your forecast
            </h2>
            {noDisclosedKpi && (
              <p className="section-text">
                This company doesn't disclose a sector KPI every quarter, so this event only has the two core numbers.
              </p>
            )}
            {/* Remount when the loaded state changes so the form picks up the saved values. */}
            <ForecastForm
              key={loadedFor ?? "loading"}
              event={event}
              lastYear={lastYearValues(history?.actuals, event.period_end_date, event.metrics.map((m) => m.key))}
              lastQuarter={lastQuarterValues(history?.actuals, event.period_end_date, event.metrics.map((m) => m.key))}
              facts={metricFacts(history?.actuals, event.period_end_date, event.metrics.map((m) => m.key), quarterLabel)}
              config={config}
              user={user}
              forecast={forecast}
              onSaved={setForecast}
              onNeedProfile={() => (user ? setProfileOpen(true) : onOpenAuth())}
              onOpenAuth={onOpenAuth}
              onLocked={load}
            />
          </section>
        )}
      </div>

      <details className="about-company glass panel">
        <summary className="panel-title">About this company</summary>
      <CompanyStory
            flat
          event={event}
          explainer={explainer}
          history={history}
          sectorName={explainer?.display_name ?? event.company.sector}
          hasForecast={forecast !== null}
          onJumpToForm={() => document.getElementById("forecast")?.scrollIntoView({ behavior: "smooth", block: "start" })}
        />
        {explainer && <SectorExplainer explainer={explainer} compact />}
      </details>

      <div className="page-main">

        <section className="glass panel" aria-labelledby="research-title">
          <h2 className="panel-title" id="research-title">
            Research
          </h2>
          <ResearchPanel
            event={event}
            theme={theme}
            history={history}
            historyError={historyError}
            onOpenInResearch={(symbol) => onOpenInResearch(symbol, { eventId: event.id, name: event.company.name })}
          />
        </section>
      </div>


      <SiteFooter />

      {profileOpen && user && (
        <ProfileModal
          user={user}
          onClose={() => setProfileOpen(false)}
          onSaved={(u) => {
            onUserChange(u);
            setProfileOpen(false);
          }}
        />
      )}
    </div>
  );
}

// The company page once results are scored: what happened, and where to see more.
export function ScoredPanel({ event, outcome }: { event: EventDetail; outcome: EventOutcome | null }) {
  return (
    <section id="forecast" className="glass panel scored-panel" aria-labelledby="outcome-title">
      <h2 className="panel-title" id="outcome-title">
        How it turned out
      </h2>
      {outcome ? <OutcomeList metrics={outcome.metrics} sector={event.company.sector} /> : <p className="empty-note">Loading...</p>}
      <a className="btn btn-secondary outcome-link" href={`#/results/${event.id}`}>
        {event.submitted ? "See your score" : "See the full results"}
      </a>
      <FinePrint>{LEAGUE_FOOTNOTE}</FinePrint>
    </section>
  );
}

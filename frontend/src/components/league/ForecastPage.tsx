import { type MouseEvent, useCallback, useEffect, useState } from "react";
import { ApiError, fetchLeagueConfig, fetchLeagueEvent, fetchMyForecast } from "../../lib/api";
import type { Theme } from "../../hooks/useTheme";
import type { EventDetail, Forecast, LeagueConfig, UserPublic } from "../../lib/types";
import ForecastForm from "./ForecastForm";
import LockCountdown from "./LockCountdown";
import ProfileModal from "./ProfileModal";
import ResearchPanel from "./ResearchPanel";
import SectorExplainer from "./SectorExplainer";
import SiteFooter from "../SiteFooter";

interface ForecastPageProps {
  eventId: number;
  user: UserPublic | null;
  onUserChange: (u: UserPublic) => void;
  onOpenAuth: () => void;
  theme: Theme;
}

export default function ForecastPage({ eventId, user, onUserChange, onOpenAuth, theme }: ForecastPageProps) {
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [config, setConfig] = useState<LeagueConfig | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

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

  if (error) {
    return (
      <div className="calculator-page">
        <div className="calculator-card">
          <a href="#/league">← Home</a>
          <div className="search-error">{error}</div>
        </div>
      </div>
    );
  }
  if (!event || !config) {
    return (
      <div className="calculator-page">
        <div className="calculator-card calculator-empty-hint">Loading...</div>
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
    <div className="league-page">
      <div className="league-page-header">
        <a href="#/league">← Home</a>
        <h1>
          {event.company.name} <span className="company-ticker">{event.company.ticker}</span>
        </h1>
        <div className="company-meta">
          {event.season_label} results (quarter ending{" "}
          {new Date(`${event.period_end_date}T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}
          ), expected {new Date(`${event.results_date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
        </div>
        <LockCountdown lockAt={event.lock_at} serverNow={event.server_now} />
        <a className="league-jump" href="#forecast" onClick={jumpToForm}>
          Skip to the forecast form ↓
        </a>
      </div>

      <div className="league-company-flow">
        {explainer && <SectorExplainer explainer={explainer} />}

        <section className="calculator-card league-research-card" aria-label="Research">
          <h2>Research</h2>
          <ResearchPanel event={event} theme={theme} />
        </section>

        <section id="forecast" className="calculator-card league-form-card" aria-label="Your forecast">
          <h2>Your forecast</h2>
          {noDisclosedKpi && (
            <p className="calculator-field-note">
              This company doesn't disclose a sector KPI every quarter, so this event only has the two core numbers.
            </p>
          )}
          {/* Remount when the loaded state changes so the form picks up the saved values. */}
          <ForecastForm
            key={loadedFor ?? "loading"}
            event={event}
            config={config}
            user={user}
            forecast={forecast}
            onSaved={setForecast}
            onNeedProfile={() => (user ? setProfileOpen(true) : onOpenAuth())}
            onOpenAuth={onOpenAuth}
            onLocked={load}
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

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
      <div className="page">
        <a className="back-link" href="#/league">← Companies</a>
        <div className="form-error">{error}</div>
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
    <div className="page">
      <header className="page-header">
        <a className="back-link" href="#/league">← Companies</a>
        <h1 className="page-title">
          {event.company.name} <span className="page-title-sub">{event.company.ticker}</span>
        </h1>
        <p className="page-meta">
          {event.season_label} results · quarter ending{" "}
          {new Date(`${event.period_end_date}T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}{" "}
          · expected{" "}
          {new Date(`${event.results_date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
        </p>
        <p className="page-meta">
          <LockCountdown lockAt={event.lock_at} serverNow={event.server_now} />
        </p>
        {event.status === "open" && (
          <a className="btn btn-primary page-header-action" href="#forecast" onClick={jumpToForm}>
            {forecast ? "Edit your forecast" : "Make your forecast"}
          </a>
        )}
      </header>

      {explainer && <SectorExplainer explainer={explainer} />}

      <section className="section" aria-labelledby="research-title">
        <h2 className="section-title" id="research-title">
          Research
        </h2>
        <ResearchPanel event={event} theme={theme} />
      </section>

      <section id="forecast" className="section forecast-section" aria-labelledby="forecast-title">
        <h2 className="section-title" id="forecast-title">
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
          config={config}
          user={user}
          forecast={forecast}
          onSaved={setForecast}
          onNeedProfile={() => (user ? setProfileOpen(true) : onOpenAuth())}
          onOpenAuth={onOpenAuth}
          onLocked={load}
        />
      </section>

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

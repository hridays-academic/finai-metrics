import { useCallback, useEffect, useState } from "react";
import { ApiError, fetchLeagueConfig, fetchLeagueEvent, fetchMyForecast } from "../../lib/api";
import type { Theme } from "../../hooks/useTheme";
import type { EventDetail, Forecast, LeagueConfig, UserPublic } from "../../lib/types";
import ForecastForm from "./ForecastForm";
import LockCountdown from "./LockCountdown";
import ProfileModal from "./ProfileModal";
import ResearchPanel from "./ResearchPanel";

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
          <a href="#/league">← All events</a>
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

  return (
    <div className="league-page">
      <div className="league-page-header">
        <a href="#/league">← All events</a>
        <h1>
          {event.company.name} <span className="company-ticker">{event.company.ticker}</span>
        </h1>
        <div className="company-meta">
          {event.season_label} results (quarter ending{" "}
          {new Date(`${event.period_end_date}T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}
          ), expected {new Date(`${event.results_date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
        </div>
        <LockCountdown lockAt={event.lock_at} serverNow={event.server_now} />
      </div>

      <div className="league-forecast-layout">
        <section className="calculator-card league-form-card" aria-label="Your forecast">
          <h2>Your forecast</h2>
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
        <section className="league-research-col" aria-label="Research">
          <ResearchPanel event={event} theme={theme} />
        </section>
      </div>

      <p className="page-disclaimer">
        Educational forecasting game. Not investment advice. Company data may be delayed or incomplete.
      </p>

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

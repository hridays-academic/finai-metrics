import { type MouseEvent, useCallback, useEffect, useState } from "react";
import { ApiError, fetchLeagueConfig, fetchLeagueEvent, fetchMyForecast, fetchResearchHistory } from "../../lib/api";
import type { Theme } from "../../hooks/useTheme";
import type { EventDetail, Forecast, LeagueConfig, ResearchHistory, UserPublic } from "../../lib/types";
import { formatCrore, formatDay } from "../../lib/leagueFormat";
import TileGrid from "../TileGrid";
import ForecastForm from "./ForecastForm";
import LockCountdown, { formatIst } from "./LockCountdown";
import ProfileModal from "./ProfileModal";
import ResearchPanel from "./ResearchPanel";
import SectorExplainer from "./SectorExplainer";
import SiteFooter from "../SiteFooter";

function quarterName(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

// The numbers a forecaster wants first, as big figures with their source.
function KeyStats({ event, history, historyError }: { event: EventDetail; history: ResearchHistory | null; historyError: string | null }) {
  const loading = !history && !historyError;
  const latest = history?.provider_rows[0];
  const when = latest ? `Quarter to ${quarterName(latest.period_end_date)}` : loading ? "Loading" : "Not available";
  const show = (text: string | null) => (loading ? "..." : text ?? "N/A");
  const margin = latest?.operating_margin_pct;
  return (
    <div className="key-stats">
      <TileGrid className="key-stats-grid" minTile={170}>
        <div className="stat tile">
          <div className="stat-label">Revenue*</div>
          <div className="stat-value">{show(formatCrore(latest?.revenue))}</div>
          <div className="stat-sub">{when}</div>
        </div>
        <div className="stat tile">
          <div className="stat-label">Profit*</div>
          <div className="stat-value">{show(formatCrore(latest?.net_income))}</div>
          <div className="stat-sub">{when}</div>
        </div>
        <div className="stat tile">
          <div className="stat-label">Op. margin*</div>
          <div className="stat-value">{show(margin === null || margin === undefined ? null : `${margin.toFixed(1)}%`)}</div>
          <div className="stat-sub">{when}</div>
        </div>
        <div className="stat tile">
          <div className="stat-label">Results expected</div>
          <div className="stat-value">{formatDay(event.results_date)}</div>
          <div className="stat-sub">{event.season_label} results</div>
        </div>
        <div className="stat tile">
          <div className="stat-label">Forecasts</div>
          <div className="stat-value">
            <LockCountdown lockAt={event.lock_at} serverNow={event.server_now} compact />
          </div>
          <div className="stat-sub">{formatIst(event.lock_at)}</div>
        </div>
      </TileGrid>
      {history && (
        <p className="footnote">
          * {history.provider_source}. Latest quarter available
          {history.provider_as_of ? `, fetched ${formatDay(history.provider_as_of, true)}` : ""}. Definitions are in Research below.
        </p>
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
}

export default function ForecastPage({ eventId, user, onUserChange, onOpenAuth, theme, onOpenInResearch }: ForecastPageProps) {
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [config, setConfig] = useState<LeagueConfig | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [history, setHistory] = useState<ResearchHistory | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

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
      <header className="page-header glass page-hero">
        <a className="back-link" href="#/league">← Companies</a>
        <h1 className="page-title">
          {event.company.name} <span className="page-title-sub">{event.company.ticker}</span>
        </h1>
        <p className="page-meta">
          {event.season_label} results · quarter ending{" "}
          {new Date(`${event.period_end_date}T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}
        </p>
        <KeyStats event={event} history={history} historyError={historyError} />
        {event.status === "open" && (
          <a className="btn btn-primary page-header-action" href="#forecast" onClick={jumpToForm}>
            {forecast ? "Edit your forecast" : "Make your forecast"}
          </a>
        )}
      </header>

      {explainer && <SectorExplainer explainer={explainer} />}

      <section className="section glass panel reveal" aria-labelledby="research-title">
        <h2 className="section-title" id="research-title">
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

      <section id="forecast" className="section glass panel reveal forecast-section" aria-labelledby="forecast-title">
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

import { useEffect, useMemo, useState } from "react";
import { ApiError, fetchLeagueConfig, fetchLeagueEvents, fetchMySeason, fetchResearchHistory } from "../../lib/api";
import { formatCrore, formatDay } from "../../lib/leagueFormat";
import type { EventSummary, LeagueConfig, ResearchHistory, Season, UserPublic } from "../../lib/types";
import SiteFooter from "../SiteFooter";
import LockCountdown from "./LockCountdown";

interface LeagueHomeProps {
  user: UserPublic | null;
  onOpenAuth: () => void;
}

const CARD_COUNT = 4;

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Four random open events, one per sector where possible. Events in
// `exclude` are only used to top up when too few others remain.
function pickCards(pool: EventSummary[], exclude: Set<number>): EventSummary[] {
  const fresh = shuffle(pool.filter((e) => !exclude.has(e.id)));
  const candidates = [...fresh, ...shuffle(pool.filter((e) => exclude.has(e.id)))];
  const picked: EventSummary[] = [];
  const sectors = new Set<string>();
  for (const e of candidates) {
    if (picked.length < CARD_COUNT && !sectors.has(e.company.sector)) {
      picked.push(e);
      sectors.add(e.company.sector);
    }
  }
  for (const e of candidates) {
    if (picked.length < CARD_COUNT && !picked.includes(e)) picked.push(e);
  }
  return picked;
}

type HistoryState = ResearchHistory | "error" | undefined;

interface PickerRowProps {
  event: EventSummary;
  sectorName: string;
  history: HistoryState;
}

function PickerRow({ event, sectorName, history }: PickerRowProps) {
  const latest = history && history !== "error" ? history.provider_rows[0] : undefined;

  let source: string;
  if (history === undefined) source = "Loading the latest quarter...";
  else if (!latest) source = "Latest quarter not available from Yahoo Finance.";
  else
    source =
      `Quarter ending ${formatDay(latest.period_end_date, true)}. Yahoo Finance` +
      (history !== "error" && history.provider_as_of ? `, fetched ${formatDay(history.provider_as_of)}.` : ".");

  return (
    <li>
      <a className="picker-row" href={`#/event/${event.id}`}>
        <div className="picker-row-body">
          <div className="picker-row-meta">
            {sectorName} · Results {formatDay(event.results_date)} · <LockCountdown lockAt={event.lock_at} compact />
          </div>
          <h3 className="picker-row-name">{event.company.name}</h3>
          {event.company.description && <p className="picker-row-desc">{event.company.description}</p>}
          <dl className="picker-figures">
            <div>
              <dt>Revenue</dt>
              <dd>{formatCrore(latest?.revenue) ?? "N/A"}</dd>
            </div>
            <div>
              <dt>Profit</dt>
              <dd>{formatCrore(latest?.net_income) ?? "N/A"}</dd>
            </div>
          </dl>
          <p className="picker-source">{source}</p>
        </div>
        <span className="picker-row-action">
          <span className="picker-row-action-label">{event.submitted ? "View forecast" : "Forecast"}</span>
          <svg width="8" height="14" viewBox="0 0 8 14" fill="none" aria-hidden="true">
            <path d="M1 1l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </a>
    </li>
  );
}

function MyForecasts({ events }: { events: EventSummary[] }) {
  if (events.length === 0) {
    return <p className="empty-note">You haven't made any forecasts yet. Pick a company above.</p>;
  }
  return (
    <ul className="group picker-mine">
      {events.map((e) => (
        <li key={e.id}>
          <a href={e.status === "scored" ? `#/results/${e.id}` : `#/event/${e.id}`}>
            <span className="picker-mine-name">
              {e.company.name} <span className="picker-mine-season">{e.season_label}</span>
            </span>
            <span className="picker-mine-status">
              {e.status === "open" ? (
                <LockCountdown lockAt={e.lock_at} compact />
              ) : e.status === "scored" ? (
                <span className="league-submitted">
                  Score {e.my_score !== null ? e.my_score.toFixed(1) : "N/A"} · See results
                </span>
              ) : (
                `Locked. Results are announced on ${formatDay(e.results_date, true)}; your score appears here after that.`
              )}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function SeasonSoFar({ season }: { season: Season }) {
  if (season.events_scored === 0) {
    return <p className="empty-note">No scored forecasts yet. Scores appear here after results come out.</p>;
  }
  return (
    <div className="picker-season">
      <div>
        <div className="picker-season-value">{season.events_scored}</div>
        <div className="picker-season-label">events scored</div>
      </div>
      <div>
        <div className="picker-season-value">{season.average_score?.toFixed(1)}</div>
        <div className="picker-season-label">average score</div>
      </div>
      <p className="picker-source">
        {season.calibration === null
          ? `Calibration: not enough forecasts yet. It needs ${season.min_metrics_for_calibration} scored numbers; you have ${season.scored_metrics}.`
          : `Calibration: ${season.hits} of your ${season.scored_metrics} ranges contained the result (${Math.round(
              season.calibration * 100
            )}%). Honest 80% ranges should land near 80%.`}
      </p>
    </div>
  );
}

// The default landing page: a stock picker over the open forecast events.
export default function LeagueHome({ user, onOpenAuth }: LeagueHomeProps) {
  const [upcoming, setUpcoming] = useState<EventSummary[] | null>(null);
  const [scored, setScored] = useState<EventSummary[]>([]);
  const [config, setConfig] = useState<LeagueConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<EventSummary[]>([]);
  const [seen, setSeen] = useState<Set<number>>(new Set());
  const [histories, setHistories] = useState<Record<number, HistoryState>>({});
  const [season, setSeason] = useState<Season | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLeagueConfig().then((c) => !cancelled && setConfig(c)).catch(() => {});
    if (user) fetchMySeason().then((s) => !cancelled && setSeason(s)).catch(() => {});
    Promise.all([fetchLeagueEvents("upcoming"), fetchLeagueEvents("scored")])
      .then(([u, s]) => {
        if (cancelled) return;
        setUpcoming(u);
        setScored(s);
      })
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Couldn't load companies."));
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const open = useMemo(() => (upcoming ?? []).filter((e) => e.status === "open"), [upcoming]);

  // Deal the first hand once the events arrive (and again if the open set changes).
  useEffect(() => {
    const first = pickCards(open, new Set());
    setCards(first);
    setSeen(new Set(first.map((e) => e.id)));
  }, [open]);

  // Latest-quarter figures for the visible cards (cached server-side for a week).
  useEffect(() => {
    for (const e of cards) {
      const id = e.company.id;
      if (histories[id] !== undefined) continue;
      fetchResearchHistory(id)
        .then((h) => setHistories((s) => ({ ...s, [id]: h })))
        .catch(() => setHistories((s) => ({ ...s, [id]: "error" })));
    }
  }, [cards]);

  function showOthers() {
    const current = new Set(cards.map((e) => e.id));
    const exhausted = open.every((e) => seen.has(e.id));
    const exclude = exhausted ? current : new Set([...seen, ...current]);
    const next = pickCards(open, exclude);
    setCards(next);
    setSeen(exhausted ? new Set(next.map((e) => e.id)) : new Set([...seen, ...next.map((e) => e.id)]));
  }

  const sectorName = (sector: string) =>
    config?.sector_explainers.find((s) => s.sector === sector)?.display_name ??
    sector.charAt(0).toUpperCase() + sector.slice(1);

  const mine = [...(upcoming ?? []), ...scored].filter((e) => e.submitted);

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Forecast a company's results</h1>
        <p className="page-lede">
          Pick a company that reports soon. For each number, give a range you're 80% sure of. It's scored when the
          results come out.
        </p>
        {!user && (
          <p className="page-note">
            Browse without an account.{" "}
            <button type="button" className="link-button" onClick={onOpenAuth}>
              Sign in
            </button>{" "}
            to forecast.
          </p>
        )}
      </header>

      {error && <div className="form-error">{error}</div>}
      {upcoming === null && !error && <p className="empty-note">Loading companies...</p>}

      {upcoming !== null && open.length === 0 && (
        <section className="section">
          <h2 className="section-title">No companies are open right now</h2>
          <p className="section-text">
            Companies open a week or two before they report. Look up any company in Research meanwhile.
          </p>
        </section>
      )}

      {cards.length > 0 && (
        <section className="section">
          <ul className="group">
            {cards.map((e) => (
              <PickerRow key={e.id} event={e} sectorName={sectorName(e.company.sector)} history={histories[e.company.id]} />
            ))}
          </ul>
          {open.length > CARD_COUNT && (
            <button type="button" className="btn btn-secondary picker-shuffle" onClick={showOthers}>
              Show different companies
            </button>
          )}
        </section>
      )}

      {user && season && (
        <section className="section">
          <h2 className="section-title">Your season so far</h2>
          <SeasonSoFar season={season} />
        </section>
      )}

      {user && upcoming !== null && (
        <section className="section">
          <h2 className="section-title">My forecasts</h2>
          <MyForecasts events={mine} />
        </section>
      )}

      <SiteFooter />
    </div>
  );
}

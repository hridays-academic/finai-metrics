import { useEffect, useMemo, useState } from "react";
import { ApiError, fetchLeagueConfig, fetchLeagueEvents, fetchMySeason, fetchResearchHistory } from "../../lib/api";
import { daysUntil, formatDay } from "../../lib/leagueFormat";
import type { EventSummary, LeagueConfig, ResearchHistory, Season, UserPublic } from "../../lib/types";
import SiteFooter from "../SiteFooter";
import CountUp from "../CountUp";
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

// A locked event is waiting for its results (or, once the results date has
// passed, for an admin to enter and score them).
function waitingLabel(event: EventSummary): string {
  return daysUntil(event.results_date) > 0
    ? `Results due ${formatDay(event.results_date)}`
    : "Results out, scoring soon";
}

function PickerRow({ event, sectorName, history }: PickerRowProps) {
  const isOpen = event.status === "open";
  const latest = history && history !== "error" ? history.provider_rows[0] : undefined;
  const figure = (v: number | null | undefined) =>
    history === undefined ? "..." : v === null || v === undefined ? "N/A" : <CountUp value={v / 1e7} format={crore} />;

  return (
    <li className="reveal-row">
      <a className="picker-row" href={`#/event/${event.id}`}>
        <div className="picker-row-main">
          <h3 className="picker-row-name">{event.company.name}</h3>
          <div className="picker-row-meta">
            {sectorName} ·{" "}
            {isOpen ? (
              <>
                Results {formatDay(event.results_date)} · <LockCountdown lockAt={event.lock_at} compact />
              </>
            ) : (
              <span className="picker-row-waiting">{waitingLabel(event)}</span>
            )}
          </div>
          {event.company.description && <p className="picker-row-desc">{event.company.description}</p>}
        </div>
        <dl className="picker-figures">
          <div>
            <dt>Revenue</dt>
            <dd>{figure(latest?.revenue)}</dd>
          </div>
          <div>
            <dt>Profit</dt>
            <dd>{figure(latest?.net_income)}</dd>
          </div>
        </dl>
        <span className="picker-row-action">
          {isOpen && !event.submitted ? "Forecast" : "View"}
          <svg width="7" height="12" viewBox="0 0 8 14" fill="none" aria-hidden="true">
            <path d="M1 1l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </a>
    </li>
  );
}

function crore(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")} cr`;
}

// Column labels for the figures, shown once per list on wide screens.
function ListHead() {
  return (
    <div className="picker-list-head" aria-hidden="true">
      <span />
      <span>Revenue</span>
      <span>Profit</span>
      <span />
    </div>
  );
}

// One source line per panel instead of one per row.
function SourceNote({ events, histories }: { events: EventSummary[]; histories: Record<number, HistoryState> }) {
  const loaded = events
    .map((e) => histories[e.company.id])
    .filter((h): h is ResearchHistory => h !== undefined && h !== "error");
  const ends = new Set(loaded.map((h) => h.provider_rows[0]?.period_end_date).filter(Boolean));
  const fetched = loaded.map((h) => h.provider_as_of).filter((d): d is string => !!d).sort();
  const quarter = ends.size === 1 ? ` (quarter ending ${formatDay([...ends][0]!, true)})` : "";
  const when = fetched.length ? `, fetched ${formatDay(fetched[fetched.length - 1])}` : "";
  return (
    <p className="panel-footnote">
      Revenue and profit are each company's latest quarter{quarter}, from Yahoo Finance{when}. N/A means Yahoo
      doesn't have it.
    </p>
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
  // Shown when nothing is open, so the page never looks empty between seasons.
  const waiting = useMemo(
    () =>
      open.length > 0
        ? []
        : (upcoming ?? [])
            .filter((e) => e.status === "locked")
            .sort((a, b) => a.results_date.localeCompare(b.results_date)),
    [upcoming, open]
  );

  // Deal the first hand once the events arrive (and again if the open set changes).
  useEffect(() => {
    const first = pickCards(open, new Set());
    setCards(first);
    setSeen(new Set(first.map((e) => e.id)));
  }, [open]);

  // Latest-quarter figures for the visible rows (cached server-side for a week).
  useEffect(() => {
    for (const e of [...cards, ...waiting]) {
      const id = e.company.id;
      if (histories[id] !== undefined) continue;
      fetchResearchHistory(id)
        .then((h) => setHistories((s) => ({ ...s, [id]: h })))
        .catch(() => setHistories((s) => ({ ...s, [id]: "error" })));
    }
  }, [cards, waiting]);

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
    <div className="page home">
      <header className="glass hero">
        <h1 className="hero-title">Forecast a company's results</h1>
        <p className="hero-lede">
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

      {cards.length > 0 && (
        <section className="glass panel reveal" aria-labelledby="open-title">
          <h2 className="panel-title" id="open-title">
            Open for forecasts
          </h2>
          <ListHead />
          <ul className="group">
            {cards.map((e) => (
              <PickerRow key={e.id} event={e} sectorName={sectorName(e.company.sector)} history={histories[e.company.id]} />
            ))}
          </ul>
          <SourceNote events={cards} histories={histories} />
          {open.length > CARD_COUNT && (
            <button type="button" className="btn btn-secondary picker-shuffle" onClick={showOthers}>
              Show different companies
            </button>
          )}
        </section>
      )}

      {upcoming !== null && open.length === 0 && (
        <section className="glass panel reveal" aria-labelledby="waiting-title">
          <h2 className="panel-title" id="waiting-title">
            No companies are open right now
          </h2>
          <p className="panel-text">
            Each company opens for forecasts a week or two before it reports. The next results season starts with the
            companies that report first.
            {waiting.length > 0 && " These forecasts have locked and are waiting for results."}
          </p>
          {waiting.length > 0 && <ListHead />}
          {waiting.length > 0 && (
            <ul className="group">
              {waiting.map((e) => (
                <PickerRow
                  key={e.id}
                  event={e}
                  sectorName={sectorName(e.company.sector)}
                  history={histories[e.company.id]}
                />
              ))}
            </ul>
          )}
          {waiting.length > 0 && <SourceNote events={waiting} histories={histories} />}
        </section>
      )}

      <section className="glass panel reveal how-it-works" aria-labelledby="how-title">
        <h2 className="panel-title" id="how-title">
          How it works
        </h2>
        <ol className="how-steps">
          <li>
            <span className="how-step-number">1</span>
            <h3>Pick a company</h3>
            <p>Choose one that reports its quarterly results soon. The page explains how its business makes money.</p>
          </li>
          <li>
            <span className="how-step-number">2</span>
            <h3>Forecast a range</h3>
            <p>For revenue growth, operating margin and sometimes one sector number, give a range you're 80% sure of.</p>
          </li>
          <li>
            <span className="how-step-number">3</span>
            <h3>Get scored</h3>
            <p>When the results come out, narrow ranges that contain the real number score the most points.</p>
          </li>
        </ol>
      </section>

      {user && season && (
        <section className="glass panel reveal">
          <h2 className="panel-title">Your season so far</h2>
          <SeasonSoFar season={season} />
        </section>
      )}

      {user && upcoming !== null && (
        <section className="glass panel reveal">
          <h2 className="panel-title">My forecasts</h2>
          <MyForecasts events={mine} />
        </section>
      )}

      <SiteFooter />
    </div>
  );
}

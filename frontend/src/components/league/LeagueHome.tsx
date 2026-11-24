import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, fetchLeagueConfig, fetchLeagueEvents, fetchMyResult, fetchMySeason, fetchPracticeCases, fetchResearchHistory, fetchRecentResults } from "../../lib/api";
import { daysUntil, formatCrore, formatDay } from "../../lib/leagueFormat";
import type { EventSummary, LeagueConfig, MetricResult, PracticeCard, ResearchHistory, Season, UserPublic, RecentResult } from "../../lib/types";
import PracticeTile from "../practice/PracticeTile";
import SiteFooter from "../SiteFooter";
import RangeLine from "../RangeLine";
import { metricShortName, outcomeSummary } from "./outcome";
import LockCountdown from "./LockCountdown";
import { colourClass, DIFFICULTY_LABEL, difficultyOf, fromProviderRows } from "../../lib/difficulty";
import { useCompanyDifficulty } from "../../hooks/useCompanyDifficulty";
import DifficultyEdge from "../DifficultyEdge";
import HeroObject from "./HeroObject";
import FinePrint from "../FinePrint";
import { Grain, Guilloche, HeroWaves } from "./CardArt";

interface LeagueHomeProps {
  user: UserPublic | null;
  onOpenAuth: () => void;
  // False while a company page or another tab is showing. Home stays
  // mounted so its scroll position and the companies shown survive.
  visible: boolean;
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

function PickerRow({ event, sectorName, history, index = 0 }: PickerRowProps & { index?: number }) {
  const isOpen = event.status === "open";
  const latest = history && history !== "error" ? history.provider_rows[0] : undefined;
  const figure = (v: number | null | undefined) =>
    history === undefined ? "..." : formatCrore(v) ?? "N/A";
  // The tile's colour says how hard the company is to forecast (lib/difficulty).
  const level = history && history !== "error" ? difficultyOf(fromProviderRows(history.provider_rows)) : null;
  const colour = colourClass(level);

  return (
    <li data-scrub="tile" data-i={index}>
      <a className={`sector-tile ${colour} ${level ? "has-edge" : ""}`} href={`#/event/${event.id}`}>
        <span className="tile-material" aria-hidden="true">
          <Guilloche />
          <Grain />
        </span>
        <DifficultyEdge label={level ? DIFFICULTY_LABEL[level] : null} />
        <span className="tile-sector">{sectorName}</span>
        <h3 className="tile-name">{event.company.name}</h3>
        <span className="tile-when">
          {isOpen ? (
            <>
              <span>Results {formatDay(event.results_date)}</span>
              <LockCountdown lockAt={event.lock_at} compact />
            </>
          ) : (
            <span>{waitingLabel(event)}</span>
          )}
        </span>
        <span className="tile-foot">
          <dl className="tile-stats">
            <div>
              <dt>Revenue</dt>
              <dd>{figure(latest?.revenue)}</dd>
            </div>
            <div>
              <dt>Profit</dt>
              <dd>{figure(latest?.net_income)}</dd>
            </div>
          </dl>
          <span className="btn btn-dark btn-arrow">
            {isOpen && !event.submitted ? "Forecast" : "View"}
            <span className="btn-arrow-icon" aria-hidden="true" />
          </span>
        </span>
      </a>
    </li>
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
    <FinePrint>
      Revenue and profit are each company's latest quarter{quarter}, from Yahoo Finance{when}. N/A means Yahoo
      doesn't have it.
    </FinePrint>
  );
}

// Scored companies, newest first, so Home never only says "nothing is open".
// Each number gets a small range bar: the actual as a dot, plus your range
// for companies you forecast (`mine`, loaded after the page shows).
export function RecentResults({ results, mine = {} }: { results: RecentResult[]; mine?: Record<number, MetricResult[]> }) {
  return (
    <ul className="grouped-list recent-results">
      {results.map((r, i) => (
        <RecentRow key={r.event.id} result={r} mine={mine[r.event.id]} index={i} />
      ))}
    </ul>
  );
}

// One scored company, in its difficulty colour (a swatch and a label), like
// its tile, company page and results page.
function RecentRow({ result: { event: e, metrics }, mine, index }: { result: RecentResult; mine?: MetricResult[]; index: number }) {
  const level = useCompanyDifficulty(e.company.id);
  return (
    <li data-scrub="row" data-i={index}>
      <a className={`list-row recent-row ${colourClass(level)}`} href={`#/results/${e.id}`}>
        <span className="recent-row-swatch" aria-hidden="true" />
        <span className="recent-row-main">
          <span className="recent-row-head">
            <span className="recent-row-name">{e.company.name}</span>
            <span className={`recent-row-status ${e.submitted && e.my_score !== null ? "own-score" : ""}`}>
              {e.submitted && e.my_score !== null ? `Your score ${e.my_score.toFixed(1)}` : "See results"}
            </span>
          </span>
          <span className="meta">
            <span>{e.season_label}</span>
            <span>results {formatDay(e.results_date)}</span>
            {level && <span className="recent-row-difficulty">{DIFFICULTY_LABEL[level]}</span>}
          </span>
          <span className="recent-results-summary">{outcomeSummary(metrics, e.company.sector)}</span>
          <span className="recent-lines" aria-hidden="true">
            {metrics
              .filter((m) => m.actual !== null)
              .map((m) => {
                const r = mine?.find((x) => x.metric_key === m.metric_key);
                return (
                  <span className="recent-line" key={m.metric_key}>
                    <span className="recent-line-name">{metricShortName(m, e.company.sector)}</span>
                    <RangeLine
                      compact
                      low={r ? r.low : null}
                      high={r ? r.high : null}
                      marks={[{ key: "actual", value: m.actual as number, kind: "actual" }]}
                      minSpan={10}
                    />
                  </span>
                );
              })}
          </span>
        </span>
        <Chevron />
      </a>
    </li>
  );
}

function Chevron() {
  return (
    <svg className="chevron" width="8" height="14" viewBox="0 0 8 14" fill="none" aria-hidden="true">
      <path d="M1.5 1.5 6.5 7l-5 5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MyForecasts({ events }: { events: EventSummary[] }) {
  if (events.length === 0) {
    return <p className="empty-note">You haven't made any forecasts yet. Pick a company above.</p>;
  }
  return (
    <ul className="grouped-list my-forecasts">
      {events.map((e) => (
        <li key={e.id}>
          <a className="list-row" href={e.status === "scored" ? `#/results/${e.id}` : `#/event/${e.id}`}>
            <span className="list-row-main">
              <span className="list-row-title">{e.company.name}</span>
              <span className="list-row-sub">{e.season_label}</span>
            </span>
            <span className="list-row-detail">
              {e.status === "open" ? (
                <LockCountdown lockAt={e.lock_at} compact />
              ) : e.status === "scored" ? (
                <span className="own-score">Score {e.my_score !== null ? e.my_score.toFixed(1) : "N/A"}</span>
              ) : (
                `Locked. Results are announced on ${formatDay(e.results_date, true)}; your score appears here after that.`
              )}
            </span>
            <Chevron />
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
export default function LeagueHome({ user, onOpenAuth, visible }: LeagueHomeProps) {
  const [upcoming, setUpcoming] = useState<EventSummary[] | null>(null);
  const [scored, setScored] = useState<EventSummary[]>([]);
  const [config, setConfig] = useState<LeagueConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cardIds, setCardIds] = useState<number[]>([]);
  const [seen, setSeen] = useState<Set<number>>(new Set());
  const [histories, setHistories] = useState<Record<number, HistoryState>>({});
  const [season, setSeason] = useState<Season | null>(null);
  const [recent, setRecent] = useState<RecentResult[]>([]);
  const [recentMine, setRecentMine] = useState<Record<number, MetricResult[]>>({});
  const [showAllRecent, setShowAllRecent] = useState(false);

  // Refetch on coming back, so e.g. a forecast just saved on a company page
  // shows up at once.
  const [refresh, setRefresh] = useState(0);
  const wasVisible = useRef(visible);
  useEffect(() => {
    if (visible && !wasVisible.current) setRefresh((n) => n + 1);
    wasVisible.current = visible;
  }, [visible]);

  useEffect(() => {
    let cancelled = false;
    fetchLeagueConfig().then((c) => !cancelled && setConfig(c)).catch(() => {});
    if (user) fetchMySeason().then((s) => !cancelled && setSeason(s)).catch(() => {});
    fetchRecentResults().then((r) => !cancelled && setRecent(r)).catch(() => {});
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
  }, [user?.id, refresh]);

  // Your ranges for the five most recent companies you forecast, fetched
  // after the page shows and never blocking it; other rows show the actual
  // only. (Backlog: return these inside recent-results, one request.)
  const recentKey = recent.filter((r) => r.event.submitted).slice(0, 5).map((r) => r.event.id).join(",");
  useEffect(() => {
    if (!user || !recentKey) return;
    let cancelled = false;
    for (const id of recentKey.split(",").map(Number)) {
      if (recentMine[id]) continue;
      fetchMyResult(id)
        .then((r) => !cancelled && setRecentMine((s) => ({ ...s, [id]: r.metrics })))
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, recentKey]);

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

  // Deal the first hand once the events arrive. A refresh keeps the same
  // companies unless one of them has closed (or a new one fills a gap).
  const openKey = open.map((e) => e.id).join(",");
  useEffect(() => {
    const ids = new Set(open.map((e) => e.id));
    if (cardIds.length === Math.min(CARD_COUNT, open.length) && cardIds.every((id) => ids.has(id))) return;
    const first = pickCards(open, new Set());
    setCardIds(first.map((e) => e.id));
    setSeen(new Set(first.map((e) => e.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey]);
  const cards = useMemo(
    () => cardIds.map((id) => open.find((e) => e.id === id)).filter((e): e is EventSummary => e !== undefined),
    [cardIds, open]
  );

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
    setCardIds(next.map((e) => e.id));
    setSeen(exhausted ? new Set(next.map((e) => e.id)) : new Set([...seen, ...next.map((e) => e.id)]));
  }

  const sectorName = (sector: string) =>
    config?.sector_explainers.find((s) => s.sector === sector)?.display_name ??
    sector.charAt(0).toUpperCase() + sector.slice(1);

  const mine = [...(upcoming ?? []), ...scored].filter((e) => e.submitted);

  const side = user && (season || upcoming !== null);

  return (
    <div className="page home">
      <header className="home-hero">
        <HeroWaves />
        <div className="home-hero-text">
        <h1 className="hero-title">
          Forecast company <span className="hero-title-gold">results</span>
        </h1>
        {!user && (
          <p className="hero-note">
            Look around for free.{" "}
            <button type="button" className="link-button" onClick={onOpenAuth}>
              Sign in
            </button>{" "}
            to make your forecasts.
          </p>
        )}
        <GuideStrip />
        </div>
        <HeroObject />
      </header>

      {error && <div className="form-error">{error}</div>}
      {upcoming === null && !error && <p className="empty-note">Loading companies...</p>}

      {upcoming !== null && open.length === 0 && <PracticeWhileYouWait />}

      {cards.length > 0 && (
        <section className="section" aria-labelledby="open-title">
          <div className="section-head" data-scrub="title">
            <h2 className="section-title" id="open-title">
              Your turn: pick a company
            </h2>
            {open.length > CARD_COUNT && (
              <button type="button" className="btn btn-tertiary" onClick={showOthers}>
                Shuffle companies
              </button>
            )}
          </div>
          <ul className="company-grid">
            {cards.map((e, i) => (
              <PickerRow key={e.id} index={i} event={e} sectorName={sectorName(e.company.sector)} history={histories[e.company.id]} />
            ))}
          </ul>
          <SourceNote events={cards} histories={histories} />
        </section>
      )}

      {/* Always shown (2026-11-18): below the open companies, or above
          "No companies are open right now" when none are. */}
      {cards.length > 0 && <PracticeWhileYouWait />}

      {upcoming !== null && open.length === 0 && (
        <section className="section" aria-labelledby="waiting-title">
          <h2 className="section-title" id="waiting-title">
            No companies are open right now
          </h2>
          <p className="section-text">
            Each company opens for forecasts a week or two before it reports. The next results season starts with the
            companies that report first.
            {waiting.length > 0 && " These forecasts have locked and are waiting for results."}
          </p>
          {waiting.length > 0 && (
            <ul className="company-grid">
              {waiting.map((e, i) => (
                <PickerRow
                  key={e.id}
                  index={i}
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

      {(recent.length > 0 || side) && (
        <div className={`home-columns ${side && recent.length > 0 ? "" : "single"}`}>
          {recent.length > 0 && (
            <section className="glass panel" aria-labelledby="recent-title" data-scrub="panel" data-i={0}>
              <h2 className="panel-title" id="recent-title">
                Just reported
              </h2>
              <RecentResults results={showAllRecent ? recent : recent.slice(0, 5)} mine={recentMine} />
              {!showAllRecent && recent.length > 5 && (
                <button type="button" className="btn btn-tertiary card-more" onClick={() => setShowAllRecent(true)}>
                  Show all results
                </button>
              )}
            </section>
          )}
          {side && (
            <div className="home-side">
              {season && (
                <section className="glass panel" data-scrub="panel" data-i={1}>
                  <h2 className="panel-title">Your season so far</h2>
                  <SeasonSoFar season={season} />
                </section>
              )}
              {upcoming !== null && (
                <section className="glass panel" data-scrub="panel" data-i={2}>
                  <h2 className="panel-title">My forecasts</h2>
                  <MyForecasts events={mine} />
                </section>
              )}
            </div>
          )}
        </div>
      )}


      <SiteFooter />
    </div>
  );
}

// The short way into the guide (replaced the "How to play" band, 2026-11-18).
// The first-visit spotlight circles it (SpotlightIntro.tsx, id below).
export function GuideStrip() {
  return (
    <div className="guide-strip strip-panel" id="guide-entry">
      <span className="guide-strip-text">
        <span className="guide-strip-title">New to forecasting?</span>
        <span className="guide-strip-line">Ten short pages: what results are, how to forecast them and how you score.</span>
      </span>
      <a className="btn btn-secondary btn-compact guide-strip-button" href="#/learn">
        Start the guide
      </a>
    </div>
  );
}

// Three practice companies in Mystery mode (2026-11-18, wording approved):
// right under the hero between seasons, below the open companies otherwise.
// Hidden if there are none or they can't load.
function PracticeWhileYouWait() {
  const [cards, setCards] = useState<PracticeCard[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchPracticeCases(true)
      .then((all) => {
        if (cancelled) return;
        const pool = [...all];
        const picked: PracticeCard[] = [];
        while (picked.length < 3 && pool.length) picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
        setCards(picked);
      })
      .catch(() => !cancelled && setCards([]));
    return () => {
      cancelled = true;
    };
  }, []);
  if (!cards || cards.length === 0) return null;
  return (
    <section className="section practice-wait" aria-labelledby="practice-wait-title">
      <div className="section-head" data-scrub="title">
        <h2 className="section-title" id="practice-wait-title">
          Practice while you wait
        </h2>
        <a className="btn btn-tertiary" href="#/practice">
          All practice companies
        </a>
      </div>
      <p className="section-text">Try a past quarter. You'll see your score straight away.</p>
      <ul className="company-grid practice-grid">
        {cards.map((c, i) => (
          <PracticeTile key={c.code} card={c} index={i} badge />
        ))}
      </ul>
    </section>
  );
}

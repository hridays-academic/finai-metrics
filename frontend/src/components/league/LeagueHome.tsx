import { type MouseEvent, useEffect, useMemo, useState } from "react";
import { ApiError, fetchLeagueConfig, fetchLeagueEvents, fetchResearchHistory } from "../../lib/api";
import { formatCrore, formatDay, resultsCountdown } from "../../lib/leagueFormat";
import type { EventSummary, LeagueConfig, ResearchHistory, UserPublic } from "../../lib/types";
import SiteFooter from "../SiteFooter";
import LockCountdown, { formatIst } from "./LockCountdown";

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

// Hover-capable pointer (desktop): hover expands a card and a click opens
// it. Touch: the first tap expands, the second opens.
function canHover(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;
}

type HistoryState = ResearchHistory | "error" | undefined;

interface PickerCardProps {
  event: EventSummary;
  sectorName: string;
  history: HistoryState;
  expanded: boolean;
  onExpand: () => void;
}

function PickerCard({ event, sectorName, history, expanded, onExpand }: PickerCardProps) {
  const latest = history && history !== "error" ? history.provider_rows[0] : undefined;

  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    if (!expanded && !canHover()) {
      e.preventDefault();
      onExpand();
    }
  }

  let source: string;
  if (history === undefined) source = "Loading the latest quarter...";
  else if (!latest) source = "Latest quarter not available from Yahoo Finance.";
  else
    source =
      `Quarter ending ${formatDay(latest.period_end_date, true)}. Source: Yahoo Finance` +
      (history !== "error" && history.provider_as_of ? `, fetched ${formatDay(history.provider_as_of)}.` : ".");

  return (
    <a className={`picker-card ${expanded ? "expanded" : ""}`} href={`#/event/${event.id}`} onClick={handleClick}>
      <div className="picker-card-top">
        <span className="picker-sector">{sectorName}</span>
        <span className="picker-countdown">{resultsCountdown(event.results_date)}</span>
      </div>
      <h3 className="picker-name">{event.company.name}</h3>
      {event.company.description && <p className="picker-desc">{event.company.description}</p>}
      <div className="picker-more">
        <div className="picker-more-inner">
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
          <p className="picker-source">
            Results expected {formatDay(event.results_date)}. Forecasts lock {formatIst(event.lock_at)}.
          </p>
          <span className="picker-cta">{event.submitted ? "View your forecast →" : "Make your forecast →"}</span>
        </div>
      </div>
    </a>
  );
}

function MyForecasts({ events }: { events: EventSummary[] }) {
  if (events.length === 0) {
    return <div className="calculator-empty-hint">You haven't made any forecasts yet. Pick a company above.</div>;
  }
  return (
    <ul className="picker-mine">
      {events.map((e) => (
        <li key={e.id}>
          <a href={`#/event/${e.id}`}>
            <span className="picker-mine-name">
              {e.company.name} <span className="trading-table-stock-ticker">{e.season_label}</span>
            </span>
            <span className="picker-mine-status">
              {e.status === "open" ? (
                <LockCountdown lockAt={e.lock_at} compact />
              ) : e.status === "scored" ? (
                "Scored"
              ) : (
                `Locked. Results ${formatDay(e.results_date)}`
              )}
            </span>
          </a>
        </li>
      ))}
    </ul>
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
  const [expanded, setExpanded] = useState<number | null>(null);
  const [histories, setHistories] = useState<Record<number, HistoryState>>({});

  useEffect(() => {
    let cancelled = false;
    fetchLeagueConfig().then((c) => !cancelled && setConfig(c)).catch(() => {});
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
    setExpanded(null);
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
    setExpanded(null);
  }

  const sectorName = (sector: string) =>
    config?.sector_explainers.find((s) => s.sector === sector)?.display_name ??
    sector.charAt(0).toUpperCase() + sector.slice(1);

  const mine = [...(upcoming ?? []), ...scored].filter((e) => e.submitted);

  return (
    <div className="calculator-page">
      <div className="calculator-card trading-card picker-page">
        <h2>Pick a company to forecast</h2>
        <p className="calculator-subtitle">
          Before a company reports its quarterly results, forecast a few of its numbers as a range you're 80% sure of.
          Forecasts lock before the announcement, then get scored against what the company actually reports.
        </p>
        {!user && (
          <div className="calculator-field-note">
            You can look around without an account.{" "}
            <button type="button" className="auth-forgot-link" onClick={onOpenAuth}>
              Sign in
            </button>{" "}
            to make forecasts.
          </div>
        )}
        {error && <div className="search-error">{error}</div>}
        {upcoming === null && !error && <div className="calculator-empty-hint">Loading...</div>}

        {upcoming !== null && open.length === 0 && (
          <div className="picker-empty">
            <h3>The next results season starts soon</h3>
            <p>
              Companies open for forecasts a week or two before they report their quarterly results. Check back soon.
              In the meantime, you can look up any company under Research.
            </p>
          </div>
        )}

        {cards.length > 0 && (
          <>
            <div className="picker-grid">
              {cards.map((e) => (
                <PickerCard
                  key={e.id}
                  event={e}
                  sectorName={sectorName(e.company.sector)}
                  history={histories[e.company.id]}
                  expanded={expanded === e.id}
                  onExpand={() => setExpanded(e.id)}
                />
              ))}
            </div>
            {open.length > CARD_COUNT && (
              <button type="button" className="settings-row-action picker-shuffle" onClick={showOthers}>
                Show me 4 others
              </button>
            )}
          </>
        )}

        {user && upcoming !== null && (
          <>
            <div className="trading-section-header">My forecasts</div>
            <MyForecasts events={mine} />
          </>
        )}

        <SiteFooter />
      </div>
    </div>
  );
}

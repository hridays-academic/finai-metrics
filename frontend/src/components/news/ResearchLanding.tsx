import { useEffect, useState } from "react";
import ErrorState from "../ErrorState";
import { ApiError, fetchMacro, fetchNews, fetchResearchCompanies, fetchWorldEvents, type ResearchCompany } from "../../lib/api";
import LearnBasics from "./LearnBasics";
import type { MacroSeries, NewsItem, NewsView, WorldEvent } from "../../lib/types";
import NewsSourceNote from "./NewsSourceNote";
import NewsCards from "./NewsCards";
import WorldEvents from "./WorldEvents";
import MacroCharts from "./MacroCharts";

const VIEWS: { key: NewsView; label: string }[] = [
  { key: "all", label: "All" },
  { key: "economy", label: "Economy & policy" },
  { key: "cement", label: "Cement" },
  { key: "autos", label: "Autos" },
  { key: "fmcg", label: "Everyday goods" },
  { key: "it", label: "IT" },
];

// The Research page before a company is loaded: world events, themed news
// with our "why it may matter" line, and macro charts on the 30-day lag.
// N7 (phase 7): headlines from today (India time), then the rest of the week.
export function splitByDay(items: NewsItem[], now = new Date()): { today: NewsItem[]; week: NewsItem[] } {
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const today = day(now);
  return {
    today: items.filter((i) => day(new Date(i.published_at)) === today),
    week: items.filter((i) => day(new Date(i.published_at)) !== today),
  };
}

export default function ResearchLanding({ onPick }: { onPick?: (symbol: string) => void } = {}) {
  const [view, setView] = useState<NewsView>("all");
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<WorldEvent[]>([]);
  const [macro, setMacro] = useState<MacroSeries[]>([]);
  // null while loading: the tiles' space is held so nothing below jumps.
  const [companies, setCompanies] = useState<ResearchCompany[] | null>(null);

  useEffect(() => {
    fetchWorldEvents().then(setEvents).catch(() => {});
    fetchMacro().then(setMacro).catch(() => {});
    fetchResearchCompanies().then(setCompanies).catch(() => setCompanies([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    fetchNews(view)
      .then((r) => {
        if (cancelled) return;
        setItems(r.items);
        setHasMore(r.has_more);
        setUpdatedAt(r.updated_at);
      })
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Couldn't load the news."));
    return () => {
      cancelled = true;
    };
  }, [view]);

  function showMore() {
    if (!items) return;
    fetchNews(view, items.length)
      .then((r) => {
        setItems([...items, ...r.items]);
        setHasMore(r.has_more);
      })
      .catch(() => setHasMore(false));
  }

  // N6: "Affects: Maruti Suzuki" for headlines in a league company's sector.
  const affects = (item: NewsItem) =>
    (companies ?? []).filter((c) => (item.sectors ?? []).includes(c.sector_name)).map((c) => c.name);
  const groups = items ? splitByDay(items) : null;

  return (
    <div className="research-landing">
      {/* RW1 (phase 7, approved 2.40): the league's companies first. */}
      {(companies === null || companies.length > 0) && (
        <section className="glass panel research-companies" aria-labelledby="research-companies-title" aria-busy={companies === null}>
          <h2 className="panel-title" id="research-companies-title">
            League and practice companies
          </h2>
          <ul className="research-company-grid">
            {(companies ?? []).map((c) => (
              <li key={c.symbol}>
                <button type="button" className="research-company" onClick={() => onPick?.(c.symbol)}>
                  <strong>{c.name}</strong>
                  <span>{c.sector_name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="glass panel news-panel" aria-labelledby="news-title">
        <h2 className="panel-title" id="news-title">
          News
        </h2>
        <div className="segmented news-views" role="tablist" aria-label="Show news for">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={view === v.key}
              className={view === v.key ? "active" : ""}
              onClick={() => setView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>
        {error && <ErrorState message={error} />}
        {!items && !error && <p className="empty-note">Loading...</p>}
        {items && items.length === 0 && (
          <p className="empty-note">No recent headlines on these topics yet. They're checked every hour.</p>
        )}
        {groups && groups.today.length > 0 && (
          <>
            <h3 className="news-group-title">Today</h3>
            <NewsCards items={groups.today} affects={affects} />
          </>
        )}
        {groups && groups.week.length > 0 && (
          <>
            <h3 className="news-group-title">This week</h3>
            <NewsCards items={groups.week} topStory={groups.today.length === 0} affects={affects} />
          </>
        )}
        {hasMore && (
          <button type="button" className="btn btn-secondary" onClick={showMore}>
            Show more
          </button>
        )}
        <NewsSourceNote updatedAt={updatedAt} />
      </section>


      {/* Below the news, so it can't push the headlines down when it arrives. */}
      <WorldEvents events={events} />

      <LearnBasics />

      <MacroCharts series={macro} />
    </div>
  );
}

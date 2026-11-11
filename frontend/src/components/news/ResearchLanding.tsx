import { useEffect, useState } from "react";
import { ApiError, fetchMacro, fetchNews, fetchVideos, fetchWorldEvents } from "../../lib/api";
import type { MacroSeries, NewsItem, NewsView, Video, WorldEvent } from "../../lib/types";
import VideoCards from "./VideoCards";
import NewsSourceNote from "./NewsSourceNote";
import NewsCards from "./NewsCards";
import WorldEvents from "./WorldEvents";
import MacroCharts from "./MacroCharts";

const VIEWS: { key: NewsView; label: string }[] = [
  { key: "all", label: "All" },
  { key: "economy", label: "Economy & policy" },
  { key: "cement", label: "Cement" },
  { key: "autos", label: "Autos" },
  { key: "fmcg", label: "FMCG" },
  { key: "it", label: "IT" },
];

// The Research page before a company is loaded: world events, themed news
// with our "why it may matter" line, and macro charts on the 30-day lag.
export default function ResearchLanding() {
  const [view, setView] = useState<NewsView>("all");
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<WorldEvent[]>([]);
  const [macro, setMacro] = useState<MacroSeries[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);

  useEffect(() => {
    fetchWorldEvents().then(setEvents).catch(() => {});
    fetchMacro().then(setMacro).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    fetchVideos(view)
      .then((v) => !cancelled && setVideos(v))
      .catch(() => !cancelled && setVideos([]));
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

  return (
    <div className="research-landing">
      <WorldEvents events={events} />

      <section className="glass panel reveal news-panel" aria-labelledby="news-title">
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
        {error && <div className="form-error">{error}</div>}
        {!items && !error && <p className="empty-note">Loading...</p>}
        {items && items.length === 0 && (
          <p className="empty-note">No recent headlines on these topics yet. They're checked every hour.</p>
        )}
        {items && items.length > 0 && <NewsCards items={items} />}
        {hasMore && (
          <button type="button" className="btn btn-secondary" onClick={showMore}>
            Show more
          </button>
        )}
        <NewsSourceNote updatedAt={updatedAt} />
      </section>

      <VideoCards videos={videos} />

      <MacroCharts series={macro} />
    </div>
  );
}

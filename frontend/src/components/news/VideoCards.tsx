import { useState } from "react";
import type { Video } from "../../lib/types";
import { timeAgo } from "./NewsCards";
import ThemeIcon from "./ThemeIcon";
import TileGrid from "../TileGrid";
import { CARD_MIN } from "./NewsCards";
import { useWhyItMatters, WhySummary } from "./WhyItMatters";
import FinePrint from "../FinePrint";

function duration(s: number | null): string | null {
  if (s === null || s <= 0) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

// The video's thumbnail from our own stored copy (2026-11-18; the backend
// downloads it once from YouTube, so the page itself asks YouTube for
// nothing), or our theme illustration if there is no copy or it fails to
// load. YouTube's player (the privacy-enhanced youtube-nocookie.com domain)
// loads only when the visitor clicks.
function VideoCard({ v }: { v: Video }) {
  const [playing, setPlaying] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const thumb = v.has_thumbnail && !thumbFailed;
  const why = useWhyItMatters<HTMLButtonElement>({ title: "Why it matters", chain: v.chain, explanation: v.explanation });
  const len = duration(v.duration_seconds);
  return (
    <article className={`video-card theme-${v.theme}`}>
      <div className="video-card-inner">
      {playing ? (
        <div className="video-frame">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.video_id)}?autoplay=1&rel=0`}
            title={v.title}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : (
        <button type="button" className="video-poster" onClick={() => setPlaying(true)} aria-label={`Play video: ${v.title}`}>
          {thumb ? (
            <img
              className="video-thumb"
              src={`/api/videos/${encodeURIComponent(v.video_id)}/thumbnail`}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setThumbFailed(true)}
            />
          ) : (
            <ThemeIcon theme={v.theme} size={44} />
          )}
          <span className="video-play" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5.5v13l11-6.5z" />
            </svg>
          </span>
          {len && <span className="video-length">{len}</span>}
        </button>
      )}
      <div className="news-card-body">
        <div className="news-card-meta">
          <span>{v.channel} on YouTube</span>
          <span aria-hidden="true">·</span>
          <time dateTime={v.published_at}>{timeAgo(v.published_at)}</time>
        </div>
        <p className="news-card-headline video-title">{v.title}</p>
        <WhySummary summary={v.why} triggerProps={why.triggerProps} has={why.has} />
        <div className="news-card-chips">
          <span className="theme-chip">
            <ThemeIcon theme={v.theme} size={14} />
            {v.theme_label}
          </span>
        </div>
      </div>
      </div>
      {why.overlay}
    </article>
  );
}

export default function VideoCards({ videos, title = "Videos" }: { videos: Video[]; title?: string }) {
  if (videos.length === 0) return null;
  return (
    <section className="glass panel news-panel" aria-labelledby="videos-title">
      <h2 className="panel-title" id="videos-title">
        {title}
      </h2>
      <TileGrid className="news-grid" minTile={CARD_MIN} pairOnPhones={false}>
        {videos.map((v) => (
          <VideoCard key={v.video_id} v={v} />
        ))}
      </TileGrid>
      <FinePrint>
        From news channels on YouTube: BBC News, Reuters, DW News, Al Jazeera English, CNBC-TV18, ET Now, NDTV Profit
        and WION. Nothing loads from YouTube until you press play; then YouTube's player (its privacy-enhanced mode)
        loads and YouTube's own privacy policy applies. Picked by topic, not endorsed by Stackly.
      </FinePrint>
    </section>
  );
}

import { useState } from "react";
import type { Video } from "../../lib/types";
import { timeAgo } from "./NewsCards";
import ThemeIcon from "./ThemeIcon";

function duration(s: number | null): string | null {
  if (s === null || s <= 0) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

// Our own illustration first; YouTube's player (the privacy-enhanced
// youtube-nocookie.com domain) loads only when the visitor clicks, so
// nothing is sent to YouTube or Google before that.
function VideoCard({ v }: { v: Video }) {
  const [playing, setPlaying] = useState(false);
  const [open, setOpen] = useState(false);
  const len = duration(v.duration_seconds);
  return (
    <article className={`video-card tile theme-${v.theme}`}>
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
          <ThemeIcon theme={v.theme} size={44} />
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
          <span>{v.channel}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={v.published_at}>{timeAgo(v.published_at)}</time>
        </div>
        <p className="news-card-headline video-title">{v.title}</p>
        <div className="news-card-chips">
          <span className="theme-chip">
            <ThemeIcon theme={v.theme} size={14} />
            {v.theme_label}
          </span>
        </div>
        <button type="button" className="why-toggle" aria-expanded={open} title={open ? undefined : v.why} onClick={() => setOpen((x) => !x)}>
          Why it matters
          <svg className={`why-chevron ${open ? "open" : ""}`} width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="why-panel" hidden={!open}>
          <p>{v.why}</p>
        </div>
      </div>
    </article>
  );
}

export default function VideoCards({ videos, title = "Videos" }: { videos: Video[]; title?: string }) {
  if (videos.length === 0) return null;
  return (
    <section className="glass panel reveal" aria-labelledby="videos-title">
      <h2 className="panel-title" id="videos-title">
        {title}
      </h2>
      <div className="news-grid">
        {videos.map((v) => (
          <VideoCard key={v.video_id} v={v} />
        ))}
      </div>
      <p className="footnote">
        From news channels on YouTube: BBC News, Reuters, DW News, Al Jazeera English, CNBC-TV18, ET Now, NDTV Profit
        and WION. Nothing loads from YouTube until you press play; then YouTube's player (its privacy-enhanced mode)
        loads and YouTube's own privacy policy applies. Picked by topic, not endorsed by Stackly.
      </p>
    </section>
  );
}

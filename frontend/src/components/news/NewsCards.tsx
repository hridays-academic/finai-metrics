import { useMemo, useState } from "react";
import type { NewsItem } from "../../lib/types";
import { formatDay } from "../../lib/leagueFormat";
import ThemeIcon from "./ThemeIcon";

const ICONS = new Set([
  "economictimes.indiatimes.com.ico", "livemint.com.png", "thehindubusinessline.com.png", "financialexpress.com.png",
  "thehindu.com.png", "indianexpress.com.png", "reuters.com.ico", "cnbctv18.com.ico", "hindustantimes.com.png",
  "rbi.org.in.ico",
]);

// Self-hosted, so showing it never contacts the publisher.
function PublisherMark({ domain, name }: { domain?: string | null; name: string }) {
  const file = domain ? [...ICONS].find((f) => f.startsWith(`${domain}.`)) : undefined;
  if (file) return <img className="publisher-icon" src={`/publishers/${file}`} alt="" width={16} height={16} />;
  return (
    <span className="publisher-icon publisher-monogram" aria-hidden="true">
      {name.charAt(0)}
    </span>
  );
}

export function timeAgo(iso: string, now = Date.now()): string {
  const mins = Math.round((now - Date.parse(iso)) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days <= 6 ? `${days}d ago` : formatDay(iso, true);
}

function NewsCard({ item, top = false }: { item: NewsItem; top?: boolean }) {
  const [open, setOpen] = useState(false);
  const id = `why-${item.url.replace(/[^a-z0-9]/gi, "").slice(-24)}`;
  return (
    <article className={`news-card tile theme-${item.theme} ${top ? "news-card-top" : ""}`}>
      {top && (
        <div className="news-card-art" aria-hidden="true">
          <ThemeIcon theme={item.theme} size={56} />
        </div>
      )}
      <div className="news-card-body">
        <div className="news-card-meta">
          <PublisherMark domain={item.publisher_domain} name={item.publisher} />
          <span>{item.publisher}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={item.published_at}>{timeAgo(item.published_at)}</time>
        </div>
        <a className="news-card-headline" href={item.url} target="_blank" rel="noopener noreferrer">
          {item.title}
          <span className="visually-hidden"> (opens {item.publisher})</span>
        </a>
        <div className="news-card-chips">
          <span className="theme-chip">
            <ThemeIcon theme={item.theme} size={14} />
            {item.theme_label}
          </span>
          {(item.sectors ?? []).map((s) => (
            <span key={s} className="chip chip-static">
              {s}
            </span>
          ))}
        </div>
        <button
          type="button"
          className="why-toggle"
          aria-expanded={open}
          aria-controls={id}
          title={open ? undefined : item.why}
          onClick={() => setOpen((v) => !v)}
        >
          Why it matters{item.sector_label ? ` (${item.sector_label})` : ""}
          <svg className={`why-chevron ${open ? "open" : ""}`} width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div id={id} className="why-panel" hidden={!open}>
          <p>{item.why}</p>
        </div>
      </div>
    </article>
  );
}

// A top story, then a grid; theme chips filter what's shown.
export default function NewsCards({ items, topStory = true }: { items: NewsItem[]; topStory?: boolean }) {
  const [theme, setTheme] = useState<string | null>(null);
  const themes = useMemo(() => {
    const seen = new Map<string, string>();
    for (const i of items) if (!seen.has(i.theme)) seen.set(i.theme, i.theme_label);
    return [...seen];
  }, [items]);
  const shown = theme ? items.filter((i) => i.theme === theme) : items;
  const [first, ...rest] = shown;

  return (
    <>
      {themes.length > 1 && (
        <div className="theme-filter" role="group" aria-label="Filter by theme">
          <button type="button" className={`chip ${theme === null ? "active" : ""}`} aria-pressed={theme === null} onClick={() => setTheme(null)}>
            All
          </button>
          {themes.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`chip theme-${key} ${theme === key ? "active" : ""}`}
              aria-pressed={theme === key}
              onClick={() => setTheme(theme === key ? null : key)}
            >
              <ThemeIcon theme={key} size={14} />
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="news-grid">
        {first && <NewsCard item={first} top={topStory} />}
        {rest.map((n) => (
          <NewsCard key={n.url} item={n} />
        ))}
      </div>
    </>
  );
}

import { useMemo, useState } from "react";
import type { NewsItem } from "../../lib/types";
import { formatDay } from "../../lib/leagueFormat";
import ThemeIcon from "./ThemeIcon";
import TileGrid from "../TileGrid";
import { useWhyItMatters, WhySummary } from "./WhyItMatters";

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
  const why = useWhyItMatters<HTMLButtonElement>({
    title: `Why it matters${item.sector_label ? ` (${item.sector_label})` : ""}`,
    chain: item.chain,
    explanation: item.explanation,
  });
  return (
    <article className={`news-card tile theme-${item.theme} ${top ? "news-card-top" : ""}`} {...why.cardProps}>
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
        <WhySummary summary={item.why} triggerProps={why.triggerProps} has={why.has} />
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
      </div>
      {why.overlay}
    </article>
  );
}

export const CARD_MIN = 280;

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
    <div className="news-cards">
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
      {first && topStory && <NewsCard item={first} top />}
      <TileGrid className="news-grid" minTile={CARD_MIN} pairOnPhones={false}>
        {(topStory ? rest : shown).map((n) => (
          <NewsCard key={n.url} item={n} />
        ))}
      </TileGrid>
    </div>
  );
}

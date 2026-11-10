import type { NewsItem } from "../../lib/types";
import { formatDay } from "../../lib/leagueFormat";

// Headline (opens the publisher), source and date, a theme chip, and our own
// approved line on why it may matter. Never article text.
export default function NewsRows({ items }: { items: NewsItem[] }) {
  return (
    <ul className="group news-list">
      {items.map((n) => (
        <li key={n.url} className="news-row reveal-row">
          <a className="news-headline" href={n.url} target="_blank" rel="noopener noreferrer">
            {n.title}
            <span className="visually-hidden"> (opens {n.publisher})</span>
          </a>
          <div className="news-meta">
            {n.publisher} · {formatDay(n.published_at, true)}
            <span className="chip chip-static">{n.theme_label}</span>
          </div>
          <p className="news-why">
            <span className="news-why-label">Why it may matter{n.sector_label ? ` (${n.sector_label})` : ""}:</span> {n.why}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function NewsSourceNote({ updatedAt }: { updatedAt: string | null }) {
  return (
    <p className="footnote">
      Headlines and links only, from the publishers' own sites. News index:{" "}
      <a href="https://www.gdeltproject.org/" target="_blank" rel="noopener noreferrer">
        GDELT Project
      </a>
      ; RBI items from the RBI's press releases. The "why it may matter" lines are Stackly's own, matched by topic, not
      a summary of the article.{updatedAt ? ` Updated ${formatDay(updatedAt, true)}.` : ""}
    </p>
  );
}

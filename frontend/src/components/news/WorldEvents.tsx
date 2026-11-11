import type { WorldEvent } from "../../lib/types";
import { formatDay } from "../../lib/leagueFormat";
import { useWhyItMatters, WhySummary } from "./WhyItMatters";
import TileGrid from "../TileGrid";
import { CARD_MIN } from "./NewsCards";

function WorldEventCard({ e }: { e: WorldEvent }) {
  const why = useWhyItMatters<HTMLButtonElement>({ title: "Why it may matter", chain: e.chain, explanation: e.why_long });
  return (
    <article className="news-card world-event tile theme-event" {...why.cardProps}>
      <div className="news-card-body">
        <div className="news-card-meta">
          <time dateTime={e.event_date}>{formatDay(e.event_date, true)}</time>
          {e.pinned && (
            <>
              <span aria-hidden="true">·</span>
              <span>Pinned</span>
            </>
          )}
        </div>
        <h3 className="news-card-headline">{e.title}</h3>
        <WhySummary summary={e.why} triggerProps={why.triggerProps} has={why.has} />
        <div className="news-card-chips">
          {e.sector_labels.map((s) => (
            <span key={s} className="chip chip-static">
              {s}
            </span>
          ))}
          {e.source_url && (
            <a className="news-card-source" href={e.source_url} target="_blank" rel="noopener noreferrer">
              Source
            </a>
          )}
        </div>
      </div>
      {why.overlay}
    </article>
  );
}

// Admin-written cards for events that may affect several sectors at once.
export default function WorldEvents({ events, title = "World events" }: { events: WorldEvent[]; title?: string }) {
  if (events.length === 0) return null;
  return (
    <section className="glass panel reveal news-panel" aria-labelledby="world-events-title">
      <h2 className="panel-title" id="world-events-title">
        {title}
      </h2>
      <TileGrid className="news-grid" minTile={CARD_MIN} pairOnPhones={false}>
        {events.map((e) => (
          <WorldEventCard key={e.id} e={e} />
        ))}
      </TileGrid>
      <p className="footnote">Written by the Stackly team from public reports. Each card links to its source.</p>
    </section>
  );
}

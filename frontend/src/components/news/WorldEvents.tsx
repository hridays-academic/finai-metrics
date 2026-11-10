import type { WorldEvent } from "../../lib/types";
import { formatDay } from "../../lib/leagueFormat";

// Admin-written cards for events that may affect several sectors at once.
export default function WorldEvents({ events, title = "World events" }: { events: WorldEvent[]; title?: string }) {
  if (events.length === 0) return null;
  return (
    <section className="glass panel reveal" aria-labelledby="world-events-title">
      <h2 className="panel-title" id="world-events-title">
        {title}
      </h2>
      <ul className="world-events">
        {events.map((e) => (
          <li key={e.id} className="world-event tile">
            <div className="world-event-head">
              <h3 className="world-event-title">{e.title}</h3>
              {e.pinned && <span className="status-text neutral">Pinned</span>}
            </div>
            <div className="news-meta">
              {formatDay(e.event_date, true)}
              {e.sector_labels.map((s) => (
                <span key={s} className="chip chip-static">
                  {s}
                </span>
              ))}
            </div>
            <p className="news-why">
              <span className="news-why-label">Why it may matter:</span> {e.why}
            </p>
            {e.source_url && (
              <a className="world-event-source" href={e.source_url} target="_blank" rel="noopener noreferrer">
                Source
              </a>
            )}
          </li>
        ))}
      </ul>
      <p className="footnote">Written by the Stackly team from public reports. Each card links to its source.</p>
    </section>
  );
}

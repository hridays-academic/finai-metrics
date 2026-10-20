import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ApiError, fetchLeagueEvent, fetchMyResult } from "../../lib/api";
import { formatDay } from "../../lib/leagueFormat";
import type { EventDetail, EventResult, MetricResult, UserPublic } from "../../lib/types";
import SiteFooter from "../SiteFooter";
import { formatIst } from "./LockCountdown";

interface ResultsPageProps {
  eventId: number;
  user: UserPublic | null;
  onOpenAuth: () => void;
}

function n(value: number): string {
  const text = value.toFixed(1);
  return text.endsWith(".0") ? text.slice(0, -2) : text;
}

type Marker = { key: string; value: number; label: string; kind: "range" | "actual" | "lazy" | "crowd" };

const LANE_HEIGHT = 18;
const CHAR_PX = 7;

// Labels go in rows ("lanes") under the line: each label takes the first
// lane where it doesn't touch the previous label, so values close together
// stack instead of overlapping, at any width.
function assignLanes(markers: Marker[], pos: (v: number) => number, width: number) {
  const lanesEnd: number[] = [];
  return [...markers]
    .sort((a, b) => a.value - b.value)
    .map((m) => {
      const w = m.label.length * CHAR_PX + 8;
      const left = Math.min(Math.max(0, (pos(m.value) / 100) * width - w / 2), Math.max(0, width - w));
      let lane = lanesEnd.findIndex((end) => left >= end + 4);
      if (lane === -1) {
        lane = lanesEnd.length;
        lanesEnd.push(0);
      }
      lanesEnd[lane] = left + w;
      return { ...m, left, lane };
    });
}

function NumberLine({ m }: { m: MetricResult }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const values = [m.low, m.high, m.actual, m.lazy, m.crowd_median].filter((v): v is number => v !== null);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.12, 1);
  const lo = min - pad;
  const hi = max + pad;
  const pos = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const u = m.unit;

  const markers: Marker[] = [
    { key: "low", value: m.low, label: `${n(m.low)}${u}`, kind: "range" },
    { key: "high", value: m.high, label: `${n(m.high)}${u}`, kind: "range" },
    { key: "actual", value: m.actual, label: `actual ${n(m.actual)}${u}`, kind: "actual" },
  ];
  if (m.lazy !== null) markers.push({ key: "lazy", value: m.lazy, label: `lazy ${n(m.lazy)}${u}`, kind: "lazy" });
  if (m.crowd_median !== null)
    markers.push({ key: "crowd", value: m.crowd_median, label: `crowd ${n(m.crowd_median)}${u}`, kind: "crowd" });
  const placed = assignLanes(markers, pos, width);
  const lanes = Math.max(...placed.map((p) => p.lane)) + 1;

  return (
    <div className="nl" ref={ref} role="img" aria-label={`Your range ${n(m.low)} to ${n(m.high)}${u}; actual ${n(m.actual)}${u}`}>
      <div className="nl-track">
        <div className="nl-range" style={{ left: `${pos(m.low)}%`, width: `${Math.max(pos(m.high) - pos(m.low), 0.6)}%` }} />
        {m.crowd_median !== null && <span className="nl-mark nl-crowd" style={{ left: `${pos(m.crowd_median)}%` }} />}
        {m.lazy !== null && <span className="nl-mark nl-lazy" style={{ left: `${pos(m.lazy)}%` }} />}
        <span className="nl-mark nl-actual" style={{ left: `${pos(m.actual)}%` }} />
      </div>
      <div className="nl-labels" style={{ height: lanes * LANE_HEIGHT }}>
        {placed.map((p) => (
          <span key={p.key} className={`nl-label nl-label-${p.kind}`} style={{ left: p.left, top: p.lane * LANE_HEIGHT }}>
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function MetricCard({ m }: { m: MetricResult }) {
  const lazyText = m.beat_lazy === null ? "No lazy guess" : m.beat_lazy ? "Beat the lazy guess" : "Didn't beat the lazy guess";
  const u = m.unit;
  return (
    <section className="calculator-card results-metric">
      <div className="results-metric-head">
        <h2>{m.label}</h2>
        <div className="results-chips">
          <span className="results-points">{n(m.points)} points</span>
          <span className={`admin-status ${m.hit ? "admin-status-open" : "admin-status-results_due"}`}>{m.hit ? "Hit" : "Miss"}</span>
          <span className="admin-status">{lazyText}</span>
        </div>
      </div>
      <NumberLine m={m} />
      <div className="nl-legend">
        <span>
          <i className="nl-key nl-key-range" /> Your range {n(m.low)}–{n(m.high)}
          {u}
        </span>
        <span>
          <i className="nl-key nl-key-actual" /> Actual {n(m.actual)}
          {u}
        </span>
        <span>
          <i className="nl-key nl-key-lazy" /> Lazy guess {m.lazy === null ? "N/A" : `${n(m.lazy)}${u}`}
        </span>
        {m.crowd_median !== null && (
          <span>
            <i className="nl-key nl-key-crowd" /> Crowd median {n(m.crowd_median)}
            {u}
          </span>
        )}
      </div>
      <ul className="results-explain">
        {m.explanations.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}

// #/results/<id>: the signed-in student's own scored forecast.
export default function ResultsPage({ eventId, user, onOpenAuth }: ResultsPageProps) {
  const [result, setResult] = useState<EventResult | null>(null);
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setNotice(null);
    fetchMyResult(eventId)
      .then((r) => !cancelled && setResult(r))
      .catch(async (err) => {
        if (cancelled) return;
        const ev = await fetchLeagueEvent(eventId).catch(() => null);
        if (cancelled) return;
        setEvent(ev);
        if (err instanceof ApiError && err.code === "not_scored" && ev) {
          setNotice(
            ev.status === "open"
              ? "Forecasts for this company are still open."
              : `Locked. Results are announced on ${formatDay(ev.results_date, true)}; your score appears here after that.`
          );
        } else if (err instanceof ApiError && err.code === "no_forecast") {
          setNotice("You didn't make a forecast for this company.");
        } else {
          setNotice(err instanceof ApiError ? err.message : "Couldn't load your results.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, user?.id]);

  if (!user || !result) {
    return (
      <div className="calculator-page">
        <div className="calculator-card trading-card">
          <a href="#/league">← Home</a>
          {event && <h2 className="results-title">{event.company.name}</h2>}
          {!user ? (
            <div className="calculator-empty-hint">
              <p>Sign in to see your results.</p>
              <button type="button" className="search-button" onClick={onOpenAuth}>
                Sign in
              </button>
            </div>
          ) : (
            <div className="calculator-empty-hint">
              {notice ?? "Loading..."}
              {notice && event && (
                <p>
                  <a href={`#/event/${event.id}`}>Go to the company page</a>
                </p>
              )}
            </div>
          )}
          <SiteFooter />
        </div>
      </div>
    );
  }

  const ev = result.event;
  return (
    <div className="league-page">
      <div className="league-page-header">
        <a href="#/league">← Home</a>
        <h1>
          {ev.company.name} <span className="company-ticker">{ev.company.ticker}</span>
        </h1>
        <div className="company-meta">{ev.season_label} results</div>
        <div className="calculator-field-note">
          This forecast was locked before results were announced (locked {formatIst(result.lock_at)}).
        </div>
      </div>

      <div className="league-company-flow">
        <section className="calculator-card results-score">
          <div className="results-score-label">Your score</div>
          <div className="results-score-value">{n(result.event_score)}</div>
          <p>{result.event_score_explanation}</p>
          <p>{result.crowd_explanation}</p>
        </section>
        {result.metrics.map((m) => (
          <MetricCard key={m.metric_key} m={m} />
        ))}
      </div>

      <SiteFooter />
    </div>
  );
}

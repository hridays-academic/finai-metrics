import type { MacroSeries } from "../../lib/types";
import { formatDay } from "../../lib/leagueFormat";
import TileGrid from "../TileGrid";

const W = 320;
const H = 96;
const PAD = 6;

function monthLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

function fmt(v: number): string {
  return v >= 1000 ? Math.round(v).toLocaleString("en-IN") : v.toFixed(1);
}

// One real series as a line, oldest on the left. No interpolation, no axis
// tricks: the latest value and the first and last dates are printed.
function MacroLine({ s }: { s: MacroSeries }) {
  const pts = s.points;
  const vals = pts.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / Math.max(1, pts.length - 1);
  const y = (v: number) => (max === min ? H / 2 : PAD + ((max - v) * (H - 2 * PAD)) / (max - min));
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join("");
  const last = pts[pts.length - 1];
  const when = s.frequency === "monthly" ? monthLabel(last.date) : formatDay(last.date, true);
  return (
    <>
      <div className="macro-value">
        <span className="sparkline-value">
          {fmt(last.value)} <span className="sparkline-when">{s.unit}, {when}</span>
        </span>
      </div>
      <svg
        className="sparkline-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${s.label}, ${monthLabel(pts[0].date)} to ${when}: from ${fmt(pts[0].value)} to ${fmt(last.value)} ${s.unit}. Low ${fmt(min)}, high ${fmt(max)}.`}
      >
        <line className="sparkline-base" x1={PAD} x2={W - PAD} y1={H - 1} y2={H - 1} />
        <path className="sparkline-line" d={d} />
        <circle className="sparkline-dot is-last" cx={x(pts.length - 1)} cy={y(last.value)} r={4} />
      </svg>
      <div className="sparkline-range" aria-hidden="true">
        <span>{monthLabel(pts[0].date)}</span>
        <span>{s.frequency === "monthly" ? monthLabel(last.date) : formatDay(last.date, true)}</span>
      </div>
    </>
  );
}

export default function MacroCharts({ series, title = "Macro context" }: { series: MacroSeries[]; title?: string }) {
  if (series.length === 0) return null;
  return (
    <section className="glass panel reveal news-panel" aria-labelledby="macro-title">
      <h2 className="panel-title" id="macro-title">
        {title}
      </h2>
      <TileGrid className="macro-grid" minTile={260}>
        {series.map((s) => (
          <figure key={s.key} className="sparkline macro-chart tile">
            <figcaption className="sparkline-head">
              <span className="sparkline-label">{s.label}</span>
            </figcaption>
            {s.status === "ok" ? (
              <MacroLine s={s} />
            ) : (
              <p className="sparkline-empty">{s.status === "coming_soon" ? "Coming soon" : "Not available right now"}</p>
            )}
            <p className="macro-meta">
              Matters for: {s.sectors.join(", ")}.{" "}
              <a href={s.source_url} target="_blank" rel="noopener noreferrer">
                {s.source_url.includes("worldbank") ? "World Bank" : "FRED"}
              </a>
            </p>
          </figure>
        ))}
      </TileGrid>
      <p className="footnote">
        Like share prices on Stackly, these are shown with a delay of at least 30 days: a monthly average appears once
        the month ended 30 days ago. Commodity prices are monthly averages in US dollars from the World Bank (CC BY 4.0);
        the rupee rate is from the US Federal Reserve via FRED.
      </p>
    </section>
  );
}

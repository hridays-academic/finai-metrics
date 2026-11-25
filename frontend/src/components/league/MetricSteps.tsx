import { type ReactNode, useState } from "react";
import QuarterSparkline from "./QuarterSparkline";
import { n } from "../../lib/scoring";
import { explainMetric } from "../../lib/glossary";

// The round screen (master plan phase 4: F8, F10, RW2). One number at a time,
// with tabs for the numbers and Next. Beside each range, only what you need
// for that number: its last 8 quarters (league figures), last year and last
// quarter. Phones get the same facts in a "Facts" drawer. Before submitting,
// one line sums up every range.

export interface MetricFacts {
  values: (number | null)[]; // league figures, oldest first
  labels: string[];
  lastYear: number | null;
  lastQuarter: number | null;
}

interface StepMetric {
  key: string;
  label: string;
  unit: string;
}

export function rangeText(range: [number, number] | null, unit: string): string {
  return range ? `${n(range[0])}${unit} to ${n(range[1])}${unit}` : "Not set";
}

export default function MetricSteps<T extends StepMetric>({
  metrics,
  ranges,
  facts,
  children,
}: {
  metrics: T[];
  ranges: Record<string, [number, number] | null>;
  facts?: Record<string, MetricFacts | undefined>;
  children: (m: T, index: number) => ReactNode;
}) {
  const [active, setActive] = useState(0);
  const last = metrics.length - 1;
  return (
    <div className="round-steps">
      <div className="round-tabs" role="tablist" aria-label="Numbers to forecast">
        {metrics.map((m, i) => (
          <button
            key={m.key}
            type="button"
            role="tab"
            id={`round-tab-${m.key}`}
            aria-selected={i === active}
            aria-controls={`round-panel-${m.key}`}
            className={`round-tab ${i === active ? "is-active" : ""}`}
            onClick={() => setActive(i)}
          >
            <span className="round-tab-label">{m.label}</span>
            <span className="round-tab-range">{rangeText(ranges[m.key], m.unit)}</span>
          </button>
        ))}
      </div>

      {metrics.map((m, i) => {
        const f = facts?.[m.key];
        const panelFacts = f && (
          <div className="round-facts">
            <QuarterSparkline label={m.label} values={f.values} quarterLabels={f.labels} format={(v) => `${n(v)}${m.unit}`} />
            <dl className="round-facts-list">
              <div>
                <dt>Last year (the lazy guess)</dt>
                <dd>{f.lastYear === null ? "N/A" : `${n(f.lastYear)}${m.unit}`}</dd>
              </div>
              <div>
                <dt>Last quarter</dt>
                <dd>{f.lastQuarter === null ? "N/A" : `${n(f.lastQuarter)}${m.unit}`}</dd>
              </div>
            </dl>
          </div>
        );
        return (
          <div
            key={m.key}
            role="tabpanel"
            id={`round-panel-${m.key}`}
            aria-labelledby={`round-tab-${m.key}`}
            hidden={i !== active}
            className="round-panel"
          >
            <div className="round-metric">
              {panelFacts && <aside className="round-facts-desk">{panelFacts}</aside>}
              <div className="round-control">
                {explainMetric(m.key, m.label) && <p className="round-glossary">{explainMetric(m.key, m.label)}</p>}
                {panelFacts && (
                  <details className="round-facts-phone">
                    <summary>Facts</summary>
                    {panelFacts}
                  </details>
                )}
                {children(m, i)}
              </div>
            </div>
            {i < last && (
              <button type="button" className="btn btn-secondary round-next" onClick={() => setActive(i + 1)}>
                Next: {metrics[i + 1].label}
              </button>
            )}
          </div>
        );
      })}

      <p className="round-summary">
        {metrics.map((m, i) => (
          <span key={m.key}>
            {i > 0 && "; "}
            {m.label}: <strong>{rangeText(ranges[m.key], m.unit)}</strong>
          </span>
        ))}
      </p>
    </div>
  );
}

import type { SectorExplainer as Explainer } from "../../lib/types";

// "How this business makes money" for the company's sector, written for
// complete beginners. The approved text lives in backend/app/league_config.py;
// this only lays it out: a lead sentence, the business as an equation, the
// three drivers, one highlighted insight (a quote of an approved sentence)
// and the checklist.
// "Cement" -> "cement", but "IT services" stays as it is.
function inSentence(name: string): string {
  return name.length > 1 && name[1] === name[1].toLowerCase() ? name[0].toLowerCase() + name.slice(1) : name;
}

const OP_SYMBOL: Record<string, string> = { x: "×", "-": "−", "+": "+", "=": "=" };
const OP_WORD: Record<string, string> = { x: "times", "-": "minus", "+": "plus", "=": "equals" };

function Icon({ d }: { d: string }) {
  return (
    <svg className="explainer-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ICONS = {
  sells: "M5 8h14l-1 12H6L5 8zM9 8V6a3 3 0 0 1 6 0v2",
  sales: "M4 17l5-5 4 4 7-7M15 9h5v5",
  costs: "M4 7l5 5 4-4 7 7M15 15h5v-5",
  check: "M5 12.5l4.5 4.5L19 7.5",
  insight: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z",
};

export default function SectorExplainer({ explainer }: { explainer: Explainer }) {
  const equationText = explainer.equation
    .map((t) => (t.op ? `${OP_WORD[t.op] ?? t.op} ${t.label}` : t.label))
    .join(" ");

  return (
    <section className="section glass panel reveal league-explainer" aria-labelledby="explainer-title">
      <h2 className="section-title" id="explainer-title">
        How {inSentence(explainer.display_name)} companies make money
      </h2>
      <p className="explainer-lead">{explainer.lead}</p>

      {explainer.equation.length > 0 && (
        <div className="explainer-equation" role="img" aria-label={equationText}>
          {explainer.equation.map((term, i) => (
            <span className="equation-step" key={i}>
              {term.op && <span className="equation-op">{OP_SYMBOL[term.op] ?? term.op}</span>}
              <span className={`equation-term tile ${term.op === "=" ? "is-result" : ""}`}>
                <span className="equation-label">{term.label}</span>
                {term.note && <span className="equation-note">{term.note}</span>}
              </span>
            </span>
          ))}
        </div>
      )}

      <div className="explainer-blocks">
        <div className="explainer-block">
          <h3>
            <Icon d={ICONS.sells} />
            What it sells
          </h3>
          <p>{explainer.sells}</p>
        </div>
        <div className="explainer-block">
          <h3>
            <Icon d={ICONS.sales} />
            What drives sales
          </h3>
          <p>{explainer.sales_drivers}</p>
        </div>
        <div className="explainer-block">
          <h3>
            <Icon d={ICONS.costs} />
            What drives costs
          </h3>
          <p>{explainer.cost_drivers}</p>
        </div>
      </div>

      {explainer.key_insight && (
        <figure className="callout callout-insight reveal-item">
          <Icon d={ICONS.insight} />
          <div>
            <figcaption className="callout-label">Key insight</figcaption>
            <blockquote>{explainer.key_insight}</blockquote>
          </div>
        </figure>
      )}

      <div className="explainer-check">
        <h3>What to check before forecasting</h3>
        <ul className="checklist">
          {explainer.checklist.map((item) => (
            <li key={item} className="reveal-item">
              <span className="checklist-mark">
                <Icon d={ICONS.check} />
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

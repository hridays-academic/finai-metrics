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

// The business as an equation (shared with the company page's story).
export function Equation({ explainer }: { explainer: Explainer }) {
  if (explainer.equation.length === 0) return null;
  const equationText = explainer.equation
    .map((t) => (t.op ? `${OP_WORD[t.op] ?? t.op} ${t.label}` : t.label))
    .join(" ");
  return (
    <div className="explainer-equation" role="img" aria-label={equationText}>
      {explainer.equation.map((term, i) => (
        <span className="equation-step" key={i}>
          {term.op && <span className="equation-op">{OP_SYMBOL[term.op] ?? term.op}</span>}
          <span className={`equation-term ${term.op === "=" ? "is-result" : ""}`}>
            <span className="equation-label">{term.label}</span>
            {term.note && <span className="equation-note">{term.note}</span>}
          </span>
        </span>
      ))}
    </div>
  );
}

export default function SectorExplainer({ explainer }: { explainer: Explainer }) {
  return (
    <section className="glass panel league-explainer" aria-labelledby="explainer-title">
      <h2 className="panel-title" id="explainer-title">
        How {inSentence(explainer.display_name)} companies make money
      </h2>
      <p className="explainer-lead">{explainer.lead}</p>

      <Equation explainer={explainer} />

      <ul className="grouped-list explainer-blocks">
        <li className="explainer-block">
          <h3>What it sells</h3>
          <p>{explainer.sells}</p>
        </li>
        <li className="explainer-block">
          <h3>What drives sales</h3>
          <p>{explainer.sales_drivers}</p>
        </li>
        <li className="explainer-block">
          <h3>What drives costs</h3>
          <p>{explainer.cost_drivers}</p>
        </li>
      </ul>

      {explainer.key_insight && (
        <figure className="key-insight">
          <figcaption className="key-insight-label">Key insight</figcaption>
          <blockquote>
            <span className="hl-under">{explainer.key_insight}</span>
          </blockquote>
        </figure>
      )}

      <div className="explainer-check">
        <h3>What to check before forecasting</h3>
        <ul className="checklist">
          {explainer.checklist.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

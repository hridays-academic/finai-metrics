import type { SectorExplainer as Explainer } from "../../lib/types";

// "How this business makes money" for the company's sector, written for
// complete beginners. The text lives in backend/app/league_config.py.
// "Cement" -> "cement", but "IT services" stays as it is.
function inSentence(name: string): string {
  return name.length > 1 && name[1] === name[1].toLowerCase() ? name[0].toLowerCase() + name.slice(1) : name;
}

export default function SectorExplainer({ explainer }: { explainer: Explainer }) {
  return (
    <section className="section league-explainer" aria-labelledby="explainer-title">
      <h2 className="section-title" id="explainer-title">
        How {inSentence(explainer.display_name)} companies make money
      </h2>
      <div className="league-explainer-grid">
        <div>
          <h3>What it sells</h3>
          <p>{explainer.sells}</p>
        </div>
        <div>
          <h3>What drives sales</h3>
          <p>{explainer.sales_drivers}</p>
        </div>
        <div>
          <h3>What drives costs</h3>
          <p>{explainer.cost_drivers}</p>
        </div>
        <div>
          <h3>Check before you forecast</h3>
          <ul>
            {explainer.checklist.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

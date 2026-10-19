import type { SectorExplainer as Explainer } from "../../lib/types";

// "How this business makes money" for the company's sector, written for
// complete beginners. The text lives in backend/app/league_config.py.
export default function SectorExplainer({ explainer }: { explainer: Explainer }) {
  return (
    <section className="calculator-card league-explainer" aria-label="How this business makes money">
      <h2>How this business makes money</h2>
      <p className="calculator-subtitle">A quick guide to {explainer.display_name.toLowerCase()} companies.</p>
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

import { useEffect, useState } from "react";
import { fetchMacro } from "../lib/api";
import { formatDay } from "../lib/leagueFormat";
import { n } from "../lib/scoring";
import type { MacroSeries } from "../lib/types";

// RW4 (master plan phase 7): each sector's cheat sheet, the 3 or 4 things
// that move each league number. Where a free, already-approved series exists
// (World Bank commodity prices), its latest value and month are shown; prices
// are at least 30 days old (the macro endpoint lags them). DRAFT wording for
// Hriday's approval (vault: Decisions, "New wording in Phase 7").

interface Driver {
  text: string;
  series?: string; // a MacroSeries key
}

export const CHEAT_SHEETS: Record<string, { number: string; drivers: Driver[] }[]> = {
  cement: [
    { number: "Sales volume growth", drivers: [
      { text: "Building and road work in the company's states, which slows in the monsoon (July to September)" },
      { text: "Government spending on housing and infrastructure" },
      { text: "New plants the company has opened in the last year" },
    ] },
    { number: "Revenue growth", drivers: [
      { text: "Volume growth, plus the price per tonne, which moves with local demand and competition" },
      { text: "Festive and pre-monsoon months, when prices usually firm up" },
    ] },
    { number: "Operating margin", drivers: [
      { text: "Coal and pet coke prices (the kiln's fuel)", series: "coal" },
      { text: "Diesel and freight costs to move heavy bags", series: "brent" },
      { text: "Whether prices rose faster than costs" },
    ] },
  ],
  autos: [
    { number: "Units sold growth", drivers: [
      { text: "The company's own monthly sales releases (out on the 1st of each month)" },
      { text: "The festive season (Navratri to Diwali) and, for tractors, the monsoon and crop prices" },
      { text: "New models launched in the last year" },
    ] },
    { number: "Revenue growth", drivers: [
      { text: "Units sold, plus price rises and a shift to costlier models" },
      { text: "Exports, which move with demand abroad and the rupee" },
    ] },
    { number: "Operating margin", drivers: [
      { text: "Steel and aluminium prices", series: "aluminium" },
      { text: "Iron ore, a lead for steel costs", series: "iron_ore" },
      { text: "Discounts to dealers and buyers" },
    ] },
  ],
  fmcg: [
    { number: "Volume growth", drivers: [
      { text: "Rural demand, helped by a good monsoon and crop prices" },
      { text: "Price rises: when prices go up, volumes often slow" },
      { text: "Quick commerce and new products" },
    ] },
    { number: "Revenue growth", drivers: [
      { text: "Volume growth plus price changes" },
      { text: "International business, which the rupee also moves" },
    ] },
    { number: "Operating margin", drivers: [
      { text: "Palm oil and other edible oils (soaps, foods)", series: "palm_oil" },
      { text: "Crude oil, behind packaging and detergents", series: "brent" },
      { text: "Advertising spend" },
    ] },
  ],
  it: [
    { number: "Constant-currency revenue growth", drivers: [
      { text: "Spending by banks and insurers in the US and Europe, the biggest clients" },
      { text: "Large deals won in the last year starting to bill" },
      { text: "What peers that report earlier (TCS, Infosys, HCLTech) say about demand" },
    ] },
    { number: "Revenue growth (in rupees)", drivers: [
      { text: "Constant-currency growth plus the rupee: a weaker rupee lifts rupee revenue", series: "usd_inr" },
    ] },
    { number: "Operating margin", drivers: [
      { text: "Pay rises (often in the first or second quarter)" },
      { text: "How busy staff are (utilisation)" },
      { text: "The rupee", series: "usd_inr" },
    ] },
  ],
};

// `latest` is off in Practice: today's prices postdate the quarter being
// forecast, and practice never shows anything from after its cut.
export default function SectorCheatSheet({ sector, sectorName, latest: showLatest = true }: {
  sector: string;
  sectorName: string;
  latest?: boolean;
}) {
  const [macro, setMacro] = useState<MacroSeries[]>([]);
  useEffect(() => {
    if (showLatest) fetchMacro().then(setMacro).catch(() => setMacro([]));
  }, [showLatest]);
  const sheet = CHEAT_SHEETS[sector];
  if (!sheet) return null;
  const latest = (key?: string) => {
    const s = key ? macro.find((m) => m.key === key && m.status === "ok" && m.points.length) : undefined;
    if (!s) return null;
    const p = s.points[s.points.length - 1];
    return `${n(p.value)} ${s.unit}, ${formatDay(p.date, true)} (${s.source})`;
  };
  return (
    <section className="cheat-sheet" aria-labelledby={`cheat-${sector}`}>
      <h3 className="cheat-sheet-title" id={`cheat-${sector}`}>
        What moves {sectorName} numbers
      </h3>
      <div className="cheat-sheet-grid">
        {sheet.map((g) => (
          <div key={g.number}>
            <h4>{g.number}</h4>
            <ul>
              {g.drivers.map((d) => (
                <li key={d.text}>
                  {d.text}
                  {latest(d.series) && <span className="cheat-latest">Latest: {latest(d.series)}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

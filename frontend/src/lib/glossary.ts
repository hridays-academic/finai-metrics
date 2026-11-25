// RW7 (master plan): plain explanations shown in place. Wording approved
// 2026-11-24 (decisions 2.26) and checked against the league's definitions
// (vault: "Glossary 2.26, checked").
export const GLOSSARY = {
  yoy: "Year on year: this quarter compared with the same quarter a year earlier.",
  operating_margin:
    "The share of revenue from operations left after running costs, before depreciation, interest and tax. Other income, such as interest earned on cash, is left out.",
  constant_currency:
    "Revenue growth worked out as if exchange rates hadn't changed since the same quarter last year, as the company reports it. It shows the business without the rupee's moves.",
  volume:
    "How much more product was sold than in the same quarter last year, leaving out price rises. Each company counts it its own way (tonnes, vehicles or 'underlying volume'), and the league uses the company's own figure.",
} as const;

// The plain explanation for one of a round's numbers.
export function explainMetric(key: string, label: string): string | null {
  if (key === "revenue_growth_yoy") return GLOSSARY.yoy;
  if (key === "operating_margin") return GLOSSARY.operating_margin;
  if (/constant[- ]currency/i.test(label)) return GLOSSARY.constant_currency;
  if (/volume|units/i.test(label)) return GLOSSARY.volume;
  return null;
}

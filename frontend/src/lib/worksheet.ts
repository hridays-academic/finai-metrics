// The driver worksheet's arithmetic (wording approved 2026-11-13, Areas/
// Research workspace wording). Every input is the student's own; these
// functions only combine them and write out the formula with their numbers.
import type { BaseFigure, WorksheetData } from "./types";

export type Sector = "cement" | "autos" | "fmcg" | "it";

export interface Result {
  value: number;
  formula: string;
}

export interface InputSpec {
  key: string;
  label: string;
  unit: "%" | "points";
}

// Inputs per sector, in the order shown.
export const SECTOR_INPUTS: Record<Sector, { revenue: InputSpec[]; margin: InputSpec[] }> = {
  cement: {
    revenue: [
      { key: "volume", label: "Tonnes sold (volume growth)", unit: "%" },
      { key: "price", label: "Price per tonne", unit: "%" },
    ],
    margin: [{ key: "cost", label: "Cost per tonne", unit: "%" }],
  },
  autos: {
    revenue: [
      { key: "volume", label: "Units sold", unit: "%" },
      { key: "price", label: "Average price per vehicle (includes the mix)", unit: "%" },
    ],
    margin: [{ key: "cost", label: "Cost per vehicle", unit: "%" }],
  },
  fmcg: {
    revenue: [
      { key: "volume", label: "Volume growth", unit: "%" },
      { key: "price", label: "Price per pack (price increases and mix)", unit: "%" },
    ],
    margin: [{ key: "cost", label: "Cost per pack", unit: "%" }],
  },
  it: {
    revenue: [
      { key: "cc", label: "Constant-currency growth", unit: "%" },
      { key: "fx", label: "Currency effect (how much the rupee's move adds or takes away)", unit: "%" },
    ],
    margin: [
      { key: "pay", label: "Pay rises", unit: "points" },
      { key: "fx_margin", label: "Currency", unit: "points" },
    ],
  },
};

export const FORMULA_TEXT: Record<Sector, { revenue: string; kpi: string; margin: string }> = {
  cement: {
    revenue: "Revenue growth = (1 + volume growth) x (1 + price change) - 1",
    kpi: "Sector KPI = your volume growth",
    margin: "Operating margin = 1 - (1 - starting margin) x (1 + cost change) / (1 + price change) + other changes",
  },
  autos: {
    revenue: "Revenue growth = (1 + units growth) x (1 + price change) - 1",
    kpi: "Sector KPI = your units growth",
    margin: "Operating margin = 1 - (1 - starting margin) x (1 + cost change) / (1 + price change) + other changes",
  },
  fmcg: {
    revenue: "Revenue growth = (1 + volume growth) x (1 + price change) - 1",
    kpi: "Sector KPI = your volume growth",
    margin: "Operating margin = 1 - (1 - starting margin) x (1 + cost change) / (1 + price change) + other changes",
  },
  it: {
    revenue: "Revenue growth = (1 + constant-currency growth) x (1 + currency effect) - 1",
    kpi: "Sector KPI = your constant-currency growth",
    margin: "Operating margin = starting margin + pay rises + currency + other changes",
  },
};

export function isSector(s: string): s is Sector {
  return s === "cement" || s === "autos" || s === "fmcg" || s === "it";
}

const pct = (n: number) => `${n.toFixed(1)}%`;
// "(1 + 3.0%)" or "(1 - 3.0%)"
const onePlus = (n: number) => `(1 ${n < 0 ? "-" : "+"} ${pct(Math.abs(n))})`;
// " + 0.5 points" or " - 0.5 points" for a points adjustment
const plusPoints = (n: number) => ` ${n < 0 ? "-" : "+"} ${Math.abs(n).toFixed(1)}`;

const has = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

export function revenueGrowth(sector: Sector, ws: WorksheetData): Result | null {
  const [a, b] = sector === "it" ? [ws.inputs.cc, ws.inputs.fx] : [ws.inputs.volume, ws.inputs.price];
  if (!has(a) || !has(b)) return null;
  const value = ((1 + a / 100) * (1 + b / 100) - 1) * 100;
  return { value, formula: `${onePlus(a)} x ${onePlus(b)} - 1 = ${pct(value)}` };
}

export function sectorKpi(sector: Sector, ws: WorksheetData): Result | null {
  const v = sector === "it" ? ws.inputs.cc : ws.inputs.volume;
  if (!has(v)) return null;
  const what = sector === "it" ? "constant-currency growth" : sector === "autos" ? "units growth" : "volume growth";
  return { value: v, formula: `Your ${what}: ${pct(v)}` };
}

// The starting margin the student picked: a league figure or their own number.
export function startingMargin(
  ws: WorksheetData,
  lastYear: BaseFigure[],
  lastQuarter: BaseFigure[],
): number | null {
  const pick = (figs: BaseFigure[]) => figs.find((f) => f.metric_key === "operating_margin")?.value ?? null;
  if (ws.base === "last_year") return pick(lastYear);
  if (ws.base === "last_quarter") return pick(lastQuarter);
  if (ws.base === "own") return has(ws.own_base) ? ws.own_base : null;
  return null;
}

export function operatingMargin(sector: Sector, ws: WorksheetData, base: number | null): Result | null {
  if (!has(base)) return null;
  const other = has(ws.inputs.other) ? ws.inputs.other : 0;
  const otherText = other !== 0 ? `${plusPoints(other)} points` : "";
  if (sector === "it") {
    const { pay, fx_margin: fx } = ws.inputs;
    if (!has(pay) || !has(fx)) return null;
    const value = base + pay + fx + other;
    const adjustments = `${plusPoints(pay)}${plusPoints(fx)}${other !== 0 ? plusPoints(other) : ""}`;
    return { value, formula: `${pct(base)}${adjustments} points = ${pct(value)}` };
  }
  const { cost, price } = ws.inputs;
  if (!has(cost) || !has(price) || price <= -100) return null;
  const value = 100 - (100 - base) * (1 + cost / 100) / (1 + price / 100) + other;
  return {
    value,
    formula: `1 - (1 - ${pct(base)}) x ${onePlus(cost)} / ${onePlus(price)}${otherText} = ${pct(value)}`,
  };
}

// Autos: the quarter's units from three monthly releases, against the same months last year.
export function unitsGrowth(units: WorksheetData["units"]): Result | null {
  if (!units) return null;
  const now = units.this_year;
  const then = units.last_year;
  if (now.some((n) => !has(n)) || then.some((n) => !has(n))) return null;
  const a = (now as number[]).reduce((x, y) => x + y, 0);
  const b = (then as number[]).reduce((x, y) => x + y, 0);
  if (b <= 0) return null;
  const value = (a / b - 1) * 100;
  const sum = (xs: number[]) => xs.map((n) => n.toLocaleString("en-IN")).join(" + ");
  return { value, formula: `(${sum(now as number[])}) / (${sum(then as number[])}) - 1 = ${pct(value)}` };
}

export interface RangeFill {
  low: number;
  high: number;
}

// Result ± how unsure, rounded to one decimal like the forecast form.
export function rangeFrom(result: Result | null, unsure: number | null | undefined): RangeFill | null {
  if (!result || !has(unsure)) return null;
  const r = (n: number) => Math.round(n * 10) / 10;
  return { low: r(result.value - unsure), high: r(result.value + unsure) };
}

export function emptyWorksheet(): WorksheetData {
  return { inputs: {}, units: null, base: null, own_base: null, unsure: {} };
}

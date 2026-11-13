import { describe, expect, it } from "vitest";
import type { BaseFigure, WorksheetData } from "./types";
import { operatingMargin, rangeFrom, revenueGrowth, sectorKpi, startingMargin, unitsGrowth } from "./worksheet";

const ws = (inputs: WorksheetData["inputs"], extra: Partial<WorksheetData> = {}): WorksheetData => ({
  inputs,
  unsure: {},
  ...extra,
});

const fig = (metric_key: string, value: number): BaseFigure => ({
  metric_key,
  value,
  source_url: "https://example.com",
  fiscal_year_label: "FY26",
  fiscal_quarter: 3,
});

describe("revenue growth", () => {
  it("matches the approved worked examples", () => {
    expect(revenueGrowth("cement", ws({ volume: 10, price: 2 }))?.formula).toBe("(1 + 10.0%) x (1 + 2.0%) - 1 = 12.2%");
    expect(revenueGrowth("autos", ws({ volume: 20, price: 3 }))?.formula).toBe("(1 + 20.0%) x (1 + 3.0%) - 1 = 23.6%");
  });

  it("writes a fall with a minus sign", () => {
    expect(revenueGrowth("fmcg", ws({ volume: 4, price: -3 }))?.formula).toBe("(1 + 4.0%) x (1 - 3.0%) - 1 = 0.9%");
  });

  it("uses constant currency and the currency effect for IT", () => {
    const r = revenueGrowth("it", ws({ cc: 5, fx: 2 }));
    expect(r?.value).toBeCloseTo(7.1, 5);
  });

  it("needs both inputs and never fills one in", () => {
    expect(revenueGrowth("cement", ws({ volume: 10 }))).toBeNull();
    expect(revenueGrowth("cement", ws({}))).toBeNull();
  });
});

describe("operating margin", () => {
  it("matches the approved example: 15% start, cost +4%, price +2% = 13.3%", () => {
    const r = operatingMargin("cement", ws({ cost: 4, price: 2 }), 15);
    expect(r?.formula).toBe("1 - (1 - 15.0%) x (1 + 4.0%) / (1 + 2.0%) = 13.3%");
  });

  it("adds other changes in points", () => {
    const r = operatingMargin("autos", ws({ cost: 4, price: 2, other: 0.5 }), 15);
    expect(r?.formula).toBe("1 - (1 - 15.0%) x (1 + 4.0%) / (1 + 2.0%) + 0.5 points = 13.8%");
  });

  it("rises when prices rise faster than costs", () => {
    expect(operatingMargin("fmcg", ws({ cost: 1, price: 5 }), 20)!.value).toBeGreaterThan(20);
  });

  it("adds the IT adjustments in points", () => {
    const r = operatingMargin("it", ws({ pay: -1.5, fx_margin: 0.3 }), 21);
    expect(r?.formula).toBe("21.0% - 1.5 + 0.3 points = 19.8%");
  });

  it("needs a starting margin and the cost and price changes", () => {
    expect(operatingMargin("cement", ws({ cost: 4, price: 2 }), null)).toBeNull();
    expect(operatingMargin("cement", ws({ cost: 4 }), 15)).toBeNull();
    expect(operatingMargin("it", ws({ pay: -1 }), 21)).toBeNull();
  });
});

describe("starting margin", () => {
  const lastYear = [fig("revenue_growth_yoy", 8), fig("operating_margin", 18)];
  it("takes the league figure the student picked, or their own", () => {
    expect(startingMargin(ws({}, { base: "last_year" }), lastYear, [])).toBe(18);
    expect(startingMargin(ws({}, { base: "last_quarter" }), lastYear, [])).toBeNull();
    expect(startingMargin(ws({}, { base: "last_quarter" }), lastYear, [fig("operating_margin", 16)])).toBe(16);
    expect(startingMargin(ws({}, { base: "own", own_base: 12.5 }), lastYear, [])).toBe(12.5);
    expect(startingMargin(ws({}), lastYear, [])).toBeNull();
  });
});

describe("KPI, units helper and range", () => {
  it("the KPI is the student's own volume number", () => {
    expect(sectorKpi("autos", ws({ volume: 26.5 }))?.formula).toBe("Your units growth: 26.5%");
  });

  it("adds three months of units against last year", () => {
    const r = unitsGrowth({ this_year: [241421, 219220, 236013], last_year: [180526, 180683, 189665] });
    expect(r?.value).toBeCloseTo(26.46, 1);
    expect(unitsGrowth({ this_year: [1, null, 2], last_year: [1, 1, 1] })).toBeNull();
  });

  it("turns a result and how unsure into a range, only when both are given", () => {
    expect(rangeFrom({ value: 23.6, formula: "" }, 2)).toEqual({ low: 21.6, high: 25.6 });
    expect(rangeFrom({ value: 23.6, formula: "" }, null)).toBeNull();
    expect(rangeFrom(null, 2)).toBeNull();
  });
});

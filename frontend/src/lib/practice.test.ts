// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { asEvent, mysteryOn, mysteryQuarterLabel, setMystery, surprise } from "./practice";
import { previousQuarterEnds } from "./leagueFormat";
import { parseHash } from "./router";
import type { PracticeCase } from "./types";

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

afterEach(() => vi.unstubAllGlobals());

describe("practice helpers", () => {
  it("Mystery mode is on by default, remembered, and on when storage fails", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    expect(mysteryOn()).toBe(true);
    setMystery(false);
    expect(mysteryOn()).toBe(false);
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    expect(mysteryOn()).toBe(true);
    expect(() => setMystery(false)).not.toThrow();
  });

  it("names quarters on the relative calendar without a year", () => {
    const anchor = "0100-09-30";
    const ends = previousQuarterEnds(anchor, 8);
    expect(ends[0]).toBe("0100-06-30");
    expect(ends[3]).toBe("0099-09-30");
    expect(ends.map((e) => mysteryQuarterLabel(e, anchor)).slice(0, 4)).toEqual([
      "Apr to Jun, this year",
      "Jan to Mar, this year",
      "Oct to Dec, last year",
      "Jul to Sep, last year",
    ]);
    expect(mysteryQuarterLabel("0098-12-31", anchor)).toBe("Oct to Dec, 2 years before");
  });

  it("a mystery case becomes an event with no name, ticker or dates", () => {
    const c = { code: "abc123", mystery: true, sector: "autos", name: null, ticker: null, season_label: null,
      results_date: null, period_end_date: "0100-09-30", metrics: [], research_notes: null, description: "A car maker." } as unknown as PracticeCase;
    const e = asEvent(c);
    expect([e.company.name, e.company.ticker, e.results_date, e.season_label]).toEqual(["Mystery company", "", "", ""]);
    expect(e.status).not.toBe("open");
  });

  it("routes practice codes and surprises with another company", () => {
    expect(parseHash("#/practice/k3x9a0")).toEqual({ name: "practice", code: "k3x9a0" });
    expect(parseHash("#/practice?surprise=1")).toEqual({ name: "practice" });
    const cases = [{ code: "a" }, { code: "b" }];
    for (let i = 0; i < 10; i++) expect(surprise(cases, "a")?.code).toBe("b");
    expect(surprise([{ code: "a" }], "a")?.code).toBe("a");
  });
});

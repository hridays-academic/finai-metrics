import { describe, expect, it } from "vitest";
import type { PlayCard } from "./api";
import { buildRound, cardPoints, comboMultiplier, endLine, GOLD_BONUS } from "./quickRound";

const card = (id: string, sector: string, difficulty: PlayCard["difficulty"] = "medium"): PlayCard => ({
  id, sector, sector_name: sector, difficulty, name: null, mystery_line: null, quarter: null,
  metric_key: "operating_margin", label: "Operating margin", unit: "%", last_year: 10, last_quarter: null,
  min_value: -100, max_value: 100,
});
const bank = [
  ...["a1", "a2", "a3", "a4"].map((id) => card(id, "autos")),
  ...["c1", "c2", "c3"].map((id) => card(id, "cement", "easy")),
  ...["f1", "f2", "f3", "f4", "f5"].map((id) => card(id, "fmcg", "hard")),
];

describe("quick rounds", () => {
  it("builds 10 mixed cards with one gold card set by the seed", () => {
    const r = buildRound(bank, 42, false);
    expect(r.cards).toHaveLength(10);
    expect(new Set(r.cards.slice(0, 3).map((c) => c.sector)).size).toBe(3); // sectors take turns
    expect(r.goldIndex).toBeGreaterThan(0);
    expect(buildRound(bank, 42, false)).toEqual(r); // same seed, same round
  });

  it("gives a first round of 3 Easy cards and no gold card", () => {
    const r = buildRound(bank, 7, true);
    expect(r.cards.map((c) => c.difficulty)).toEqual(["easy", "easy", "easy"]);
    expect(r.goldIndex).toBe(-1);
  });

  it("doubles at 3 in a row and triples at 5; a miss only ends the combo", () => {
    expect([1, 2, 3, 4, 5, 6].map(comboMultiplier)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(cardPoints(80, true, 2, false)).toEqual({ points: 160, streak: 3, multiplier: 2 });
    expect(cardPoints(80, false, 4, false)).toEqual({ points: 80, streak: 0, multiplier: 1 });
    expect(cardPoints(50, true, 0, true).points).toBe(50 + GOLD_BONUS);
  });

  it("ends with how often the ranges caught the result", () => {
    expect(endLine(7, 10)).toBe("7 of 10: your ranges caught 70%. Aim for 8.");
  });
});

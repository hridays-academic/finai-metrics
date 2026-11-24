import { describe, expect, it } from "vitest";
import { firstSentence } from "./guideLayout";

describe("firstSentence", () => {
  it("splits at the first sentence end and keeps every word", () => {
    const cases = [
      "Revenue is the money a company receives from its sales, before any costs. Revenue growth compares a quarter with the same quarter a year earlier: (this year − last year) ÷ last year.",
      "Each number you forecast starts at 100 points. Each percentage point of your range's width costs 2 points.",
      "The lazy guess assumes the number will be the same as last year. If it is equally close, there is no bonus.",
    ];
    for (const text of cases) {
      const [lead, rest] = firstSentence(text);
      expect(`${lead} ${rest}`).toBe(text);
      expect(lead.endsWith(".")).toBe(true);
    }
  });

  it("doesn't split inside a number and leaves a single sentence whole", () => {
    expect(firstSentence("Marico's margin was 18.2%. It rose.")).toEqual(["Marico's margin was 18.2%.", "It rose."]);
    expect(firstSentence("Three questions to check your understanding.")).toEqual([
      "Three questions to check your understanding.",
      "",
    ]);
  });
});

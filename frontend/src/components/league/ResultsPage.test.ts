import { describe, expect, it } from "vitest";
import { rangeText } from "./ResultsPage";

describe("results legend range", () => {
  it("uses a dash for ordinary ranges", () => {
    expect(rangeText("8.5", "9.5", "%")).toBe("8.5–9.5%");
  });
  it("spells out 'to' when the low end is negative", () => {
    expect(rangeText("-36", "64", "%")).toBe("-36% to 64%");
    expect(rangeText("-5", "-1", "%")).toBe("-5% to -1%");
  });
});

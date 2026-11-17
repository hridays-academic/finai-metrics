// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { barsFor } from "./MetricsDashboard";
import type { MetricGroup } from "../lib/types";

const metric = (key: string, value: number | null, unit: string) =>
  ({ key, label: key, value, unit, status: "neutral" }) as unknown as MetricGroup["metrics"][number];

describe("ratio comparison bars", () => {
  it("compares only ratios that share a unit, against the largest, and skips N/A", () => {
    const group = {
      key: "profitability",
      label: "Profitability",
      metrics: [metric("gross", 40, "%"), metric("net", -10, "%"), metric("days", 30, "days"), metric("na", null, "%")],
    } as MetricGroup;
    const bars = barsFor(group);
    expect(bars.gross).toBe(1);
    expect(bars.net).toBeCloseTo(0.25); // sized by size, negative shown in red
    expect(bars.days).toBeNull(); // alone in its unit
    expect(bars.na).toBeNull();
  });
});

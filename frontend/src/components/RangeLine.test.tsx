// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import RangeLine, { lineScale, niceStep } from "./RangeLine";

describe("niceStep", () => {
  it("rounds to 1, 2, 2.5 or 5 times a power of ten", () => {
    expect(niceStep(20, 4)).toBe(5);
    expect(niceStep(9, 3)).toBe(5);
    expect(niceStep(1.2, 4)).toBe(0.5);
    expect(niceStep(240, 6)).toBe(50);
  });
});

describe("lineScale", () => {
  it("contains every value, on whole ticks", () => {
    const { lo, hi, ticks } = lineScale([8, 12, 13.4], 2, 5);
    expect(lo).toBeLessThanOrEqual(8);
    expect(hi).toBeGreaterThanOrEqual(13.4);
    expect(ticks[0]).toBe(lo);
    expect(ticks[ticks.length - 1]).toBeCloseTo(hi);
  });

  it("never gets narrower than minSpan, so a narrow range looks narrow", () => {
    const { lo, hi } = lineScale([10, 11], 20, 4);
    expect(hi - lo).toBeGreaterThanOrEqual(20);
    expect(lo).toBeLessThanOrEqual(10);
    expect(hi).toBeGreaterThanOrEqual(11);
  });

  it("copes with no values and with negative ones", () => {
    expect(lineScale([], 20, 4).hi - lineScale([], 20, 4).lo).toBeGreaterThanOrEqual(20);
    const neg = lineScale([-36, 64], 2, 5);
    expect(neg.lo).toBeLessThanOrEqual(-36);
    expect(neg.hi).toBeGreaterThanOrEqual(64);
  });
});

describe("RangeLine", () => {
  it("is decorative without a label and an image with one", () => {
    const { container, rerender } = render(<RangeLine low={1} high={2} />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    rerender(<RangeLine low={1} high={2} ariaLabel="Your range 1 to 2%" />);
    expect(container.firstElementChild?.getAttribute("role")).toBe("img");
  });
});

import { describe, expect, it } from "vitest";
import { coverAt, currentPage, riseProgress, tiltAt } from "./guideMotion";

describe("the page stack's motion", () => {
  it("is scrubbed by position: 0 at the bottom of the screen, 1 at the top, half way = half", () => {
    expect(riseProgress(800, 800)).toBe(0);
    expect(riseProgress(1200, 800)).toBe(0);
    expect(riseProgress(400, 800)).toBe(0.5);
    expect(riseProgress(0, 800)).toBe(1);
    expect(riseProgress(-50, 800)).toBe(1);
  });

  it("tilts -7deg on entry, flat at the top, and matches kigo's measured -5.1deg with 81% to go", () => {
    expect(tiltAt(0)).toBe(-7);
    expect(tiltAt(1)).toBe(0);
    expect(tiltAt(1 - 0.814)).toBeCloseTo(-5.1, 1);
    expect(tiltAt(1 - 0.314)).toBeCloseTo(-1.2, 1);
    // Scrolling back reverses it: the same position gives the same angle.
    expect(tiltAt(0.4)).toBe(tiltAt(0.4));
  });

  it("shrinks the covered page to 0.96 and darkens it to 35%", () => {
    expect(coverAt(0)).toEqual({ scale: 1, dim: 0 });
    expect(coverAt(1)).toEqual({ scale: 0.96, dim: 0.35 });
    expect(coverAt(0.5).scale).toBeCloseTo(0.98);
  });

  it("counts a page as current once it has risen half way", () => {
    expect(currentPage([1, 0.2, 0])).toBe(0);
    expect(currentPage([1, 0.5, 0])).toBe(1);
    expect(currentPage([1, 1, 0.9, 0])).toBe(2);
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const practiceCards = ["A1", "B2", "C3", "D4"].map((code) => ({
  code, sector: "autos", sector_name: "Autos", difficulty: "medium", mystery_line: "A car maker.", name: null, ticker: null,
  season_label: null, description: null, first_score: null, attempts: 0,
}));

vi.mock("../../lib/api", () => ({
  fetchLeagueEvents: vi.fn(() => Promise.resolve([])),
  fetchPracticeCases: vi.fn(() => Promise.resolve(practiceCards)),
}));

import { n, scoreMetric } from "../../lib/scoring";
import {
  caught, caughtLine, CluesObject, DROP_RESULTS, DropObject, growthSum, lazyLines, marginSplit, QuartersObject, quizQuestions,
  keepSums, MarginObject, QuizObject, RevenueObject, ScoreObject, scoreSum, SectorObject, YourTurnObject,
} from "./guideObjects";
import { markPlaces, restingPlaces, thinTicks } from "./GuideRail";
import { GuideLayoutContext } from "./guideLayout";

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("score sums come from lib/scoring.ts", () => {
  it("writes out the league's arithmetic", () => {
    expect(scoreSum(16, 20, 18.2).sum).toBe("100 − 8 = 92");
    expect(scoreSum(19, 23, 18).sum).toBe("100 − 8 − 20 = 72");
    expect(scoreSum(10, 25, 30)).toMatchObject({ sum: "100 − 30 − 100 = 0", floored: true });
    for (const [lo, hi, a] of [[16, 20, 18.2], [18.5, 21, 18.2], [10, 12, 18.2], [17, 17.5, 18.2]]) {
      expect(scoreSum(lo, hi, a).sum.endsWith(`= ${n(scoreMetric(lo, hi, a, null).base)}`)).toBe(true);
    }
  });

  it("page 6 updates live as you move the range", () => {
    render(<ScoreObject />);
    expect(screen.getByText("100 − 8 = 92")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("slider", { name: "High" }), { key: "ArrowRight" });
    expect(screen.getByText("100 − 9 = 91")).toBeTruthy();
    const low = screen.getByRole("slider", { name: "Low" });
    for (let i = 0; i < 6; i++) fireEvent.keyDown(low, { key: "ArrowRight" });
    expect(screen.getByText("100 − 3 − 16 = 81")).toBeTruthy(); // 19 to 20.5 misses 18.2 by 0.8
  });

  it("page 7: the lazy guess against your middle", () => {
    expect(lazyLines([20, 28])).toEqual([
      "Your middle: 24%, 2 points from the result.",
      "Lazy guess: 13.1%, 12.9 points from the result.",
      "Your middle is closer: +10 bonus points.",
    ]);
    expect(lazyLines([10, 14])[2]).toBe("The lazy guess is closer: no bonus.");
    // A tie says so: middle 21 and a lazy guess of 31 are both 5 from 26.
    expect(lazyLines([20, 22], 26, 31)[2]).toBe("Equally close: no bonus.");
    // Maruti's own numbers: a middle of 38.9 is 12.9 from 26, like the lazy 13.1.
    expect(lazyLines([36.9, 40.9])[2]).toBe("Equally close: no bonus.");
    expect(scoreMetric(20, 28, 26, 13.1).beatLazy).toBe(true);
  });

  it("page 9: the quiz answers are the approved lines, worked out by scoring", () => {
    const [q1, q2, q3] = quizQuestions();
    expect([q1.correct, q1.explain]).toEqual([1, "B. It is 1.5 points wide and contains 12%: 100 − 3 = 97. A is 4 points wide: 100 − 8 = 92."]);
    expect([q2.correct, q2.explain]).toEqual([1, "76. Width costs 4, and you missed by 1 point, which costs 20: 100 − 4 − 20 = 76."]);
    expect([q3.correct, q3.explain]).toEqual([0, "Yes. Your middle, 12%, is 0 points from the result; the lazy guess is 3 points away: 92 + 10 = 102."]);
  });

  it("page 9: answering shows Correct or Incorrect, then the next question", () => {
    render(<QuizObject />);
    fireEvent.click(screen.getByRole("button", { name: "A: 10% to 14%" }));
    expect(screen.getByText(/^Incorrect\. B\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "B: 11% to 12.5%" }));
    expect(screen.getByText(/^Correct\. B\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    expect(screen.getByText("The result is 12%. Your range is 13% to 15%. What is your score?")).toBeTruthy();
  });

  it("page 10: the actions without arrows, then three practice tiles in Mystery mode", async () => {
    const { container } = render(<YourTurnObject />);
    const start = screen.getByRole("link", { name: "Start a practice forecast" });
    expect(start.className).toBe("btn btn-primary");
    expect(container.querySelector(".g2-actions .btn-arrow-icon")).toBeNull();
    await waitFor(() => expect(container.querySelectorAll(".g2-practice .practice-tile")).toHaveLength(3));
    // Inside the guide's stacked pages the tiles skip Home's scroll rise.
    expect(container.querySelector(".g2-practice [data-scrub]")).toBeNull();
    expect(container.querySelector(".g2-practice .tile-name")?.textContent).toBe("Mystery company");
  });
});

describe("pages 2 and 3: real numbers and made-up splits", () => {
  it("works out Maruti Suzuki's growth from its two numbers", () => {
    expect(growthSum(53356, 42344)).toBe("(53,356 − 42,344) ÷ 42,344 = 26.0%");
    expect(growthSum(40000, 42344)).toBe("(40,000 − 42,344) ÷ 42,344 = −5.5%");
  });

  it("splits ₹100 so the parts always add up", () => {
    expect(marginSplit(18)).toEqual({ materials: 55, staff: 12, other: 15, left: 18 });
    for (const left of [0, 7, 18, 33, 60]) {
      const s = marginSplit(left);
      expect(s.materials + s.staff + s.other + s.left).toBe(100);
    }
  });
});

describe("page 5: ten made-up results as a dot plot", () => {
  it("counts what the range catches and reacts", () => {
    expect(caught([8, 12])).toBe(7);
    expect(caught([9, 10])).toBe(5);
    expect(caught([5, 16])).toBe(10);
    // v3 wording: what to do about it, against the 80% target.
    expect([4, 7, 8, 9, 10].map(caughtLine)).toEqual([
      "For 80%, widen it.",
      "For 80%, widen it slightly.",
      "This matches the 80% target.",
      "For 80%, narrow it slightly. Extra width costs points.",
      "For 80%, narrow it. Extra width costs points.",
    ]);
  });

  it("stacks equal results straight up, never half on top of each other", () => {
    const places = restingPlaces([10, 9, 10, 9, 10, 9.5], (v) => v * 40, (v) => v >= 10, 30);
    // The 9s (and 9.5, too close to share the row) stack in one column...
    expect([places[1], places[3], places[5]]).toEqual([{ at: 9, lift: 0 }, { at: 9, lift: 30 }, { at: 9, lift: 60 }]);
    // ...the 10s in another, 4px up on the range.
    expect([places[0], places[2], places[4]]).toEqual([{ at: 10, lift: 4 }, { at: 10, lift: 34 }, { at: 10, lift: 64 }]);
  });

  it("marks the ten results and updates the count live as the range moves", () => {
    const { container } = render(<DropObject />);
    const marks = [...container.querySelectorAll<HTMLElement>(".g2-mark")];
    expect(marks).toHaveLength(10);
    expect(container.querySelectorAll(".g2-mark.is-in")).toHaveLength(7);
    expect(container.querySelector(".g2-ball")).toBeNull();
    expect(screen.queryByRole("button", { name: /Test/ })).toBeNull();
    expect(screen.getByText("Caught 7 of 10")).toBeTruthy();
    expect(screen.getByText("Width cost: 8 points")).toBeTruthy();
    expect(screen.getByText("For 80%, widen it slightly.")).toBeTruthy();
    // Widen the high end from 12 to 13 (two half-point steps): 13 comes inside.
    const high = screen.getByRole("slider", { name: "High" });
    fireEvent.keyDown(high, { key: "ArrowRight" });
    fireEvent.keyDown(high, { key: "ArrowRight" });
    expect(screen.getByText("Caught 8 of 10")).toBeTruthy();
    expect(screen.getByText("Width cost: 10 points")).toBeTruthy();
    expect(screen.getByText("This matches the 80% target.")).toBeTruthy();
    expect(container.querySelectorAll(".g2-mark.is-in")).toHaveLength(8);
  });

  it("sets equal results 4px apart and never lets marks touch", () => {
    const px = (v: number) => v * 31;
    const at = markPlaces(DROP_RESULTS, px);
    // The three 10s: centred on 10, 4px apart; the two 9s either side of 9.
    expect([at[4], at[5], at[6]]).toEqual([306, 310, 314]);
    expect([at[2], at[3]]).toEqual([277, 281]);
    const sorted = [...at].sort((a, b) => a - b);
    sorted.slice(1).forEach((v, i) => expect(v - sorted[i]).toBeGreaterThanOrEqual(4));
    // Values closer than 4px merge into one evenly spread group.
    const near = markPlaces([10, 10, 10, 10.1], px);
    const s2 = [...near].sort((a, b) => a - b);
    s2.slice(1).forEach((v, i) => expect(v - s2[i]).toBeCloseTo(4, 9));
  });
});

describe("layout pass objects", () => {
  it("page 1's picker: four card tiles, same buttons, labels and keyboard", () => {
    const { container } = render(
      <GuideLayoutContext.Provider value="picker">
        <QuartersObject />
      </GuideLayoutContext.Provider>
    );
    const tiles = [...container.querySelectorAll(".g3-tile")];
    expect(tiles.map((t) => t.textContent)).toEqual(["Apr to Jun", "Jul to Sep", "Oct to Dec", "Jan to Mar"]);
    expect(container.querySelector(".g2-pill-names")).toBeNull();
    const button = screen.getByRole("button", { name: "Jul to Sep" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(tiles[1].classList.contains("is-picked")).toBe(true);
    expect(tiles[1].querySelector(".slab-range.is-steel.g3-tile-edge")).not.toBeNull();
    expect(container.querySelectorAll(".g3-tile-edge")).toHaveLength(1);
    expect(screen.getByText("Jul to Sep: results due by mid November.")).toBeTruthy();
    expect(container.querySelector(".g2-ball-label")?.textContent).toBe("Results day");
  });

  it("page 5 in the split layout: tilted wrapper, keyboard still moves the range", () => {
    const { container } = render(
      <GuideLayoutContext.Provider value="split">
        <DropObject />
      </GuideLayoutContext.Provider>
    );
    expect(container.querySelector(".g2-rail-wrap.is-tilted > .g2-tilt > .g2-rail")).not.toBeNull();
    const high = screen.getByRole("slider", { name: "High" });
    fireEvent.keyDown(high, { key: "ArrowRight" });
    fireEvent.keyDown(high, { key: "ArrowRight" });
    expect(screen.getByText("Caught 8 of 10")).toBeTruthy();
  });
});

describe("tap objects", () => {
  it("page 1 marks results day for the quarter you tap", () => {
    const { container } = render(<QuartersObject />);
    fireEvent.click(screen.getByRole("button", { name: "Jan to Mar" }));
    expect(screen.getByText("Jan to Mar: results due by the end of May.")).toBeTruthy();
    expect(container.querySelector(".g2-ball-label")?.textContent).toBe("Results day");
    // Four equal quarters.
    const widths = [...container.querySelectorAll<HTMLElement>(".g2-segment")].map((b) => b.style.width);
    expect(new Set(widths).size).toBe(1);
  });

  it("page 8 names its stops and starts on the first", () => {
    const { container } = render(<CluesObject />);
    expect([...container.querySelectorAll(".g2-pill-names span")].map((l) => l.textContent)).toEqual([
      "Last year", "Last quarter", "Managers", "Monthly data",
    ]);
    expect(screen.getByRole("button", { name: "Last year" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("The same quarter last year.")).toBeTruthy();
  });

  it("pages 2 and 3 draw their bars with Home's materials, never gold", () => {
    const two = render(<RevenueObject />);
    expect(two.container.querySelectorAll(".g2-bar-draw .slab")).toHaveLength(2);
    expect(two.container.querySelectorAll(".slab-range.is-steel")).toHaveLength(2);
    expect(two.container.querySelector("svg")).toBeNull();
    two.unmount();
    const three = render(<MarginObject />);
    expect(three.container.querySelectorAll(".g2-split .slab-range.is-steel")).toHaveLength(4);
    expect(three.container.querySelectorAll(".g2-legend .g2-swatch")).toHaveLength(4);
    expect(three.container.querySelector(".slab-range:not(.is-steel)")).toBeNull();
  });

  it("page 2's sum can only wrap before the equals sign", () => {
    const { container } = render(<RevenueObject />);
    const parts = [...container.querySelectorAll(".g2-sum .g2-nowrap")].map((p) => p.textContent);
    expect(parts).toEqual(["(53,356 − 42,344) ÷ 42,344", "= 26.0%"]);
  });

  it("builds the slider from Home's hero materials, with no SVG track", () => {
    const { container } = render(<ScoreObject />);
    expect(container.querySelector(".g2-rail svg")).toBeNull();
    expect(container.querySelector(".g2-rail .slab")).not.toBeNull();
    expect(container.querySelector(".g2-rail .slab-range")).not.toBeNull();
    // Two 44px hit areas, each with a knob that CSS shows on hover, focus or drag.
    expect(container.querySelectorAll(".g2-knob-hit .g2-knob")).toHaveLength(2);
    // The steel ball (Home's skin) and its contact shadow.
    expect(container.querySelector(".g2-ball .ball-skin .ball-texture")).not.toBeNull();
    expect(container.querySelector(".g2-ball .slab-shadow")).not.toBeNull();
  });

  it("page 1 shows the picked quarter as a steel capsule, never gold", () => {
    const { container } = render(<QuartersObject />);
    fireEvent.click(screen.getByRole("button", { name: "Apr to Jun" }));
    expect(container.querySelectorAll(".slab-range")).toHaveLength(1);
    expect(container.querySelector(".slab-range")?.classList.contains("is-steel")).toBe(true);
  });

  it("page 4 shows each sector's approved line", () => {
    render(<SectorObject />);
    fireEvent.click(screen.getByRole("button", { name: "Autos" }));
    expect(screen.getByText("How many more vehicles it sold, in India and abroad, than in the same three months last year.")).toBeTruthy();
    // Pill names (2026-11-24: "Everyday goods", no "(FMCG)").
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Cement", "Autos", "Everyday goods", "IT services",
    ]);
  });
});

describe("phone details", () => {
  it("keeps at most four scale labels, 48px or more apart", () => {
    const px = (v: number) => (v - 5) * 34; // a 374px rail from 5% to 16%
    expect(thinTicks([6, 8, 10, 12, 14, 16], px)).toEqual([6, 10, 14]);
    const tight = (v: number) => (v - 5) * 12; // 12px a point
    const picked = thinTicks([5, 10, 15, 20, 25, 30, 35], tight);
    expect(picked.length).toBeLessThanOrEqual(4);
    picked.forEach((t, i) => i && expect(tight(t) - tight(picked[i - 1])).toBeGreaterThanOrEqual(48));
  });

  it("never breaks inside a sum", () => {
    const { container } = render(<p>{keepSums("Right. B. It's 1.5 points wide and catches 12%: 100 − 3 = 97. A is 4 points wide: 100 − 8 = 92.")}</p>);
    expect([...container.querySelectorAll(".g2-nowrap")].map((s) => s.textContent)).toEqual(["100 − 3 = 97", "100 − 8 = 92"]);
    const two = render(<p>{keepSums("away: 92 + 10 = 102.")}</p>);
    expect(two.container.querySelector(".g2-nowrap")?.textContent).toBe("92 + 10 = 102");
  });
});

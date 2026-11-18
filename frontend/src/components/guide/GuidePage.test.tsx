// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", () => ({
  fetchLeagueConfig: vi.fn(() => Promise.reject(new Error("offline"))),
  fetchLeagueEvents: vi.fn(() => Promise.resolve([])),
}));

import GuidePage from "./GuidePage";

const TITLES = [
  "Companies report every three months",
  "You forecast three numbers",
  "Give a range, not one number",
  "How your score works",
  "Beat the lazy guess",
  "Try one",
];

function motion(reduce: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: reduce }) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the guide", () => {
  it("has six numbered steps that open with + and say so to screen readers", () => {
    motion(false);
    render(<GuidePage />);
    const heads = TITLES.map((t) => screen.getByRole("button", { name: t }));
    expect(heads).toHaveLength(6);
    expect(heads[3].getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(heads[3]);
    expect(heads[3].getAttribute("aria-expanded")).toBe("true");
    const region = screen.getByRole("region", { name: "How your score works" });
    expect(region.textContent).toContain("You lost 8 points for width: 100 - 8 = 92.".slice(4));
    fireEvent.click(heads[3]);
    expect(heads[3].getAttribute("aria-expanded")).toBe("false");
  });

  it("step 3's range counts the made-up dots it catches", () => {
    motion(false);
    render(<GuidePage />);
    fireEvent.click(screen.getByRole("button", { name: TITLES[2] }));
    expect(screen.getByText("Your range catches 5 of these 10.")).toBeTruthy();
    fireEvent.change(screen.getAllByRole("slider", { name: "High" })[0], { target: { value: "20" } });
    expect(screen.getByText("Your range catches 7 of these 10.")).toBeTruthy();
  });

  it("the object shows what the step in focus shows, live while dragging, motion or not", () => {
    for (const reduce of [false, true]) {
      motion(reduce);
      const { container, unmount } = render(<GuidePage />);
      const obj = () => container.querySelector(".guide-object") as HTMLElement;
      const on = (sel: string) => !!obj().querySelector(sel)?.classList.contains("is-on");
      expect(obj().getAttribute("data-step")).toBe("0");
      expect(on(".guide-range")).toBe(false);

      // Step 1: four quarters, the newest lit as results day, then the one tapped.
      const lit = () => [...obj().querySelectorAll(".guide-quarter")].findIndex((q) => q.classList.contains("is-lit"));
      expect(on(".guide-quarters")).toBe(true);
      expect(lit()).toBe(3);
      fireEvent.click(screen.getByRole("button", { name: TITLES[0] }));
      fireEvent.click(screen.getByRole("button", { name: "Q2" }));
      expect(lit()).toBe(1);
      expect(obj().textContent).toContain("Results day");

      // Step 3: the range and the ten made-up dots, following the slider.
      fireEvent.click(screen.getByRole("button", { name: TITLES[2] }));
      expect(obj().getAttribute("data-step")).toBe("2");
      expect(obj().querySelectorAll(".guide-object-dot")).toHaveLength(10);
      expect(obj().querySelectorAll(".guide-object-dot.is-caught")).toHaveLength(5);
      fireEvent.change(screen.getAllByRole("slider", { name: "High" })[0], { target: { value: "20" } });
      expect(obj().querySelectorAll(".guide-object-dot.is-caught")).toHaveLength(7);

      // Step 4: ball inside; drag the range off it and the ball drops outside.
      fireEvent.click(screen.getByRole("button", { name: TITLES[3] }));
      expect(on(".guide-ball")).toBe(true);
      expect(on(".guide-lazy")).toBe(false);
      expect(obj().querySelector(".guide-ball")?.classList.contains("on-range")).toBe(true);
      const step4High = screen.getAllByRole("slider", { name: "High" })[1];
      const step4Low = screen.getAllByRole("slider", { name: "Low" })[1];
      fireEvent.change(step4Low, { target: { value: "13" } });
      fireEvent.change(step4High, { target: { value: "16" } });
      expect(obj().querySelector(".guide-ball")?.classList.contains("on-track")).toBe(true);
      expect(on(".guide-gap")).toBe(true);
      expect(obj().textContent).toContain("−20 per point");

      // Step 5: ball inside the range plus the lazy-guess mark; no score in the object.
      fireEvent.click(screen.getByRole("button", { name: TITLES[4] }));
      expect(obj().getAttribute("data-step")).toBe("4");
      expect(on(".guide-lazy")).toBe(true);
      expect(obj().querySelector(".guide-ball")?.classList.contains("on-range")).toBe(true);
      expect(on(".guide-gap")).toBe(false);
      expect(obj().textContent).not.toContain("points");
      unmount();
    }
  });
});

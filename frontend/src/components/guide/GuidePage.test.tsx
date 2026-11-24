// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", () => ({
  fetchLeagueEvents: vi.fn(() => Promise.resolve([])),
  fetchPracticeCases: vi.fn(() => Promise.resolve([])),
  fetchRecentResults: vi.fn(() => Promise.resolve([])),
  fetchResearchHistory: vi.fn(() => Promise.resolve(null)),
}));

import GuidePage, { PAGE_COUNT } from "./GuidePage";

function motion(reduce: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: reduce }) as unknown as typeof window.matchMedia;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the guide", () => {
  it("is ten sections, each with a title, facts, text and an object", () => {
    motion(false);
    const { container } = render(<GuidePage />);
    expect(PAGE_COUNT).toBe(10);
    const sections = [...container.querySelectorAll("section.g2-page")];
    expect(sections.map((s) => s.querySelector("h2")?.textContent)).toEqual([
      "Quarterly results", "Revenue growth", "Operating margin", "Sector number", "Your range", "How you score",
      "The lazy guess", "Where to look", "Check yourself", "First forecast",
    ]);
    for (const s of sections) {
      expect(s.querySelectorAll(".g2-facts li")).toHaveLength(3);
      expect(s.querySelector(".g2-text, .g3-para")?.textContent?.length).toBeGreaterThan(40);
      expect(s.querySelector(".g2-side")).not.toBeNull();
      // Home's parts: background lines, headline with a gold last word, the strip's panel.
      expect(s.querySelector(".hero-waves")).not.toBeNull();
      expect(s.querySelector("h2.hero-title .hero-title-gold")).not.toBeNull();
      expect(s.querySelector(".g2-facts.strip-panel")).not.toBeNull();
    }
    expect(sections.map((s) => s.querySelector(".hero-title-gold")?.textContent)).toEqual([
      "results", "growth", "margin", "number", "range", "score", "guess", "look", "yourself", "forecast",
    ]);
    expect(screen.getByRole("heading", { level: 1, name: "How to play" })).toBeTruthy();
    expect(container.querySelector(".g2-counter")?.textContent).toBe("1 / 10");
    // Phones: a hairline at each page's share; screen readers hear the page number.
    expect((sections[4].querySelector(".g2-progress") as HTMLElement).style.getPropertyValue("--share")).toBe("0.5");
    expect(sections[4].textContent).toContain("Page 5 of 10");
    // Every page but the last has a dwell; the last scrolls on as a normal page.
    expect(container.querySelectorAll(".g2-stack > .g2-dwell")).toHaveLength(9);
    expect(sections[9].classList.contains("is-last")).toBe(true);
    // No v2 leftovers: no fitted big word, no graphite grain on the pages.
    expect(container.querySelector(".g2-word, .g2-material")).toBeNull();
  });

  it("shows the company's small card beside its real numbers on pages 2, 3, 6 and 7", () => {
    motion(false);
    const { container } = render(<GuidePage />);
    const sections = [...container.querySelectorAll("section.g2-page")];
    const names = sections.map((s) => s.querySelector(".g2-company-desk .tile-name, .g3-company .tile-name")?.textContent ?? null);
    expect(names).toEqual([null, "Maruti Suzuki", "Marico", null, null, "Marico", "Maruti Suzuki", null, null, null]);
    // Layout-pass pages: one card, as the object's label (never in the paragraph).
    expect(sections[5].querySelectorAll(".g2-company")).toHaveLength(1);
    expect(sections[5].querySelector(".g3-stage > .g3-company")).not.toBeNull();
    // One card for phones (beside the title), one for desktop (beside the facts).
    expect(sections[1].querySelectorAll(".g2-company")).toHaveLength(2);
    expect(sections[1].querySelector(".g2-company .card3d-guilloche")).not.toBeNull();
  });

  it("page 10 offers the practice and league actions in the v3 wording", () => {
    motion(false);
    render(<GuidePage />);
    expect(screen.getByRole("link", { name: "Start a practice forecast" }).getAttribute("href")).toBe("#/practice?surprise=1");
    expect(screen.getByRole("link", { name: "Choose a practice company" }).getAttribute("href")).toBe("#/practice");
    expect(screen.queryByText("Surprise me")).toBeNull();
    expect(screen.getByRole("link", { name: "Start a practice forecast" }).querySelector(".btn-arrow-icon")).toBeNull();
  });

  it("uses the approved facts on pages 4 and 9", () => {
    motion(false);
    render(<GuidePage />);
    expect(screen.getByText("sales reports a year from car and tractor makers")).toBeTruthy();
    expect(screen.getByText("bonus for beating the lazy guess")).toBeTruthy();
  });

  it("drops the stack under reduced motion: pages simply scroll", () => {
    motion(true);
    const { container } = render(<GuidePage />);
    expect(container.querySelector(".g2-stack")?.classList.contains("is-still")).toBe(true);
    expect((container.querySelector(".g2-sheet") as HTMLElement).style.transform).toBe("");
  });

  it("uses the layout pass on pages 1, 5 and 6 only, with the words unchanged", () => {
    motion(false);
    const { container } = render(<GuidePage />);
    const sections = [...container.querySelectorAll("section.g2-page")];
    expect(sections.map((s) => (s.querySelector(".g3-inner") ? s.querySelector(".g3-inner")!.className : "v3"))).toEqual([
      "g3-inner is-picker", "v3", "v3", "v3", "g3-inner is-split", "g3-inner is-split", "v3", "v3", "v3", "v3",
    ]);
    // The approved paragraphs, word for word; the first sentence is the lead.
    const para = (i: number) => sections[i].querySelector(".g3-para") as HTMLElement;
    expect(para(4).textContent).toBe(
      "No one knows the exact number before results day, so you give a range: a low and a high. Aim for a range that would contain the actual result 8 times out of 10. A narrow range misses often. A wide range rarely misses, but width reduces your score."
    );
    expect(para(4).querySelector(".g3-lead")?.textContent).toBe(
      "No one knows the exact number before results day, so you give a range: a low and a high."
    );
    expect(para(0).querySelector(".g3-lead")?.textContent).toBe(
      "A company's financial year is divided into four quarters of three months."
    );
    expect(para(5).querySelector(".g3-lead")?.textContent).toBe("Each number you forecast starts at 100 points.");
    // Waves show: the sheet isolates, as Home's hero does.
    expect(sections[4].querySelector(".g2-sheet")?.classList.contains("g3-sheet")).toBe(true);
    // Page 1's picker: four card tiles; page 5's slab tilts (CSS flattens it when held).
    expect(sections[0].querySelectorAll(".g3-tile.sector-neutral .tile-material")).toHaveLength(4);
    expect(sections[4].querySelector(".g2-rail-wrap.is-tilted .g2-tilt .g2-rail")).not.toBeNull();
    expect(sections[1].querySelector(".is-tilted")).toBeNull();
  });
});

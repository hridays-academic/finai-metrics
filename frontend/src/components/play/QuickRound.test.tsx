// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayCard } from "../../lib/api";

vi.mock("../../lib/api", () => {
  class ApiError extends Error {}
  return { ApiError, fetchPlayCards: vi.fn(), revealPlayCard: vi.fn(), submitRound: vi.fn(), fetchDaily: vi.fn() };
});
vi.mock("../../lib/reports", () => ({ recordUsage: vi.fn() }));
vi.mock("../SiteFooter", () => ({ default: () => <footer>Site footer</footer> }));

import * as api from "../../lib/api";
import QuickRound, { cardTitle } from "./QuickRound";

const mocked = vi.mocked(api);
const store = new Map<string, string>();

const card = (i: number, label: string): PlayCard => ({
  id: `abc123-${i}`, sector: "cement", sector_name: "Cement", difficulty: "easy", name: null,
  mystery_line: "A cement maker", quarter: null, metric_key: "revenue_growth_yoy", label, unit: "%",
  last_year: 10, last_quarter: null, min_value: -100, max_value: 500,
});

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  mocked.fetchPlayCards.mockResolvedValue([card(0, "Revenue growth (YoY)"), card(1, "Operating margin"), card(2, "Sales volume growth (YoY)")]);
  mocked.revealPlayCard.mockImplementation(async (id: string) => ({
    actual: 11, hit: id.endsWith("0"), points: 50, beat_lazy: true, missed_by: id.endsWith("0") ? 0 : 1.5,
    lazy: 10, note: null, name: "Demo Cement", quarter: "Q3 FY26",
  }));
  mocked.submitRound.mockResolvedValue({
    score: 120, hits: 1, cards: 3, saved: false, not_saved_reason: "signed_out", xp_gained: 0, xp: null, level: null,
    best: null, new_badges: [],
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function play() {
  for (let i = 0; i < 3; i++) {
    // Every card starts with no range set.
    expect(await screen.findByText("Drag along the bar to set your low and high. Last year is marked.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("slider", { name: /set a range/ }), { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    fireEvent.click(await screen.findByRole("button", { name: i < 2 ? "Next card" : "See how you did" }));
  }
}

describe("QuickRound (Stop 2 fixes)", () => {
  it("titles cards in sentence case without (YoY)", () => {
    expect(cardTitle("Revenue growth (YoY)")).toBe("Revenue growth");
    expect(cardTitle("Constant-currency revenue growth (YoY)")).toBe("Constant-currency revenue growth");
    expect(cardTitle("operating margin")).toBe("Operating margin");
  });

  it("hides the footer during a round, starts every card empty, and ends with dots", async () => {
    render(<QuickRound />);
    const title = await screen.findByRole("heading", { level: 2 });
    expect(["Revenue growth", "Operating margin", "Sales volume growth"]).toContain(title.textContent);
    expect(screen.getByText("Last year's figure is marked on the bar. Start there, then ask what has changed since.")).toBeTruthy();
    expect(screen.queryByText("Site footer")).toBeNull();
    await play();
    await waitFor(() => expect(screen.getByText("Site footer")).toBeTruthy());
    const dots = screen.getAllByRole("button", { name: /^Card \d/ });
    expect(dots.filter((d) => d.className.includes("is-hit"))).toHaveLength(1);
    const missed = dots.find((d) => d.className.includes("is-miss"))!;
    fireEvent.click(missed);
    expect(missed.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Your range")).toBeTruthy();
    expect(screen.getByText("11% (missed by 1.5)")).toBeTruthy();
    expect(screen.getByText("That's a good place to stop. The daily challenge resets at midnight.")).toBeTruthy();
    // The server re-scores the round; signed out, nothing is saved.
    expect(mocked.submitRound).toHaveBeenCalledWith(expect.objectContaining({ kind: "quick" }));
    expect(mocked.submitRound.mock.calls[0][0].answers).toHaveLength(3);
    expect(await screen.findByText("Sign in to keep this score.")).toBeTruthy();
  });
});


describe("Daily challenge", () => {
  it("plays today's cards and shows what was saved", async () => {
    store.set("stackly_played_quick", "1");
    mocked.fetchDaily.mockResolvedValue({
      day: "2026-11-25", played: false, my_score: null, average: null,
      cards: [card(0, "Revenue growth (YoY)"), card(1, "Operating margin"), card(2, "Sales volume growth (YoY)")],
    });
    mocked.submitRound.mockResolvedValue({
      score: 150, hits: 1, cards: 3, saved: true, not_saved_reason: null, xp_gained: 3, xp: 43, level: 2,
      best: 150, new_badges: ["First daily challenge"],
    });
    render(<QuickRound mode="daily" />);
    expect(await screen.findByText("The same 10 cards for everyone today. It counts once.")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Revenue growth"); // today's order, not shuffled
    await play();
    expect(mocked.submitRound.mock.calls[0][0]).toMatchObject({ kind: "daily", gold_index: null });
    expect(await screen.findByText("+3 XP. Level 2. New badge: First daily challenge.")).toBeTruthy();
  });
});

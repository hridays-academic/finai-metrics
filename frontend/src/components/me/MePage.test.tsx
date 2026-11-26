// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Progress } from "../../lib/api";
import type { UserPublic } from "../../lib/types";

vi.mock("../../lib/api", () => {
  class ApiError extends Error {}
  return { ApiError, fetchProgress: vi.fn(), fetchBoard: vi.fn() };
});
vi.mock("../SiteFooter", () => ({ default: () => null }));

import * as api from "../../lib/api";
import BoardsPage from "./BoardsPage";
import MePage from "./MePage";

const USER = { id: 1, handle: "Asha_07", is_admin: false } as UserPublic;
const PROGRESS: Progress = {
  saving: true, not_saved_reason: null, xp: 150, level: 3, level_start: 120, next_level: 240, xp_today_capped: 4,
  daily_cap: 5, days_played_this_term: 12, ranges: 20, ranges_inside: 14,
  weeks: [{ week_start: "2026-11-23", cards: 10, hits: 7 }],
  badges: [
    { key: "well_calibrated", name: "Well calibrated", description: "d", earned_at: null },
    { key: "first_daily", name: "First daily challenge", description: "d", earned_at: "2026-11-25T10:00:00Z" },
  ],
  bests: { quick_round: 410, daily_challenge: null, league: 72.4, practice: 55 },
  unlocks: [{ level: 2, key: "hard", name: "Hard companies in Practice and quick rounds", unlocked: true }],
  forecasts: [
    { event_id: 7, company: "Marico", season_label: "Q3 FY27", status: "open", score: null, results_date: "2027-02-02" },
    { event_id: 3, company: "Dabur India", season_label: "Q2 FY27", status: "scored", score: 64.2, results_date: "2026-11-04" },
  ],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MePage", () => {
  it("shows level, days played, how often ranges caught the result, badges and forecasts", async () => {
    vi.mocked(api.fetchProgress).mockResolvedValue(PROGRESS);
    render(<MePage user={USER} onOpenAuth={() => {}} />);
    expect(await screen.findByText("Played 12 days")).toBeTruthy();
    // A2: the handle as typed, one "Level 3", and the weekly bars explained.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Asha_07");
    expect(screen.getByRole("heading", { level: 1 }).className).toBe("me-handle");
    expect(screen.getAllByText("Level 3")).toHaveLength(1);
    expect(screen.getByText("Cards that landed inside your range each week. The line marks 8 in 10, the aim.")).toBeTruthy();
    expect(screen.getByText("Caught 7 of 10 (aim: 8)")).toBeTruthy();
    expect(screen.getByText("150 XP. 90 more for Level 4.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Dabur India, Q2 FY27" }).getAttribute("href")).toBe("#/results/3");
    expect(screen.getByRole("link", { name: "Marico, Q3 FY27" }).getAttribute("href")).toBe("#/event/7");
    expect(screen.getAllByText("Not yet").length).toBeGreaterThan(0);
  });

  it("asks a signed-out visitor to sign in", () => {
    render(<MePage user={null} onOpenAuth={() => {}} />);
    expect(screen.getByText("Sign in to see your level, badges and forecasts.")).toBeTruthy();
    expect(api.fetchProgress).not.toHaveBeenCalled();
  });
});

describe("BoardsPage", () => {
  it("ranks handles and explains why you're not on it", async () => {
    vi.mocked(api.fetchBoard).mockResolvedValue({
      board: "week", title: "This week", season_label: null, minimum: 20, you: null, your_status: "hidden",
      rows: [{ rank: 1, handle: "Ravi_K", value: 71.25, count: 30, you: false }],
    });
    render(<BoardsPage user={USER} />);
    expect(await screen.findByText("Ravi_K")).toBeTruthy();
    expect(screen.getByText("You're hidden from leaderboards. You can change this in Settings.")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "This week" }).getAttribute("aria-selected")).toBe("true");
    // A1: short column head, and a select for phones.
    expect(screen.getByRole("columnheader", { name: "Avg per card" })).toBeTruthy();
    expect((screen.getByLabelText("Leaderboard:") as HTMLSelectElement).value).toBe("week");
  });
});

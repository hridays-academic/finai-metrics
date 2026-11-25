// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PracticeCard } from "../../lib/types";

vi.mock("../../lib/api", () => {
  class ApiError extends Error {}
  return { ApiError, fetchPracticeCases: vi.fn() };
});
vi.mock("../../lib/practice", () => ({ mysteryOn: () => true, setMystery: vi.fn(), surprise: vi.fn() }));
vi.mock("../SiteFooter", () => ({ default: () => null }));
vi.mock("./PracticeTile", () => ({ default: ({ card }: { card: PracticeCard }) => <span>{card.code}</span> }));

import * as api from "../../lib/api";
import PracticePage from "./PracticePage";

const card = (code: string, sector_name: string, difficulty: PracticeCard["difficulty"]): PracticeCard => ({
  code, sector: sector_name.toLowerCase(), sector_name, difficulty, mystery_line: null, name: null, ticker: null,
  season_label: null, description: null, first_score: null, attempts: 0,
});

beforeEach(() => {
  vi.mocked(api.fetchPracticeCases).mockResolvedValue([card("aaa111", "Cement", "easy"), card("bbb222", "IT services", "hard")]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Practice filters (Stop 2, item 7)", () => {
  it("offers two compact selects that filter like the chips", async () => {
    render(<PracticePage user={null} />);
    const sector = (await screen.findByLabelText("Sector:")) as HTMLSelectElement;
    const level = screen.getByLabelText("Difficulty:") as HTMLSelectElement;
    expect(sector.selectedOptions[0].textContent).toBe("All");
    expect(level.selectedOptions[0].textContent).toBe("Any");
    expect([...sector.options].map((o) => o.textContent)).toEqual(["All", "Cement", "IT services"]);
    fireEvent.change(level, { target: { value: "hard" } });
    expect(screen.queryByText("aaa111")).toBeNull();
    expect(screen.getByText("bbb222")).toBeTruthy();
    // The chips show the same choice.
    expect(screen.getByRole("button", { name: "Hard" }).getAttribute("aria-pressed")).toBe("true");
  });
});

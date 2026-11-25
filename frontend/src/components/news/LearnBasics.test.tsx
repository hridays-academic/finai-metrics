// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { NewsItem } from "../../lib/types";
import LearnBasics, { VARSITY } from "./LearnBasics";
import { splitByDay } from "./ResearchLanding";

afterEach(cleanup);

describe("Learn the basics (RW8, T8, X1)", () => {
  it("links the approved Varsity chapters and loads a video only on click, from youtube-nocookie", () => {
    const { container } = render(<LearnBasics />);
    expect(VARSITY.flatMap((v) => v.links).every((l) => l.url.startsWith("https://zerodha.com/varsity/chapter/"))).toBe(true);
    expect(container.querySelector("iframe")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /^Play:/ })[0]);
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/8rUc0MaMzik/);
    expect(screen.getAllByText("Zerodha Varsity on YouTube")).toHaveLength(2);
  });
});

describe("News by day (N7)", () => {
  it("puts today's headlines (India time) first and the rest under This week", () => {
    const item = (published_at: string) => ({ published_at, title: published_at }) as NewsItem;
    const now = new Date("2026-11-25T10:00:00+05:30");
    const { today, week } = splitByDay([item("2026-11-25T01:00:00+05:30"), item("2026-11-24T23:30:00+05:30")], now);
    expect(today.map((i) => i.title)).toEqual(["2026-11-25T01:00:00+05:30"]);
    expect(week).toHaveLength(1);
  });
});

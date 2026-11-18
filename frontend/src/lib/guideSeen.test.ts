// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guideSeenHere, markGuideSeenHere, spotlightDecision, startedOnHome } from "./guideSeen";

const base = { startedOnHome: true, seenHere: false, resetToken: false, user: null };
const account = (guide_seen: boolean, needs_terms = false) => ({ guide_seen, needs_terms });

// An in-memory localStorage (this jsdom setup doesn't provide one).
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("when the first-visit spotlight shows", () => {
  it("shows on a first visit that starts on Home", () => {
    expect(spotlightDecision(base)).toBe("show");
    expect(spotlightDecision({ ...base, user: account(false) })).toBe("show");
  });

  it("never after a shared link, a reset link or with the terms prompt open", () => {
    expect(spotlightDecision({ ...base, startedOnHome: false })).toBe("no");
    expect(spotlightDecision({ ...base, resetToken: true })).toBe("no");
    expect(spotlightDecision({ ...base, user: account(false, true) })).toBe("no");
  });

  it("not again in this browser, or on an account that has seen it", () => {
    expect(spotlightDecision({ ...base, seenHere: true })).toBe("no");
    expect(spotlightDecision({ ...base, user: account(true) })).toBe("remember");
  });

  it("knows Home's addresses from deep links", () => {
    expect(["", "#", "#/", "#/league", "#/league/"].map((h) => startedOnHome(h))).toEqual([true, true, true, true, true]);
    expect(["#/event/3", "#/results/3", "#/workspace/3", "#/learn", "#/privacy"].some((h) => startedOnHome(h))).toBe(false);
  });

  it("remembers in localStorage, and treats unreadable storage as seen", () => {
    expect(guideSeenHere()).toBe(false);
    markGuideSeenHere();
    expect(guideSeenHere()).toBe(true);
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(guideSeenHere()).toBe(true);
  });
});

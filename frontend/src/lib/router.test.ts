import { describe, expect, it } from "vitest";
import { parseHash } from "./router";

describe("addresses (T16, T17)", () => {
  it("gives Research its own address and Home the empty one", () => {
    expect(parseHash("#/research")).toEqual({ name: "research" });
    expect(parseHash("")).toBeNull();
    expect(parseHash("#/")).toBeNull();
  });

  it("sends an unknown address to page not found, never Home", () => {
    expect(parseHash("#/anything")).toEqual({ name: "notfound" });
    expect(parseHash("#/event/abc")).toEqual({ name: "notfound" });
    expect(parseHash("#/practice?surprise=1")).toEqual({ name: "practice" });
  });
});

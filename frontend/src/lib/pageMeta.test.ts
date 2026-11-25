import { describe, expect, it } from "vitest";
import { titleForRoute } from "./pageMeta";

describe("page titles (B5)", () => {
  it("names each page, and leaves company pages to set their own", () => {
    expect(titleForRoute(null)).toBeNull();
    expect(titleForRoute({ name: "practice" })).toBe("Practice");
    expect(titleForRoute({ name: "practice", code: "03kln6" })).toBe("Practice round");
    expect(titleForRoute({ name: "research" })).toBe("Research");
    expect(titleForRoute({ name: "notfound" })).toBe("Page not found");
    expect(titleForRoute({ name: "event", id: 7 })).toBeUndefined();
  });
});

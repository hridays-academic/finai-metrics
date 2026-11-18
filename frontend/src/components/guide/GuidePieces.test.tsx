// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", () => ({
  fetchLeagueConfig: vi.fn(() =>
    Promise.resolve({
      sector_explainers: [{ sector: "fmcg", display_name: "Everyday goods (FMCG)" }],
      kpi_templates: [{ sector: "fmcg", metric: { label: "Underlying volume growth", definition: "Underlying (domestic) volume growth (YoY)" } }],
    })
  ),
  fetchLeagueEvents: vi.fn(() => Promise.resolve([])),
}));

import { SectorPicker } from "./GuidePieces";

afterEach(cleanup);

describe("step 2's sector lines", () => {
  it("show the approved plain line, with no YoY or brackets", async () => {
    render(<SectorPicker picked={0} setPicked={() => {}} />);
    const line = await screen.findByText(
      "How much more product it sold in India than in the same three months last year, leaving out price rises."
    );
    expect(line.textContent).not.toContain("YoY");
    expect(line.textContent).not.toContain("(");
  });
});

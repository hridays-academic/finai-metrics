// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import RangeSlab, { niceTicks, type Pair, widen } from "./RangeSlab";

afterEach(cleanup);

// jsdom has no PointerEvent: a MouseEvent with a pointerId stands in.
if (typeof window.PointerEvent === "undefined") {
  class PE extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PE;
}

function Harness({ start = null, lastYear = 10 }: { start?: Pair | null; lastYear?: number | null }) {
  const [v, setV] = useState<Pair | null>(start);
  return (
    <>
      <RangeSlab label="Revenue growth (YoY)" unit="%" domain={[0, 20]} value={v} onChange={setV} lastYear={lastYear} />
      <output data-testid="v">{v ? `${v[0]},${v[1]}` : "none"}</output>
    </>
  );
}

// The track is 200px wide from x=0, over 0 to 20: 10px per point.
function track() {
  const el = document.querySelector(".range-slab-track") as HTMLElement;
  el.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 44, right: 200, bottom: 44, x: 0, y: 0, toJSON() {} });
  return el;
}

describe("RangeSlab", () => {
  it("starts empty with the hint, and marks last year", () => {
    render(<Harness />);
    expect(screen.getByText("Drag along the bar to set your low and high. Last year is marked.")).toBeTruthy();
    expect(screen.getByText("Last year 10%")).toBeTruthy();
    expect(screen.getByTestId("v").textContent).toBe("none");
  });

  it("sets both ends with one drag, snapped to 0.1", () => {
    render(<Harness />);
    const t = track();
    fireEvent.pointerDown(t, { clientX: 61, button: 0, pointerId: 1 });
    fireEvent.pointerMove(t, { clientX: 143, pointerId: 1 });
    fireEvent.pointerUp(t, { pointerId: 1 });
    expect(screen.getByTestId("v").textContent).toBe("6.1,14.3");
    expect(screen.getByText(/If the result lands inside: \d+(\.\d)? points\. Each point it misses by: −20\./)).toBeTruthy();
  });

  it("drags one end, or the middle, once a range exists", () => {
    render(<Harness start={[8, 12]} />);
    const t = track();
    fireEvent.pointerDown(t, { clientX: 120, button: 0 }); // the high end
    fireEvent.pointerMove(t, { clientX: 150 });
    fireEvent.pointerUp(t);
    expect(screen.getByTestId("v").textContent).toBe("8,15");
    fireEvent.pointerDown(t, { clientX: 110, button: 0 }); // the middle
    fireEvent.pointerMove(t, { clientX: 90 });
    fireEvent.pointerUp(t);
    expect(screen.getByTestId("v").textContent).toBe("6,13");
  });

  it("moves an end with the keyboard: arrows 0.1, Shift+arrows 1", () => {
    render(<Harness start={[8, 12]} />);
    const high = screen.getByRole("slider", { name: "Revenue growth (YoY) high" });
    fireEvent.keyDown(high, { key: "ArrowRight" });
    expect(screen.getByTestId("v").textContent).toBe("8,12.1");
    fireEvent.keyDown(high, { key: "ArrowLeft", shiftKey: true });
    expect(screen.getByTestId("v").textContent).toBe("8,11.1");
  });

  it("lets you type an exact number", () => {
    render(<Harness start={[8, 12]} />);
    fireEvent.click(screen.getByRole("button", { name: /^Low: 8%/ }));
    const input = screen.getByLabelText("Low (type a number)") as HTMLInputElement;
    expect(input.getAttribute("inputmode")).toBe("decimal");
    fireEvent.change(input, { target: { value: "7.45" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("v").textContent).toBe("7.5,12");
  });

  it("nudges toward 80%: very narrow, very wide", () => {
    const { rerender } = render(<RangeSlab label="M" unit="%" domain={[0, 20]} value={[10, 10.5]} onChange={() => {}} />);
    expect(screen.getByText(/This is narrow/)).toBeTruthy();
    rerender(<RangeSlab label="M" unit="%" domain={[0, 20]} value={[2, 18]} onChange={() => {}} />);
    expect(screen.getByText(/This is wide\. Its width costs 32 points/)).toBeTruthy();
  });

  it("fits its scale to the domain, the range and the marks", () => {
    expect(widen([0, 20], [18, 26], 10, null)).toEqual([0, 26]);
    expect(niceTicks(0, 20)).toEqual([0, 5, 10, 15, 20]);
  });
});

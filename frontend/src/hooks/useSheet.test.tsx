// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSheet } from "./useSheet";

function Sheet({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useSheet(ref, onClose);
  return (
    <div role="dialog" ref={ref} tabIndex={-1}>
      <button type="button">First</button>
      <button type="button">Last</button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("sheets (T19, T20, A3)", () => {
  it("closes on Escape, makes the page inert, and gives focus back on close", () => {
    const page = document.createElement("div");
    page.className = "app-shell-content";
    const opener = document.createElement("button");
    page.appendChild(opener);
    document.body.appendChild(page);
    opener.focus();
    const onClose = vi.fn();
    const { unmount, getByText } = render(<Sheet onClose={onClose} />);
    expect(page.hasAttribute("inert")).toBe(true);
    expect(page.classList.contains("is-behind-sheet")).toBe(true);
    expect(document.activeElement).toBe(getByText("First"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(page.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(opener);
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SpotlightIntro from "./SpotlightIntro";

function setup() {
  const shell = document.createElement("div");
  shell.className = "app-shell";
  shell.innerHTML = '<div id="guide-entry"><a href="#/learn">Start the guide</a></div>';
  document.body.appendChild(shell);
  Element.prototype.scrollIntoView = vi.fn();
  const onShowMe = vi.fn();
  const onSkip = vi.fn();
  const view = render(<SpotlightIntro targetId="guide-entry" onShowMe={onShowMe} onSkip={onSkip} />);
  return { shell, onShowMe, onSkip, view };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("first-visit spotlight", () => {
  it("is a labelled dialog with focus on Show me and the app behind inert", () => {
    const { shell } = setup();
    const dialog = screen.getByRole("dialog", { name: "Welcome to Stackly" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.textContent).toContain("New here? This short guide shows you how to play.");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Show me" }));
    expect(shell.hasAttribute("inert")).toBe(true);
  });

  it("keeps Tab inside, and Escape skips", () => {
    const { onSkip } = setup();
    const show = screen.getByRole("button", { name: "Show me" });
    const skip = screen.getByRole("button", { name: "Skip" });
    skip.focus();
    fireEvent.keyDown(skip, { key: "Tab" });
    expect(document.activeElement).toBe(show);
    fireEvent.keyDown(show, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(skip);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("Show me and Skip call back, and closing frees the app", () => {
    const { shell, onShowMe, onSkip, view } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Show me" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(onShowMe).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(shell.hasAttribute("inert")).toBe(false);
  });
});

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GuideEvent, GuidePage } from "../../lib/api";
import type { UserPublic } from "../../lib/types";

vi.mock("../../lib/api", () => {
  class ApiError extends Error {
    status: number;
    code: string | null;
    constructor(message: string, status = 0, code: string | null = null) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return { ApiError, fetchGuideStatus: vi.fn(), askGuide: vi.fn() };
});

import * as api from "../../lib/api";
import AiGuide from "./AiGuide";

const m = vi.mocked(api);
const user = { id: 7 } as UserPublic;
const HOME: GuidePage = { kind: "home" };

beforeEach(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("pointer: fine"), media: q, addEventListener() {}, removeEventListener() {} }));
  document.body.innerHTML = '<div class="app-shell-content"></div>';
  m.fetchGuideStatus.mockResolvedValue({ available: true, reason: null, message: null, left: null });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-motion");
});

async function openGuide(page = HOME) {
  render(<AiGuide user={user} page={page} />);
  fireEvent.click(await screen.findByRole("button", { name: "Open the guide, an AI, not a person" }));
  return screen.getByRole("dialog", { name: "Guide" });
}

describe("AI guide (phase 12)", () => {
  it("shows nothing unless the server says it's available", async () => {
    m.fetchGuideStatus.mockResolvedValue({ available: false, reason: "consent_pending", message: "x", left: null });
    render(<AiGuide user={user} page={HOME} />);
    await waitFor(() => expect(m.fetchGuideStatus).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Open the guide/ })).toBeNull();
  });

  it("says it's an AI first, streams a reply and announces it politely", async () => {
    m.askGuide.mockImplementation(async (_p, _q, _h, onEvent: (e: GuideEvent) => void) => {
      onEvent({ type: "text", text: "A range has a low " });
      onEvent({ type: "text", text: "and a high." });
      onEvent({ type: "done", outcome: "answered", left: 3 });
    });
    const dialog = await openGuide();
    const first = dialog.querySelector(".ai-guide-says")!;
    expect(first.textContent).toMatch(/^Hello\. I'm Stackly's AI guide, not a person\./);
    expect(screen.getByText("An AI guide, not a person")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Ask the guide"));
    fireEvent.click(screen.getByRole("button", { name: "What is a range?" }));
    await screen.findByText("A range has a low and a high.");
    expect(m.askGuide.mock.calls[0][0]).toEqual(HOME);
    expect(m.askGuide.mock.calls[0][1]).toBe("What is a range?");
    const live = dialog.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toBe("A range has a low and a high.");
    expect(screen.getByText(/3 questions left today\./)).toBeTruthy();
  });

  it("replaces a reply with the fixed one and never sends the history beyond 6 turns", async () => {
    m.askGuide.mockImplementation(async (_p, _q, _h, onEvent: (e: GuideEvent) => void) => {
      onEvent({ type: "text", text: "Something." });
      onEvent({ type: "replace", text: "I can't help with buying or selling shares.", outcome: "advice" });
      onEvent({ type: "done", outcome: "advice", left: null });
    });
    await openGuide();
    const box = screen.getByLabelText("Ask the guide");
    for (let i = 0; i < 5; i++) {
      fireEvent.change(box, { target: { value: `Question ${i}` } });
      fireEvent.submit(box.closest("form")!);
      await waitFor(() => expect(m.askGuide).toHaveBeenCalledTimes(i + 1));
      await waitFor(() => expect((box as HTMLInputElement).disabled).toBe(false));
    }
    const shown = [...document.querySelectorAll(".ai-guide-says")].filter((p) => p.textContent === "I can't help with buying or selling shares.");
    expect(shown.length).toBe(5);
    expect(screen.queryByText("Something.")).toBeNull();
    const lastHistory = m.askGuide.mock.calls[4][2];
    expect(lastHistory.length).toBeLessThanOrEqual(6);
  });

  it("shows the server's message when it refuses", async () => {
    m.askGuide.mockRejectedValue(new api.ApiError("The guide is resting until tomorrow.", 429, "resting"));
    await openGuide();
    fireEvent.click(screen.getByRole("button", { name: "How do I play?" }));
    expect((await screen.findByRole("status")).textContent).toBe("The guide is resting until tomorrow.");
  });

  it("in a round, says it won't give the answer, and closes with Escape giving focus back", async () => {
    await openGuide({ kind: "round", card_id: "abc123-0", mystery: true });
    expect(screen.getByText(/I won't give the answer or a range; that part is yours\./)).toBeTruthy();
    expect(document.querySelector(".app-shell-content")!.hasAttribute("inert")).toBe(true);
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open the guide, an AI, not a person" }));
  });

  it("stays still under reduced motion", async () => {
    document.documentElement.setAttribute("data-motion", "reduced");
    m.askGuide.mockImplementation(async (_p, _q, _h, onEvent: (e: GuideEvent) => void) => {
      onEvent({ type: "done", outcome: "answered", left: null });
    });
    const dialog = await openGuide();
    fireEvent.click(screen.getByRole("button", { name: "How do I play?" }));
    await waitFor(() => expect(m.askGuide).toHaveBeenCalled());
    expect(dialog.querySelector(".ai-guide-pose")!.className.trim()).toBe("ai-guide-pose");
  });

  it("starts a new conversation on a new page", async () => {
    m.askGuide.mockImplementation(async (_p, _q, _h, onEvent: (e: GuideEvent) => void) => {
      onEvent({ type: "text", text: "Reply one." });
      onEvent({ type: "done", outcome: "answered", left: null });
    });
    const { rerender } = render(<AiGuide user={user} page={HOME} />);
    fireEvent.click(await screen.findByRole("button", { name: /Open the guide/ }));
    fireEvent.click(screen.getByRole("button", { name: "How do I play?" }));
    await screen.findByText("Reply one.");
    rerender(<AiGuide user={user} page={{ kind: "research" }} />);
    expect(screen.queryByText("Reply one.")).toBeNull();
  });
});

describe("AI guide in answers mode (no AI)", () => {
  it("doesn't call itself an AI", async () => {
    m.fetchGuideStatus.mockResolvedValue({ available: true, engine: "answers", reason: null, message: null, left: null });
    render(<AiGuide user={user} page={HOME} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open the guide" }));
    const dialog = screen.getByRole("dialog", { name: "Guide" });
    expect(dialog.querySelector(".ai-guide-says")!.textContent).toMatch(/^Hello\. I'm Stackly's guide, not a person\. I answer from Stackly's own pages/);
    expect(screen.getByText("Answers from Stackly's own pages")).toBeTruthy();
    expect(dialog.textContent).not.toMatch(/\bAI\b/);
  });
});

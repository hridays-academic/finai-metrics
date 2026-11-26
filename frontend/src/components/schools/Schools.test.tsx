// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserPublic } from "../../lib/types";

vi.mock("../../lib/api", () => {
  class ApiError extends Error {
    constructor(message: string, public status = 400) {
      super(message);
    }
  }
  return {
    ApiError, fetchConsentPage: vi.fn(), answerConsent: vi.fn(), fetchClasses: vi.fn(), joinClass: vi.fn(),
    createClass: vi.fn(), requestConsent: vi.fn(), fetchClassStudents: vi.fn(), fetchClassBoard: vi.fn(),
    fetchCurrentSession: vi.fn(), markPaperForm: vi.fn(), startSession: vi.fn(),
    fetchConsentOptions: vi.fn(() => Promise.resolve({ email: false })),
  };
});
vi.mock("../SiteFooter", () => ({ default: () => null }));

import * as api from "../../lib/api";
import ClassesPage from "./ClassesPage";
import ConsentPage from "./ConsentPage";

const m = vi.mocked(api);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Parent approval page", () => {
  it("shows the approved text and needs a name to approve", async () => {
    m.fetchConsentPage.mockResolvedValue({ handle: "Ravi_12", expires_at: "2026-12-09T00:00:00Z" });
    m.answerConsent.mockResolvedValue(undefined);
    const token = "t".repeat(40);
    render(<ConsentPage token={token} />);
    expect(await screen.findByText(/Your child, Ravi_12, wants to use Stackly/)).toBeTruthy();
    expect(screen.getByText(/stored with Neon .* in the United States/)).toBeTruthy();
    expect(screen.queryByText(/tutor/i)).toBeNull();
    expect(document.body.textContent).not.toMatch(/verif/i);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("Please type your name to approve.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "S. Kumar" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(m.answerConsent).toHaveBeenCalledWith(token, true, "S. Kumar"));
    expect(await screen.findByText("Thank you. Your child's account is approved.")).toBeTruthy();
  });
});

describe("Classes", () => {
  it("joins with a 6-character code and asks an under-18 to get a parent's approval", async () => {
    m.fetchClasses.mockResolvedValue([]);
    m.joinClass.mockResolvedValue({ id: 4, code: "ABC234", name: "9B", teaching: false, members: 2, show_names: false });
    const user = { id: 1, handle: "Ravi_12", age_band: "under_18", guardian_consent_status: "pending", is_teacher: false } as UserPublic;
    render(<ClassesPage user={user} onOpenAuth={() => {}} />);
    const input = await screen.findByLabelText("Join a class: enter your teacher's 6-character code.");
    fireEvent.change(input, { target: { value: "abc234" } });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await waitFor(() => expect(m.joinClass).toHaveBeenCalledWith("ABC234"));
    expect(screen.getByRole("heading", { name: "Ask a parent to approve" })).toBeTruthy();
    // A11: the paper form leads; with email off there's no email box.
    expect(screen.getByRole("link", { name: "parent approval form" }).getAttribute("href")).toBe("#/consent-form");
    expect(screen.queryByLabelText("Your parent's email")).toBeNull();
    expect(document.body.textContent).not.toMatch(/verif/i);
    expect(screen.queryByRole("button", { name: "Create class" })).toBeNull();
  });
});

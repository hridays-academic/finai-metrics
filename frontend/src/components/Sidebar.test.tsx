// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserPublic } from "../lib/types";

vi.mock("../lib/api", () => {
  class ApiError extends Error {}
  const never = () => new Promise(() => {});
  return {
    ApiError,
    adminListEvents: vi.fn(never), fetchLeagueConfig: vi.fn(never), adminFindUsers: vi.fn(never),
    adminListWorldEvents: vi.fn(never), adminAudit: vi.fn(never), adminJobs: vi.fn(never),
    fetchAdminVisits: vi.fn(never),
  };
});

import * as api from "../lib/api";
import AdminPage from "./AdminPage";
import Sidebar from "./Sidebar";

const user = (is_admin: boolean): UserPublic => ({
  id: 1, email: "a@example.com", name: "A", created_at: "2026-09-01T00:00:00Z", has_password: true, handle: "a",
  age_band: "18_plus", guardian_consent_status: "not_required", school_name: null, is_admin,
  terms_accepted_at: "2026-11-11T00:00:00Z", needs_terms: false,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Admin button in the main navigation", () => {
  it("shows for an admin and opens the admin page", () => {
    const onOpenAdmin = vi.fn();
    render(<Sidebar view="home" onChange={vi.fn()} user={user(true)} onOpenAdmin={onOpenAdmin} />);
    fireEvent.click(screen.getByRole("button", { name: "Admin" }));
    expect(onOpenAdmin).toHaveBeenCalled();
  });

  it("marks itself current on the admin page", () => {
    render(<Sidebar view={null} onChange={vi.fn()} user={user(true)} adminActive onOpenAdmin={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Admin" }).getAttribute("aria-current")).toBe("true");
  });

  it.each([
    ["a normal account", user(false)],
    ["a signed-out visitor", null],
  ])("is absent for %s, leaving the navigation unchanged", (_label, who) => {
    const { container } = render(<Sidebar view="home" onChange={vi.fn()} user={who} onOpenAdmin={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Admin" })).toBeNull();
    expect(container.textContent).not.toMatch(/admin/i);
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Home", "Research"]);
  });
});

describe("Admin page for visitors who aren't admins", () => {
  const adminCalls = () =>
    Object.entries(vi.mocked(api)).filter(([k, f]) => k.startsWith("admin") && vi.isMockFunction(f) && f.mock.calls.length);

  it("shows the administrators-only message and fetches no admin data", () => {
    render(<AdminPage user={user(false)} onOpenAuth={vi.fn()} />);
    expect(screen.getByText("This page is for administrators only.")).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(adminCalls()).toEqual([]);
  });

  it("asks a signed-out visitor to sign in and fetches no admin data", () => {
    render(<AdminPage user={null} onOpenAuth={vi.fn()} />);
    expect(screen.getByText("Sign in with an administrator account to see this page.")).toBeTruthy();
    expect(adminCalls()).toEqual([]);
  });

  it("loads the Companies board for an admin", () => {
    render(<AdminPage user={user(true)} onOpenAuth={vi.fn()} />);
    expect(api.adminListEvents).toHaveBeenCalled();
  });
});

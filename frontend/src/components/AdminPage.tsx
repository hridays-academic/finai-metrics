import { useState } from "react";
import type { UserPublic } from "../lib/types";
import AdminCompanies from "./admin/AdminCompanies";
import AdminMore from "./admin/AdminMore";
import AdminUsers from "./admin/AdminUsers";
import AdminWorldEvents from "./admin/AdminWorldEvents";
import SiteFooter from "./SiteFooter";

interface AdminPageProps {
  user: UserPublic | null;
  onOpenAuth: () => void;
}

// Built around four jobs (2026-10): add a company, enter numbers, score
// (placeholder until scoring exists) -- all on Companies -- and approve
// students. Visits and the audit log sit under More.
const TABS = [
  { key: "companies", label: "Companies", Component: AdminCompanies },
  { key: "students", label: "Students", Component: AdminUsers },
  { key: "world", label: "World events", Component: AdminWorldEvents },
  { key: "more", label: "More", Component: AdminMore },
] as const;

// Reached at #/admin. The server enforces access (ADMIN_EMAILS); the checks
// here only decide what to render. Uses existing styles -- the design pass
// is deferred (see CLAUDE.md).
export default function AdminPage({ user, onOpenAuth }: AdminPageProps) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("companies");
  const Active = TABS.find((t) => t.key === tab)!.Component;

  return (
    <div className="page page-wide">
      <header className="page-header glass page-hero">
        <h1 className="page-title">Admin</h1>
      </header>
      {!user && (
        <section className="section glass panel">
          <p className="section-text">Sign in with an administrator account to see this page.</p>
          <button type="button" className="btn btn-primary" onClick={onOpenAuth}>
            Sign in
          </button>
        </section>
      )}
      {user && !user.is_admin && <p className="section-text">This page is for administrators only.</p>}
      {user?.is_admin && (
        <section className="glass panel admin-panel-wrap">
          <div className="segmented admin-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                type="button"
                role="tab"
                key={t.key}
                aria-selected={tab === t.key}
                className={tab === t.key ? "active" : ""}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <Active />
        </section>
      )}
      <SiteFooter />
    </div>
  );
}

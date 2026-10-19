import { useState } from "react";
import type { UserPublic } from "../lib/types";
import AdminCompanies from "./admin/AdminCompanies";
import AdminMore from "./admin/AdminMore";
import AdminUsers from "./admin/AdminUsers";
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
  { key: "more", label: "More", Component: AdminMore },
] as const;

// Reached at #/admin. The server enforces access (ADMIN_EMAILS); the checks
// here only decide what to render. Uses existing styles -- the design pass
// is deferred (see CLAUDE.md).
export default function AdminPage({ user, onOpenAuth }: AdminPageProps) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("companies");
  const Active = TABS.find((t) => t.key === tab)!.Component;

  return (
    <div className="calculator-page">
      <div className="calculator-card trading-card">
        <h2>Admin</h2>
        {!user && (
          <div className="calculator-empty-hint">
            <p>Sign in with an administrator account to see this page.</p>
            <button type="button" className="search-button" onClick={onOpenAuth}>
              Sign in
            </button>
          </div>
        )}
        {user && !user.is_admin && <div className="calculator-empty-hint">This page is for administrators only.</div>}
        {user?.is_admin && (
          <>
            <div className="calculator-mode-toggle admin-tabs" role="tablist">
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
          </>
        )}
        <SiteFooter />
      </div>
    </div>
  );
}

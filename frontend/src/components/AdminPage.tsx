import { useState } from "react";
import type { UserPublic } from "../lib/types";
import AdminActuals from "./admin/AdminActuals";
import AdminAudit from "./admin/AdminAudit";
import AdminEvents from "./admin/AdminEvents";
import AdminUsers from "./admin/AdminUsers";
import AdminVisits from "./admin/AdminVisits";

interface AdminPageProps {
  user: UserPublic | null;
  onOpenAuth: () => void;
}

const TABS = [
  { key: "events", label: "Events", Component: AdminEvents },
  { key: "actuals", label: "Results", Component: AdminActuals },
  { key: "users", label: "Players", Component: AdminUsers },
  { key: "visits", label: "Visits", Component: AdminVisits },
  { key: "audit", label: "Audit log", Component: AdminAudit },
] as const;

// Reached at #/admin. The server enforces access (ADMIN_EMAILS); the checks
// here only decide what to render. Uses existing styles -- the design pass
// is deferred (see CLAUDE.md).
export default function AdminPage({ user, onOpenAuth }: AdminPageProps) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("events");
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
      </div>
    </div>
  );
}

import AdminAudit from "./AdminAudit";
import AdminVisits from "./AdminVisits";

// Rarely needed tools, collapsed so they don't crowd the main jobs.
export default function AdminMore() {
  return (
    <div className="admin-more">
      <details className="admin-more-section">
        <summary>Visit counts</summary>
        <AdminVisits />
      </details>
      <details className="admin-more-section">
        <summary>Audit log</summary>
        <AdminAudit />
      </details>
    </div>
  );
}

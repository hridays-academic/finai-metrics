import AdminAudit from "./AdminAudit";
import AdminJobs from "./AdminJobs";
import AdminVisits from "./AdminVisits";
import { AdminErrors, AdminFeedback, AdminNumbers } from "./AdminReports";

// Rarely needed tools, collapsed so they don't crowd the main jobs.
export default function AdminMore() {
  return (
    <div className="admin-more">
      <details className="admin-more-section" open>
        <summary>Numbers (by week)</summary>
        <AdminNumbers />
      </details>
      <details className="admin-more-section">
        <summary>Messages ("Something wrong? Tell us")</summary>
        <AdminFeedback />
      </details>
      <details className="admin-more-section">
        <summary>Error reports (last 100)</summary>
        <AdminErrors />
      </details>
      <details className="admin-more-section">
        <summary>Visit counts</summary>
        <AdminVisits />
      </details>
      <details className="admin-more-section">
        <summary>Data jobs</summary>
        <AdminJobs />
      </details>
      <details className="admin-more-section">
        <summary>Audit log</summary>
        <AdminAudit />
      </details>
    </div>
  );
}

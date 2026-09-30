import { useEffect, useState } from "react";
import { adminAudit, ApiError } from "../../lib/api";
import type { AuditEntry } from "../../lib/types";
import { formatIst } from "../league/LockCountdown";

export default function AdminAudit() {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminAudit(200)
      .then(setRows)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load the audit log."));
  }, []);

  return (
    <div>
      <p className="calculator-subtitle">Every create, update, lock and score action, newest first.</p>
      {error && <div className="search-error">{error}</div>}
      {rows && rows.length === 0 && <div className="calculator-empty-hint">Nothing recorded yet.</div>}
      {rows && rows.length > 0 && (
        <div className="trading-table-wrap">
          <table className="trading-holdings-table">
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>Action</th>
                <th>What</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{formatIst(r.at)}</td>
                  <td>{r.actor_user_id ?? "--"}</td>
                  <td>{r.action}</td>
                  <td>
                    {r.entity} {r.entity_id}
                  </td>
                  <td className="admin-audit-details">{r.details ? JSON.stringify(r.details) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

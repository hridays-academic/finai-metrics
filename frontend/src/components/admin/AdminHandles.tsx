import { useEffect, useState } from "react";
import { adminHandlesForReview, adminPaperForms, adminSetHandleStatus, ApiError } from "../../lib/api";
import { formatDay } from "../../lib/leagueFormat";

// Phase 6 (SC9): handles under review or blocked are hidden from leaderboards
// until an admin approves them. Admin-only wording.
// Phase 8 (SC4): paper forms a teacher marked received, for an admin to
// confirm with "Record consent" below. Admin-only wording.
export function PaperForms() {
  const [rows, setRows] = useState<{ user_id: number; handle: string | null; class_name: string; received_at: string }[] | null>(null);
  useEffect(() => {
    adminPaperForms().then(setRows).catch(() => setRows([]));
  }, []);
  if (!rows || rows.length === 0) return null;
  return (
    <section className="admin-section" aria-labelledby="paper-title">
      <h3 id="paper-title">Paper forms to confirm</h3>
      <ul>
        {rows.map((r) => (
          <li key={r.user_id}>
            {r.handle ?? "(no handle)"}, {r.class_name}: received {formatDay(r.received_at, true)}. Search for them below and press Record consent.
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function AdminHandles() {
  const [rows, setRows] = useState<{ user_id: number; handle: string; handle_status: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    adminHandlesForReview()
      .then(setRows)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load handles."));
  useEffect(() => {
    load();
  }, []);
  const set = (id: number, status: "ok" | "review" | "blocked") =>
    adminSetHandleStatus(id, status)
      .then(load)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't save."));
  return (
    <section className="admin-section" aria-labelledby="handles-title">
      <h3 id="handles-title">Handles to check</h3>
      {error && <div className="form-error">{error}</div>}
      {rows?.length === 0 && <p className="empty-note">No handles are waiting.</p>}
      {rows && rows.length > 0 && (
        <ul className="review-list">
          {rows.map((r) => (
            <li key={r.user_id} className="admin-inline-actions">
              <strong>{r.handle}</strong> ({r.handle_status === "blocked" ? "blocked" : "under review"})
              <button type="button" className="btn btn-secondary" onClick={() => set(r.user_id, "ok")}>
                Approve
              </button>
              {r.handle_status !== "blocked" && (
                <button type="button" className="btn btn-tertiary" onClick={() => set(r.user_id, "blocked")}>
                  Block
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

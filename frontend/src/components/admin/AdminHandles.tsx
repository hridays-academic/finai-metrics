import { useEffect, useState } from "react";
import { adminHandlesForReview, adminSetHandleStatus, ApiError } from "../../lib/api";

// Phase 6 (SC9): handles under review or blocked are hidden from leaderboards
// until an admin approves them. Admin-only wording.
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

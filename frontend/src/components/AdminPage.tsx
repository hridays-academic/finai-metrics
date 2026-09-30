import { useEffect, useState } from "react";
import { ApiError, fetchAdminVisits, type DailyVisits } from "../lib/api";
import type { UserPublic } from "../lib/types";

interface AdminPageProps {
  user: UserPublic | null;
  onOpenAuth: () => void;
}

const DAYS = 30;

// Reached at #/admin. Only administrators (ADMIN_EMAILS on the backend) get
// data; everyone else sees why not. Phase 2 adds the league admin tools here.
// Uses the existing calculator/trading card and table styles on purpose --
// the design pass is deferred (see CLAUDE.md).
export default function AdminPage({ user, onOpenAuth }: AdminPageProps) {
  const [rows, setRows] = useState<DailyVisits[] | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    fetchAdminVisits(DAYS)
      .then((res) => {
        if (!cancelled) setRows(res.rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? { status: err.status, message: err.message }
              : { status: 0, message: "Couldn't load visit counts." }
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const totals = new Map<string, number>();
  for (const r of rows ?? []) totals.set(r.page, (totals.get(r.page) ?? 0) + r.count);
  const sortedTotals = [...totals.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="calculator-page">
      <div className="calculator-card trading-card">
        <h2>Admin</h2>
        <p className="calculator-subtitle">
          Page loads per day for the last {DAYS} days (India time). Counts only: no cookies, IP
          addresses or user information are recorded.
        </p>

        {error?.status === 401 && (
          <div className="calculator-empty-hint">
            <p>Sign in with an administrator account to see this page.</p>
            <button type="button" className="search-button" onClick={onOpenAuth}>
              Sign in
            </button>
          </div>
        )}
        {error && error.status !== 401 && <div className="search-error">{error.message}</div>}
        {!error && rows === null && <div className="calculator-empty-hint">Loading...</div>}
        {rows && rows.length === 0 && <div className="calculator-empty-hint">No page loads recorded yet.</div>}

        {rows && rows.length > 0 && (
          <>
            <div className="trading-section-header">Totals</div>
            <div className="trading-table-wrap">
              <table className="trading-holdings-table">
                <thead>
                  <tr>
                    <th>Page</th>
                    <th>Loads</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTotals.map(([page, count]) => (
                    <tr key={page}>
                      <td>{page}</td>
                      <td>{count.toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="trading-section-header">By day</div>
            <div className="trading-table-wrap">
              <table className="trading-holdings-table">
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>Page</th>
                    <th>Loads</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.day}-${r.page}`}>
                      <td>{r.day}</td>
                      <td>{r.page}</td>
                      <td>{r.count.toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

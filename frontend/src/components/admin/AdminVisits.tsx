import { useEffect, useState } from "react";
import { ApiError, fetchAdminVisits, type DailyVisits } from "../../lib/api";

const DAYS = 30;

// Aggregate page loads per day (see backend services/visits.py).
export default function AdminVisits() {
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
  }, []);

  const totals = new Map<string, number>();
  for (const r of rows ?? []) totals.set(r.page, (totals.get(r.page) ?? 0) + r.count);
  const sortedTotals = [...totals.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div>
      <p className="section-text">
        Page loads per day for the last {DAYS} days (India time). Counts only: no cookies, IP addresses or user
        information are recorded.
      </p>
        {error && <div className="form-error">{error.message}</div>}
        {!error && rows === null && <div className="empty-note">Loading...</div>}
        {rows && rows.length === 0 && <div className="empty-note">No page loads recorded yet.</div>}

        {rows && rows.length > 0 && (
          <>
            <div className="subsection-title">Totals</div>
            <div className="table-wrap">
              <table className="data-table">
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

            <div className="subsection-title">By day</div>
            <div className="table-wrap">
              <table className="data-table">
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
  );
}

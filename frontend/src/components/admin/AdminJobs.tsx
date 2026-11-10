import { useEffect, useState } from "react";
import { ApiError, adminJobs, type JobRun } from "../../lib/api";

const NAMES: Record<string, string> = {
  gdelt: "News headlines (GDELT files, hourly)",
  nse: "NSE filings (every 15 min, Mon-Sat)",
  rbi: "RBI press releases (every 6 hours)",
  macro: "Macro series (daily)",
};

const STORED: Record<string, string> = {
  gdelt: "headlines",
  nse: "filings",
  rbi: "releases",
  macro: "series",
};

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST" : "Never";
}

// The scheduled data jobs: last success, last error and how much they hold.
// last_error is cleared by the next successful run.
export default function AdminJobs() {
  const [jobs, setJobs] = useState<JobRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    adminJobs()
      .then(setJobs)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load job status."));
  }, []);
  if (error) return <div className="form-error">{error}</div>;
  if (!jobs) return <p className="empty-note">Loading...</p>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Job</th>
            <th>Last success</th>
            <th>Last error</th>
            <th>Added last run</th>
            <th>Stored now</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.job}>
              <td>{NAMES[j.job] ?? j.job}</td>
              <td>{when(j.last_ok_at)}</td>
              <td>{j.last_error ? `${j.last_error} (${when(j.last_run_at)})` : "None"}</td>
              <td>{j.last_items ?? "N/A"}</td>
              <td>
                {j.stored} {STORED[j.job] ?? "items"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import { useEffect, useState } from "react";
import { ApiError, adminJobs, type JobRun } from "../../lib/api";

const NAMES: Record<string, string> = {
  gdelt: "News headlines (GDELT, hourly)",
  nse: "NSE filings (every 15 min, Mon-Sat)",
  rbi: "RBI press releases (every 6 hours)",
  macro: "Macro charts (daily)",
};

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST" : "Never";
}

// The scheduled news jobs: last run, last success and last error.
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
  if (jobs.length === 0) return <p className="empty-note">No scheduled job has run yet.</p>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Job</th>
            <th>Last run</th>
            <th>Last success</th>
            <th>Last error</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.job}>
              <td>{NAMES[j.job] ?? j.job}</td>
              <td>{when(j.last_run_at)}</td>
              <td>{when(j.last_ok_at)}</td>
              <td>{j.last_error ?? "None"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

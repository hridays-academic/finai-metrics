import { type ReactNode, useEffect, useState } from "react";
import { ApiError, adminErrors, adminFeedback, adminNumbers, type ErrorReport, type FeedbackItem, type WeekNumbers } from "../../lib/api";

// Phase 2 (master plan): weekly numbers (counts only, option a), the last
// 100 error reports and the "Something wrong? Tell us" inbox.
function useLoad<T>(load: () => Promise<T>): [T | null, string | null] {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    load()
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load."));
  }, [load]);
  return [data, error];
}

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
const pct = (v: number | null) => (v === null ? "N/A" : `${v}%`);

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdminNumbers() {
  const [weeks, error] = useLoad<WeekNumbers[]>(adminNumbers);
  if (error) return <div className="form-error">{error}</div>;
  if (!weeks) return <p className="empty-note">Loading...</p>;
  return (
    <Table
      head={["Week of", "Page loads", "Guide finished", "Rounds", "Rounds per load", "Returning students", "Forecasts", "Improved"]}
      rows={weeks.map((w) => [w.week, w.visits, pct(w.guide_completion_pct), w.rounds_submitted, w.rounds_per_visit ?? "N/A", w.returning_students, w.forecasts_submitted, w.students_improved])}
    />
  );
}

export function AdminErrors() {
  const [items, error] = useLoad<ErrorReport[]>(adminErrors);
  if (error) return <div className="form-error">{error}</div>;
  if (!items) return <p className="empty-note">Loading...</p>;
  if (items.length === 0) return <p className="empty-note">No errors reported.</p>;
  return <Table head={["When (IST)", "Where", "Page", "Build", "Message"]} rows={items.map((e) => [when(e.created_at), e.source, e.page, e.build, e.message])} />;
}

export function AdminFeedback() {
  const [items, error] = useLoad<FeedbackItem[]>(adminFeedback);
  if (error) return <div className="form-error">{error}</div>;
  if (!items) return <p className="empty-note">Loading...</p>;
  if (items.length === 0) return <p className="empty-note">No messages yet.</p>;
  return <Table head={["When (IST)", "Page", "Message", "Email"]} rows={items.map((f) => [when(f.created_at), f.page, f.message, f.email ?? ""])} />;
}

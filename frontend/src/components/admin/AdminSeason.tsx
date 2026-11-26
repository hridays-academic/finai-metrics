import { useEffect, useState } from "react";
import { adminListEvents, adminListOlderResults, ApiError } from "../../lib/api";
import { formatDay } from "../../lib/leagueFormat";
import type { AdminBoardRow } from "../../lib/types";

// Phase 8 (O1, O4): the season at a glance. Per season, each company's
// results date and checklist: last year entered, research notes written,
// practice quarters approved (Older results), results proposal ready, opened,
// scored. Research arrives as proposal files for batch approval. Admin-only
// wording.

const tick = (ok: boolean) => (ok ? "Yes" : "Not yet");

export default function AdminSeason() {
  const [rows, setRows] = useState<AdminBoardRow[] | null>(null);
  const [practice, setPractice] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    adminListEvents()
      .then(setRows)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load the season."));
    adminListOlderResults()
      .then((cs) =>
        setPractice(
          Object.fromEntries(
            cs.map((c) => {
              const q = c.quarters.filter((x) => x.use === "practice");
              return [c.ticker, `${q.filter((x) => x.status === "saved").length} of ${q.length}`];
            })
          )
        )
      )
      .catch(() => setPractice({}));
  }, []);
  const seasons = rows ? [...new Set(rows.map((r) => r.season_label))] : [];
  return (
    <div className="admin-section">
      <p className="field-hint">Each company's checklist for the season. Results and older quarters come as proposal files for you to approve.</p>
      {error && <div className="form-error">{error}</div>}
      {seasons.map((season) => (
        <section key={season} aria-label={season}>
          <h3>{season}</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col">Results</th>
                  <th scope="col">Last year entered</th>
                  <th scope="col">Research notes</th>
                  <th scope="col">Practice quarters approved</th>
                  <th scope="col">Results proposal</th>
                  <th scope="col">Opened</th>
                  <th scope="col">Scored</th>
                </tr>
              </thead>
              <tbody>
                {rows!
                  .filter((r) => r.season_label === season)
                  .map((r) => (
                    <tr key={r.id}>
                      <th scope="row">{r.company_name}</th>
                      <td>{formatDay(r.results_date, true)}</td>
                      <td>{tick(r.missing_last_year.length === 0)}</td>
                      <td>{tick(Boolean(r.research_notes?.trim()))}</td>
                      <td>{practice[r.ticker] ?? "None proposed"}</td>
                      <td>{r.raw_status === "scored" ? "Done" : tick(r.has_proposal)}</td>
                      <td>{tick(r.raw_status !== "draft")}</td>
                      <td>{tick(r.raw_status === "scored")}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

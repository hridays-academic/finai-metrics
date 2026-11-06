import { FormEvent, Fragment, useEffect, useState } from "react";
import { adminFindUsers, adminSetConsent, ApiError, type ConsentDetails } from "../../lib/api";
import { formatDay } from "../../lib/leagueFormat";
import { todayInIndia } from "../../lib/marketHolidays";
import type { AdminUser } from "../../lib/types";

// Guardian consent for under-18 players: who gave it (the parent's name),
// how (signed form or an email from the parent) and the date (2026-11).
// TODO(legal): a record-keeping placeholder, not a verified legal consent
// process, and nothing in the app may claim otherwise.

const METHOD_LABEL: Record<ConsentDetails["method"], string> = {
  signed_form: "signed form",
  parent_email: "parent email",
};

function consentSummary(u: AdminUser): string {
  if (u.age_band !== "under_18") return "not needed";
  if (u.guardian_consent_status !== "granted") return u.guardian_consent_status ?? "pending";
  const parts = ["granted"];
  if (u.guardian_consent_by) parts.push(`by ${u.guardian_consent_by}`);
  if (u.guardian_consent_method) parts.push(METHOD_LABEL[u.guardian_consent_method]);
  if (u.guardian_consent_date) parts.push(formatDay(u.guardian_consent_date, true));
  return parts.join(", ");
}
export default function AdminUsers() {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The row whose consent details are being entered, and the form fields.
  const [recording, setRecording] = useState<number | null>(null);
  const [details, setDetails] = useState<ConsentDetails>({ parent_name: "", method: "signed_form", consent_date: "" });
  const [saving, setSaving] = useState(false);

  const search = (query: string) =>
    adminFindUsers(query)
      .then(setUsers)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load users."));

  useEffect(() => {
    search("");
  }, []);

  function startRecording(u: AdminUser) {
    setError(null);
    setDetails({ parent_name: "", method: "signed_form", consent_date: todayInIndia().dateStr });
    setRecording(u.id);
  }

  async function setConsent(u: AdminUser, status: "pending" | "granted", consent?: ConsentDetails) {
    setError(null);
    setSaving(true);
    try {
      await adminSetConsent(u.id, status, consent);
      setRecording(null);
      search(q);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't update consent.");
    } finally {
      setSaving(false);
    }
  }

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    search(q);
  }

  return (
    <div>
      <p className="section-text">
        Students under 18 can't submit forecasts until a parent or guardian has consented, by signed form or by
        email from the parent. Record it here with the parent's name and the date. Pending students are listed first.
      </p>
      <form className="inline-form" onSubmit={handleSearch}>
        <input
          className="input"
          placeholder="Search email, handle or name"
          aria-label="Search students"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
      </form>
      {error && <div className="form-error">{error}</div>}
      {users && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>School</th>
                <th>Age group</th>
                <th>Guardian consent</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <Fragment key={u.id}>
                <tr>
                  <td>
                    <div className="cell-primary">{u.handle ?? "(no handle yet)"}</div>
                    <div className="cell-secondary">{u.email}</div>
                  </td>
                  <td>{u.school_name ?? "N/A"}</td>
                  <td>{u.age_band === "under_18" ? "Under 18" : u.age_band === "18_plus" ? "18+" : "Not set"}</td>
                  <td>{consentSummary(u)}</td>
                  <td>
                    {u.age_band === "under_18" &&
                      (u.guardian_consent_status === "granted" ? (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={saving}
                          onClick={() => setConsent(u, "pending")}
                        >
                          Undo
                        </button>
                      ) : (
                        recording !== u.id && (
                          <button type="button" className="btn btn-secondary" onClick={() => startRecording(u)}>
                            Record consent
                          </button>
                        )
                      ))}
                  </td>
                </tr>
                {recording === u.id && (
                  <tr>
                    <td colSpan={5}>
                      <form
                        className="consent-form"
                        onSubmit={(e) => {
                          e.preventDefault();
                          setConsent(u, "granted", details);
                        }}
                      >
                        <label className="field">
                          <span className="field-label">Parent or guardian's name</span>
                          <input
                            className="input"
                            value={details.parent_name}
                            maxLength={80}
                            onChange={(e) => setDetails({ ...details, parent_name: e.target.value })}
                            required
                            autoFocus
                          />
                        </label>
                        <label className="field">
                          <span className="field-label">How consent was given</span>
                          <select
                            className="input"
                            value={details.method}
                            onChange={(e) =>
                              setDetails({ ...details, method: e.target.value as ConsentDetails["method"] })
                            }
                          >
                            <option value="signed_form">Signed form</option>
                            <option value="parent_email">Email from the parent</option>
                          </select>
                        </label>
                        <label className="field">
                          <span className="field-label">Date given</span>
                          <input
                            className="input"
                            type="date"
                            value={details.consent_date}
                            max={todayInIndia().dateStr}
                            onChange={(e) => setDetails({ ...details, consent_date: e.target.value })}
                            required
                          />
                        </label>
                        <div className="button-row">
                          <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={saving || !details.parent_name.trim()}
                            aria-busy={saving}
                          >
                            {saving ? "Saving..." : "Save consent"}
                          </button>
                          <button type="button" className="btn btn-tertiary" onClick={() => setRecording(null)}>
                            Cancel
                          </button>
                        </div>
                      </form>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

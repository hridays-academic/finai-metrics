import { FormEvent, useEffect, useState } from "react";
import { adminFindUsers, adminSetConsent, ApiError } from "../../lib/api";
import type { AdminUser } from "../../lib/types";

// Guardian consent for under-18 players. TODO(legal): this only records that
// the school's signed consent form was received; it is a record-keeping
// placeholder, not a verified legal consent process, and nothing in the app
// may claim otherwise.
export default function AdminUsers() {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = (query: string) =>
    adminFindUsers(query)
      .then(setUsers)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load users."));

  useEffect(() => {
    search("");
  }, []);

  async function setConsent(u: AdminUser, status: "pending" | "granted") {
    setError(null);
    try {
      await adminSetConsent(u.id, status);
      search(q);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't update consent.");
    }
  }

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    search(q);
  }

  return (
    <div>
      <p className="calculator-subtitle">
        Players under 18 can't submit forecasts until their school's signed guardian consent form has been received.
        Mark it here once you have the form. Pending players are listed first.
      </p>
      <form className="calculator-stock-form" onSubmit={handleSearch}>
        <input placeholder="Search email, handle or name" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit">Search</button>
      </form>
      {error && <div className="search-error">{error}</div>}
      {users && (
        <div className="trading-table-wrap">
          <table className="trading-holdings-table">
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
                <tr key={u.id}>
                  <td>
                    <div className="trading-table-stock-name">{u.handle ?? "(no handle yet)"}</div>
                    <div className="trading-table-stock-ticker">{u.email}</div>
                  </td>
                  <td>{u.school_name ?? "--"}</td>
                  <td>{u.age_band === "under_18" ? "Under 18" : u.age_band === "18_plus" ? "18+" : "--"}</td>
                  <td>{u.age_band === "under_18" ? u.guardian_consent_status : "not needed"}</td>
                  <td>
                    {u.age_band === "under_18" &&
                      (u.guardian_consent_status === "granted" ? (
                        <button type="button" className="settings-row-action" onClick={() => setConsent(u, "pending")}>
                          Undo
                        </button>
                      ) : (
                        <button type="button" className="settings-row-action" onClick={() => setConsent(u, "granted")}>
                          Mark form received
                        </button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

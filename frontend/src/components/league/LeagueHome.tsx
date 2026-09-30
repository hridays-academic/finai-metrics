import { useEffect, useState } from "react";
import { ApiError, fetchLeagueEvents } from "../../lib/api";
import { navigate } from "../../lib/router";
import type { EventSummary, UserPublic } from "../../lib/types";
import LockCountdown from "./LockCountdown";

interface LeagueHomeProps {
  user: UserPublic | null;
  onOpenAuth: () => void;
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function EventRow({ e }: { e: EventSummary }) {
  const status =
    e.status === "open" ? (e.submitted ? "Submitted" : "Not yet") : e.submitted ? "Locked (submitted)" : "Locked";
  return (
    <tr className="trading-holdings-row" onClick={() => navigate(`#/event/${e.id}`)}>
      <td>
        <div className="trading-table-stock-name">{e.company.name}</div>
        <div className="trading-table-stock-ticker">
          {e.company.ticker} · {e.season_label}
        </div>
      </td>
      <td>{formatDate(e.results_date)}</td>
      <td>
        <LockCountdown lockAt={e.lock_at} compact />
      </td>
      <td className={e.submitted ? "league-submitted" : ""}>{status}</td>
    </tr>
  );
}

export default function LeagueHome({ user, onOpenAuth }: LeagueHomeProps) {
  const [upcoming, setUpcoming] = useState<EventSummary[] | null>(null);
  const [scored, setScored] = useState<EventSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchLeagueEvents("upcoming"), fetchLeagueEvents("scored")])
      .then(([u, s]) => {
        if (!cancelled) {
          setUpcoming(u);
          setScored(s);
        }
      })
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Couldn't load events."));
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  return (
    <div className="calculator-page">
      <div className="calculator-card trading-card">
        <h2>Results League</h2>
        <p className="calculator-subtitle">
          Forecast the business, not the stock. Before a company reports its quarterly results, give a range
          you're 80% sure of for a few numbers. Forecasts lock before the announcement, then get scored.
        </p>
        {!user && (
          <div className="calculator-field-note">
            You can browse without an account.{" "}
            <button type="button" className="auth-forgot-link" onClick={onOpenAuth}>
              Sign in
            </button>{" "}
            to make forecasts.
          </div>
        )}
        {error && <div className="search-error">{error}</div>}

        <div className="trading-section-header">Upcoming results</div>
        {upcoming === null && !error && <div className="calculator-empty-hint">Loading...</div>}
        {upcoming && upcoming.length === 0 && (
          <div className="calculator-empty-hint">No events are open yet. Check back when results season starts.</div>
        )}
        {upcoming && upcoming.length > 0 && (
          <div className="trading-table-wrap">
            <table className="trading-holdings-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Results expected</th>
                  <th>Lock</th>
                  <th>Your forecast</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((e) => (
                  <EventRow key={e.id} e={e} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="trading-section-header">Recently scored</div>
        {scored && scored.length === 0 && (
          <div className="calculator-empty-hint">No results have been scored yet.</div>
        )}
        {scored && scored.length > 0 && (
          <div className="trading-table-wrap">
            <table className="trading-holdings-table">
              <tbody>
                {scored.map((e) => (
                  <EventRow key={e.id} e={e} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

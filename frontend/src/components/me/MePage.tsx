import { useEffect, useState } from "react";
import { ApiError, fetchProgress, type Progress } from "../../lib/api";
import { formatDay } from "../../lib/leagueFormat";
import { n } from "../../lib/scoring";
import type { UserPublic } from "../../lib/types";
import ErrorState from "../ErrorState";
import SiteFooter from "../SiteFooter";
import { HeroWaves } from "../league/CardArt";

// #/me (master plan phase 6: E2, E4, E6, E7, E8, E13, I2, H16; vault: Areas/Phase 6 plan).
// Level and XP, days played, how often your ranges caught the result,
// badges, personal bests, unlocks and your forecasts. Levels only: nothing
// here is spent or bought. DRAFT wording beyond 2.37 and 2.38.

const NOT_SAVING: Record<string, string> = {
  consent_pending: "Nothing you play is saved until a parent or guardian agrees.",
  profile_required: "Choose a handle and your age group to start saving your progress.",
  terms_required: "Agree to the Terms to start saving your progress.",
};

const STATUS_TITLE: Record<string, string> = { open: "Open", locked: "Waiting for results", scored: "Scored" };

export default function MePage({ user, onOpenAuth }: { user: UserPublic | null; onOpenAuth: () => void }) {
  const [p, setP] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    fetchProgress()
      .then(setP)
      .catch((e) => setError(e instanceof ApiError ? e.message : "We couldn't load your progress."));
  };
  useEffect(() => {
    if (user) load();
    else setP(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const caught = p && p.ranges > 0 ? Math.round((p.ranges_inside / p.ranges) * 10) : null;
  const span = p ? Math.max(1, p.next_level - p.level_start) : 1;
  return (
    <div className="page me-page">
      <header className="page-hero">
        <HeroWaves />
        <h1 className="hero-title">{user?.handle ?? "Me"}</h1>
        {p && <p className="hero-lede">Level {p.level}</p>}
      </header>

      {!user && (
        <section className="glass panel">
          <p className="section-text">Sign in to see your level, badges and forecasts.</p>
          <button type="button" className="btn btn-primary" onClick={onOpenAuth}>
            Sign in
          </button>
        </section>
      )}
      {error && <ErrorState message={error} onRetry={load} />}
      {user && !p && !error && <div className="skeleton skeleton-panel" aria-busy="true" aria-label="Loading your progress" />}

      {p && (
        <>
          {!p.saving && p.not_saved_reason && NOT_SAVING[p.not_saved_reason] && (
            <p className="section-text me-notice" role="note">
              {NOT_SAVING[p.not_saved_reason]}
            </p>
          )}

          <section className="glass panel me-level" aria-labelledby="me-level-title">
            <h2 className="section-title" id="me-level-title">
              Level {p.level}
            </h2>
            <progress className="me-xp" max={span} value={p.xp - p.level_start} aria-label={`XP towards Level ${p.level + 1}`} />
            <p className="section-text">
              {n(p.xp)} XP. {n(p.next_level - p.xp)} more for Level {p.level + 1}.
            </p>
            <dl className="hero-stats">
              <div>
                <dt>This term</dt>
                <dd>Played {p.days_played_this_term} {p.days_played_this_term === 1 ? "day" : "days"}</dd>
              </div>
              <div>
                <dt>Your ranges</dt>
                <dd>{caught === null ? "Not yet" : `Caught ${caught} of 10 (aim: 8)`}</dd>
              </div>
              <div>
                <dt>Today, from practice and cards</dt>
                <dd>
                  {p.xp_today_capped} of {p.daily_cap} XP
                </dd>
              </div>
            </dl>
            {p.weeks.length > 0 && (
              <div className="me-weeks" aria-label="Cards inside your range, by week">
                {p.weeks.map((w) => (
                  <div key={w.week_start} className="me-week">
                    <span className="me-week-label">Week of {formatDay(w.week_start, false)}</span>
                    <span className="me-week-bar" aria-hidden="true">
                      <span style={{ width: `${(w.hits / Math.max(1, w.cards)) * 100}%` }} />
                      <span className="me-week-aim" />
                    </span>
                    <span className="me-week-value">
                      {w.hits} of {w.cards}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="section" aria-labelledby="me-badges-title">
            <h2 className="section-title" id="me-badges-title">
              Badges
            </h2>
            <ul className="me-badges">
              {p.badges.map((b) => (
                <li key={b.key} className={`me-badge ${b.earned_at ? "is-earned" : ""}`}>
                  <strong>{b.name}</strong>
                  <span>{b.description}</span>
                  <span className="me-badge-state">{b.earned_at ? `Earned ${formatDay(b.earned_at, false)}` : "Not yet"}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="section" aria-labelledby="me-bests-title">
            <h2 className="section-title" id="me-bests-title">
              Personal bests
            </h2>
            <dl className="hero-stats">
              {(
                [
                  ["Quick round", p.bests.quick_round],
                  ["Daily challenge", p.bests.daily_challenge],
                  ["League company", p.bests.league],
                  ["Practice quarter", p.bests.practice],
                ] as const
              ).map(([label, v]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{v === null ? "Not yet" : n(Math.round(v))}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="section" aria-labelledby="me-forecasts-title">
            <h2 className="section-title" id="me-forecasts-title">
              Your forecasts
            </h2>
            {p.forecasts.length === 0 && (
              <p className="section-text">
                No league forecasts yet. <a href="#/">See the companies</a>.
              </p>
            )}
            {(["open", "locked", "scored"] as const).map((status) => {
              const rows = p.forecasts.filter((f) => f.status === status);
              if (!rows.length) return null;
              return (
                <div key={status} className="me-forecast-group">
                  <h3 className="me-group-title">{STATUS_TITLE[status]}</h3>
                  <ul className="group">
                    {rows.map((f) => (
                      <li key={f.event_id}>
                        <a href={status === "scored" ? `#/results/${f.event_id}` : `#/event/${f.event_id}`}>
                          {f.company}, {f.season_label}
                        </a>
                        <span className="me-forecast-meta">
                          {f.score !== null ? `${n(Math.round(f.score))} points` : `Results ${formatDay(f.results_date, false)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>

          <section className="section" aria-labelledby="me-unlocks-title">
            <h2 className="section-title" id="me-unlocks-title">
              Unlocks
            </h2>
            <ul className="me-unlocks">
              {p.unlocks.map((u) => (
                <li key={u.key} className={u.unlocked ? "is-unlocked" : ""}>
                  <span>Level {u.level}</span> {u.name}
                  {u.unlocked ? "" : " (locked)"}
                </li>
              ))}
            </ul>
            <p className="section-text">Choose your ball and slab in Settings.</p>
          </section>

          <div className="quick-end-actions">
            <a className="btn btn-primary" href="#/daily">
              Daily challenge
            </a>
            <a className="btn btn-secondary" href="#/boards">
              Leaderboards
            </a>
          </div>
        </>
      )}
      <SiteFooter />
    </div>
  );
}

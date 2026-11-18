import { useEffect, useState } from "react";
import { ApiError, fetchPracticeCases } from "../../lib/api";
import { mysteryOn, setMystery, surprise } from "../../lib/practice";
import { replaceRoute } from "../../lib/router";
import type { PracticeCard, UserPublic } from "../../lib/types";
import SiteFooter from "../SiteFooter";
import PracticeTile from "./PracticeTile";

// #/practice (2026-11-18, wording approved): pick a past quarter, or let
// "Surprise me" pick one. Mystery mode (on by default, remembered in this
// browser) hides names and dates until you submit. #/practice?surprise=1
// (the guide's "Surprise me") goes straight to a random company.
export default function PracticePage({ user }: { user: UserPublic | null }) {
  const [mystery, setMysteryState] = useState(mysteryOn);
  const [cards, setCards] = useState<PracticeCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchPracticeCases(mystery)
      .then((c) => {
        if (cancelled) return;
        if (window.location.hash.includes("surprise=1")) {
          const pick = surprise(c);
          if (pick) return replaceRoute(`#/practice/${pick.code}`);
        }
        setCards(c);
      })
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Couldn't load practice companies."));
    return () => {
      cancelled = true;
    };
  }, [mystery, user?.id]);

  function toggle() {
    setMystery(!mystery);
    setMysteryState(!mystery);
  }

  function goSurprise() {
    const pick = cards && surprise(cards);
    if (pick) window.location.hash = `#/practice/${pick.code}`;
  }

  return (
    <div className="page practice-page">
      <header className="practice-head">
        <h1 className="page-title">Practice</h1>
        <p className="practice-line">
          Forecast a past quarter. The results are already out, so you get your score straight away.
        </p>
        <div className="practice-controls">
          <label className="practice-switch">
            <input type="checkbox" role="switch" checked={mystery} onChange={toggle} aria-describedby="mystery-hint" />
            <span className="practice-switch-track" aria-hidden="true" />
            <span className="practice-switch-text">
              <span className="practice-switch-label">Mystery mode</span>
              <span className="practice-switch-hint" id="mystery-hint">
                Hides the company's name and dates until you submit.
              </span>
            </span>
          </label>
          <button type="button" className="btn btn-primary" onClick={goSurprise} disabled={!cards?.length}>
            Surprise me
          </button>
        </div>
      </header>
      {error && <div className="form-error">{error}</div>}
      {!cards && !error && <p className="empty-note">Loading...</p>}
      {cards && (
        <ul className="company-grid practice-grid">
          {cards.map((c, i) => (
            <PracticeTile key={c.code} card={c} index={i} />
          ))}
        </ul>
      )}
      <SiteFooter />
    </div>
  );
}

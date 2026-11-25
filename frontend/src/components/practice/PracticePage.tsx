import { useEffect, useState } from "react";
import { HeroWaves } from "../league/CardArt";
import ErrorState from "../ErrorState";
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
const LEVELS: (string | null)[] = [null, "easy", "medium", "hard"];

export default function PracticePage({ user }: { user: UserPublic | null }) {
  const [mystery, setMysteryState] = useState(mysteryOn);
  const [cards, setCards] = useState<PracticeCard[] | null>(null);
  // P3 (master plan): filter by sector and by difficulty.
  const [sector, setSector] = useState<string | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sectors = cards ? Array.from(new Set(cards.map((c) => c.sector_name))) : [];

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
      {/* P5/V12 (master plan): Home's headline style and wave lines, so every
          top-level page shares one headline system. */}
      <header className="practice-head page-hero">
        <HeroWaves />
        <h1 className="hero-title">Practice</h1>
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
            Random company
          </button>
          <a className="btn btn-secondary" href="#/daily">
            Daily challenge
          </a>
        </div>
      </header>
      {error && <ErrorState message={error} />}
      {!cards && !error && <div className="skeleton skeleton-panel" aria-busy="true" aria-label="Loading practice companies" />}
      {cards && (
        <div className="practice-filters" role="group" aria-label="Filter practice companies">
          {/* Wide screens: chips on one row. Phones: two compact selects on one line (Stop 2). */}
          <div className="practice-filter-chips">
            {[null, ...sectors].map((name) => (
              <button key={name ?? "all"} type="button" className={`chip ${sector === name ? "active" : ""}`} aria-pressed={sector === name} onClick={() => setSector(name)}>
                {name ?? "All sectors"}
              </button>
            ))}
            {LEVELS.map((d) => (
              <button key={d ?? "any"} type="button" className={`chip ${level === d ? "active" : ""}`} aria-pressed={level === d} onClick={() => setLevel(d)}>
                {d ? d[0].toUpperCase() + d.slice(1) : "Any difficulty"}
              </button>
            ))}
          </div>
          <div className="practice-filter-selects">
            <label className="filter-select">
              <span>Sector:</span>
              <select value={sector ?? ""} onChange={(e) => setSector(e.target.value || null)}>
                <option value="">All</option>
                {sectors.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-select">
              <span>Difficulty:</span>
              <select value={level ?? ""} onChange={(e) => setLevel(e.target.value || null)}>
                <option value="">Any</option>
                {LEVELS.filter((d): d is string => d !== null).map((d) => (
                  <option key={d} value={d}>
                    {d[0].toUpperCase() + d.slice(1)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}
      {cards && (
        <ul className="company-grid practice-grid">
          {cards
            .filter((c) => (sector === null || c.sector_name === sector) && (level === null || c.difficulty === level))
            .map((c, i) => (
              <PracticeTile key={c.code} card={c} index={i} />
            ))}
        </ul>
      )}
      <SiteFooter />
    </div>
  );
}

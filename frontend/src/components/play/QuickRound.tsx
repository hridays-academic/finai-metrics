import { useEffect, useRef, useState } from "react";
import { ApiError, fetchDaily, fetchPlayCards, type PlayCard, type PlayReveal, revealPlayCard, type RoundResult, submitRound } from "../../lib/api";
import type { UserPublic } from "../../lib/types";
import { mysteryOn } from "../../lib/practice";
import { buildRound, cardPoints, endLine, GOLD_BONUS, type Round } from "../../lib/quickRound";
import { explainMetric } from "../../lib/glossary";
import { slabDomain } from "../../lib/leagueFormat";
import { n } from "../../lib/scoring";
import { getSound, getVibration } from "../../lib/prefs";
import { prefersReducedMotion } from "../../hooks/useOnceVisible";
import { colourClass } from "../../lib/difficulty";
import { recordUsage } from "../../lib/reports";
import RangeSlab, { type Pair } from "../RangeSlab";
import ErrorState from "../ErrorState";
import SiteFooter from "../SiteFooter";
import { HeroWaves } from "../league/CardArt";
import ShareScore from "./ShareScore";

// Quick rounds, #/play (master plan phase 5: E1, E9-E12, E15). One card is
// one number: set a range, submit, see the ball land. Engagement rules D: a
// natural end, no countdowns, combos and a gold card that reward skill, sound
// off by default. Nothing is saved yet (phase 6). Wording approved at Stop 2
// (vault: "Decisions for Hriday (master plan)", phase 5).

const PLAYED_KEY = "stackly_played_quick";
const BEST_KEY = "stackly_best_quick";

// The daily challenge (phase 6): the same ten cards for everyone today.
export const DAILY_CHALLENGE = true;

const HINTS = [
  "Last year's figure is marked on the bar. Start there, then ask what has changed since.",
  "Aim to be right 8 times out of 10. If a result just outside your range would surprise you, it's wide enough.",
  "Narrow ranges score more, but only when the result lands inside.",
];

// Card titles in sentence case, without "(YoY)": the explanation line says it.
export function cardTitle(label: string): string {
  const t = label.replace(/\s*\(YoY\)\s*$/i, "").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function readNumber(key: string): number | null {
  try {
    const v = localStorage.getItem(key);
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}

function write(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    // storage blocked: nothing remembered
  }
}

function feedback(hit: boolean): void {
  if (getVibration()) navigator.vibrate?.(hit ? 18 : [10, 40, 10]);
  if (!getSound()) return;
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = hit ? 660 : 220;
    g.gain.setValueAtTime(0.06, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.2);
  } catch {
    // no audio
  }
}

// The real number counts up from last year (or zero); instant under reduced motion.
function useCountUp(target: number | null, from: number): number | null {
  const [v, setV] = useState<number | null>(null);
  useEffect(() => {
    if (target === null) return setV(null);
    if (prefersReducedMotion()) return setV(target);
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 700);
      const e = 1 - (1 - t) ** 3;
      setV(from + (target - from) * e);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, from]);
  return v;
}

interface Answer {
  card: PlayCard;
  range: Pair;
  reveal: PlayReveal;
  points: number;
  multiplier: number;
}

// Why a finished round wasn't saved (phase 6). DRAFT wording.
const NOT_SAVED: Record<string, string> = {
  signed_out: "Sign in to keep this score.",
  consent_pending: "Nothing is saved until a parent or guardian agrees.",
  profile_required: "Choose a handle and your age group to keep your scores.",
  terms_required: "Agree to the Terms to keep your scores.",
  already_played: "You've already played today's challenge, so this one isn't saved.",
};

export default function QuickRound({ mode = "quick", user = null }: { mode?: "quick" | "daily"; user?: UserPublic | null }) {
  const [round, setRound] = useState<Round | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [range, setRange] = useState<Pair | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [streak, setStreak] = useState(0);
  const startedAt = useRef(Date.now());
  const [best, setBest] = useState<number | null>(() => readNumber(BEST_KEY));
  const [picked, setPicked] = useState<number | null>(null);
  const [saved, setSaved] = useState<RoundResult | null>(null);
  const [dailyDone, setDailyDone] = useState<{ score: number | null; average: number | null } | null>(null);
  const daily = mode === "daily";

  function begin(r: Round) {
    setRound(r);
    setIndex(0);
    setRange(null);
    setAnswers([]);
    setStreak(0);
    setFinished(false);
    setPicked(null);
    setSaved(null);
    startedAt.current = Date.now();
    recordUsage("round_started", daily ? "daily" : "play");
  }

  function start() {
    setError(null);
    setRound(null);
    if (daily) {
      fetchDaily(mysteryOn())
        .then((d) => {
          if (d.cards.length === 0) return setError("There's no daily challenge yet.");
          setDailyDone(d.played ? { score: d.my_score, average: d.average } : null);
          begin({ cards: d.cards, goldIndex: -1, first: false });
        })
        .catch((e) => setError(e instanceof ApiError ? e.message : "We couldn't load today's challenge."));
      return;
    }
    fetchPlayCards(mysteryOn())
      .then((bank) => {
        if (bank.length === 0) return setError("There are no quick-round cards yet.");
        const first = readNumber(PLAYED_KEY) === null;
        begin(buildRound(bank, Date.now(), first));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "We couldn't load the cards."));
  }

  useEffect(start, []);

  const card = round?.cards[index] ?? null;
  const answered = card ? answers.find((a) => a.card.id === card.id) ?? null : null;
  const done = round !== null && finished;
  const shown = useCountUp(answered ? answered.reveal.actual : null, card?.last_year ?? 0);

  async function submit() {
    if (!card || !range || busy || answered) return;
    setBusy(true);
    try {
      const reveal = await revealPlayCard(card.id, range[0], range[1]);
      const gold = round!.goldIndex === index;
      const p = cardPoints(reveal.points, reveal.hit, streak, gold);
      setStreak(p.streak);
      setAnswers((a) => [...a, { card, range, reveal, points: p.points, multiplier: p.multiplier }]);
      feedback(reveal.hit);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "We couldn't score that card.");
    } finally {
      setBusy(false);
    }
  }

  function next() {
    if (!round) return;
    if (index < round.cards.length - 1) {
      setIndex(index + 1);
      setRange(null);
    } else if (answered) {
      setFinished(true);
    }
  }

  // The end of a round: remember a personal best and that this visitor has played.
  const total = answers.reduce((s, a) => s + a.points, 0);
  const hits = answers.filter((a) => a.reveal.hit).length;
  useEffect(() => {
    if (!done || !round) return;
    write(PLAYED_KEY, "1");
    recordUsage("round_submitted", daily ? "daily" : "play");
    // The server re-scores the round and saves it for students who may save.
    submitRound({
      kind: daily ? "daily" : "quick",
      answers: answers.map((a) => ({ card_id: a.card.id, low: a.range[0], high: a.range[1] })),
      gold_index: round.goldIndex > 0 ? round.goldIndex : null,
    })
      .then((r) => {
        setSaved(r);
        if (r.saved && r.best !== null && !daily) setBest(Math.round(r.best));
      })
      .catch(() => setSaved(null));
    if (!round.first && (best === null || total > best)) {
      write(BEST_KEY, String(Math.round(total)));
      setBest(Math.round(total));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  // Enter submits, then moves on.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || (e.target as HTMLElement)?.tagName === "INPUT") return;
      if (answered) next();
      else submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="page quick-round">
      <header className="page-hero">
        <HeroWaves />
        <h1 className="hero-title">
          {daily ? "Daily" : "Quick"} <span className="hero-title-gold">{daily ? "challenge" : "round"}</span>
        </h1>
        {daily && round && !done && (
          <p className="hero-lede">
            {dailyDone
              ? `You've played today's challenge${dailyDone.score !== null ? ` (${n(Math.round(dailyDone.score))} points)` : ""}. You can play it again; it won't be saved.`
              : "The same 10 cards for everyone today. It counts once."}
          </p>
        )}
      </header>

      {error && <ErrorState message={error} onRetry={start} />}
      {!round && !error && <div className="skeleton skeleton-panel" aria-busy="true" aria-label="Loading cards" />}

      {round && !done && card && (
        <section className={`glass panel quick-card ${colourClass(card.difficulty)} ${round.goldIndex === index ? "is-gold" : ""}`} aria-labelledby="quick-card-title">
          <div className="quick-card-top">
            <span className="quick-card-count">
              Card {index + 1} of {round.cards.length}
            </span>
            {streak >= 2 && <span className="quick-combo">Combo: {streak} in a row</span>}
          </div>
          {round.goldIndex === index && <p className="quick-gold-note">Gold card: +{GOLD_BONUS} points if the result lands inside your range.</p>}
          {round.first && <p className="quick-hint">{HINTS[index] ?? HINTS[0]}</p>}
          <p className="quick-card-company">
            <span className="quick-card-swatch" aria-hidden="true" />
            {card.name ?? "Mystery company"}, {card.sector_name}
            {card.quarter ? `, ${card.quarter}` : ", a past quarter"}
          </p>
          {card.mystery_line && <p className="quick-card-line">{card.mystery_line}</p>}
          <h2 className="quick-card-title" id="quick-card-title">
            {cardTitle(card.label)}
          </h2>
          {explainMetric(card.metric_key, card.label) && <p className="round-glossary">{explainMetric(card.metric_key, card.label)}</p>}

          <RangeSlab
            label={card.label}
            unit={card.unit}
            domain={slabDomain(card.metric_key, card.last_year)}
            value={answered ? answered.range : range}
            onChange={setRange}
            lastYear={card.last_year}
            lastQuarter={card.last_quarter}
            disabled={answered !== null}
            result={answered ? answered.reveal.actual : null}
          />

          {!answered ? (
            <button type="button" className="btn btn-primary btn-block" disabled={!range || busy} aria-busy={busy} onClick={submit}>
              Submit
            </button>
          ) : (
            <div className="quick-reveal" aria-live="polite">
              <p className="quick-reveal-number">
                {n(shown ?? answered.reveal.actual)}
                {card.unit}
              </p>
              <p className={`quick-reveal-verdict ${answered.reveal.hit ? "is-hit" : "is-miss"}`}>
                {answered.reveal.hit ? "Inside" : `Missed by ${n(answered.reveal.missed_by)}`}
                {" · "}
                {n(answered.points)} points
                {answered.multiplier > 1 && ` (combo ×${answered.multiplier})`}
              </p>
              <p className="quick-reveal-lazy">
                {answered.reveal.beat_lazy === true
                  ? "Beat the lazy guess"
                  : answered.reveal.beat_lazy === false
                    ? "Lazy guess was closer"
                    : "No lazy guess for this number"}
              </p>
              {answered.reveal.note && <p className="quick-reveal-note">{answered.reveal.note}</p>}
              <p className="quick-reveal-who">
                It was {answered.reveal.name}, {answered.reveal.quarter}.
              </p>
              <button type="button" className="btn btn-primary btn-block" onClick={next}>
                {index < round.cards.length - 1 ? "Next card" : "See how you did"}
              </button>
            </div>
          )}
        </section>
      )}

      {round && done && (
        <section className="glass panel quick-end" aria-labelledby="quick-end-title">
          <h2 className="quick-end-title" id="quick-end-title">
            {endLine(hits, round.cards.length)}
          </h2>
          <dl className="hero-stats">
            <div>
              <dt>Points</dt>
              <dd>{n(Math.round(total))}</dd>
            </div>
            {!round.first && (
              <div>
                <dt>Your best</dt>
                <dd>{best === null ? n(Math.round(total)) : n(best)}</dd>
              </div>
            )}
            <div>
              <dt>Time</dt>
              <dd>{Math.max(1, Math.round((Date.now() - startedAt.current) / 60000))} min</dd>
            </div>
          </dl>
          <EndDots answers={answers} picked={picked} onPick={setPicked} />
          {saved?.saved && (
            <p className="quick-saved" role="status">
              {saved.xp_gained > 0 ? `+${saved.xp_gained} XP. ` : ""}Level {saved.level}.
              {saved.new_badges.map((b) => ` New badge: ${b}.`).join("")}
            </p>
          )}
          {saved && !saved.saved && saved.not_saved_reason && NOT_SAVED[saved.not_saved_reason] && (
            <p className="section-text">{NOT_SAVED[saved.not_saved_reason]}</p>
          )}
          {daily && dailyDone?.average != null && <p className="section-text">Today's average: {n(dailyDone.average)} points.</p>}
          {round.first && <p className="section-text">That was your first round: three Easy cards. Next rounds have 10 cards from every sector.</p>}
          <div className="quick-end-actions">
            {daily ? (
              <a className="btn btn-primary" href="#/play">
                Play a quick round
              </a>
            ) : (
              <button type="button" className="btn btn-primary" onClick={start}>
                One more round
              </button>
            )}
            {user && (
              <a className="btn btn-secondary" href="#/me">
                See your progress
              </a>
            )}
            <ShareScore points={Math.round(total)} hits={hits} total={round.cards.length} />
          </div>
          <p className="section-text">
            {DAILY_CHALLENGE ? "That's a good place to stop. The daily challenge resets at midnight." : "That's a good place to stop."}
          </p>
        </section>
      )}

      {(done || error) && <SiteFooter />}
    </div>
  );
}

// The end of a round: one dot per card, gold when the result landed inside.
// Tapping a dot shows that card's range, result and last year.
function EndDots({ answers, picked, onPick }: { answers: Answer[]; picked: number | null; onPick: (i: number | null) => void }) {
  const a = picked === null ? null : answers[picked];
  const u = a?.card.unit ?? "";
  return (
    <div className="quick-dots-wrap">
      <div className="quick-dots" role="group" aria-label="Your cards">
        {answers.map((x, i) => (
          <button
            key={x.card.id}
            type="button"
            className={`quick-dot ${x.reveal.hit ? "is-hit" : "is-miss"}`}
            aria-pressed={picked === i}
            aria-label={`Card ${i + 1}: ${cardTitle(x.card.label)}, ${x.reveal.hit ? "inside" : "missed"}`}
            onClick={() => onPick(picked === i ? null : i)}
          />
        ))}
      </div>
      {a && (
        <dl className="quick-dot-detail" aria-live="polite">
          <div>
            <dt>{cardTitle(a.card.label)}</dt>
            <dd>
              {a.reveal.name}, {a.reveal.quarter}
            </dd>
          </div>
          <div>
            <dt>Your range</dt>
            <dd>
              {n(a.range[0])}
              {u} to {n(a.range[1])}
              {u}
            </dd>
          </div>
          <div>
            <dt>Result</dt>
            <dd>
              {n(a.reveal.actual)}
              {u} ({a.reveal.hit ? "inside" : `missed by ${n(a.reveal.missed_by)}`})
            </dd>
          </div>
          <div>
            <dt>Last year</dt>
            <dd>{a.card.last_year === null ? "N/A" : `${n(a.card.last_year)}${u}`}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

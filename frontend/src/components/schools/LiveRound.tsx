import { useEffect, useState } from "react";
import { answerSession, ApiError, type ClassSession, fetchSession, stepSession } from "../../lib/api";
import { explainMetric } from "../../lib/glossary";
import { slabDomain } from "../../lib/leagueFormat";
import { n } from "../../lib/scoring";
import RangeSlab, { type Pair } from "../RangeSlab";
import { cardTitle } from "../play/QuickRound";

// #/live/<id>: classroom mode (phase 8, SC5). The teacher's screen is the
// projector view: the card, how many have answered, the class's average
// range, then Reveal and Next. Students answer on their phones. Everyone
// polls every 2 seconds; nothing here is scored or saved beyond the class's
// answers. DRAFT wording.

const POLL_MS = 2000;

export default function LiveRound({ id }: { id: number }) {
  const [s, setS] = useState<ClassSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Pair | null>(null);
  const [cardIndex, setCardIndex] = useState(-1);

  useEffect(() => {
    let alive = true;
    const tick = () =>
      fetchSession(id)
        .then((x) => alive && setS(x))
        .catch((e) => alive && setError(e instanceof ApiError ? e.message : "We couldn't load the class round."));
    tick();
    const t = window.setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [id]);
  useEffect(() => {
    if (s && s.index !== cardIndex) {
      setCardIndex(s.index);
      setRange(null);
    }
  }, [s, cardIndex]);

  const act = (fn: () => Promise<ClassSession>) =>
    fn()
      .then(setS)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't do that."));

  if (error && !s) return <p className="form-error page">{error}</p>;
  if (!s) return <div className="skeleton skeleton-panel page" aria-busy="true" aria-label="Loading the class round" />;
  if (s.ended || !s.card)
    return (
      <div className="page">
        <section className="glass panel">
          <h1 className="page-title">That's the end of the class round</h1>
          <a className="btn btn-primary" href={`#/classes/${s.class_id}`}>
            Back to the class
          </a>
        </section>
      </div>
    );
  const card = s.card;
  const domain = slabDomain(card.metric_key, card.last_year);
  return (
    <div className={`page live-round ${s.teaching ? "is-projector" : ""}`}>
      <section className="glass panel quick-card" aria-labelledby="live-title">
        <p className="quick-card-count">
          Card {s.index + 1} of {s.total} · {card.sector_name}
          {card.mystery_line ? ` · ${card.mystery_line}` : ""}
        </p>
        <h1 className="quick-card-title" id="live-title">
          {cardTitle(card.label)}
        </h1>
        {explainMetric(card.metric_key, card.label) && <p className="round-glossary">{explainMetric(card.metric_key, card.label)}</p>}

        {s.teaching ? (
          <>
            <p className="live-count" aria-live="polite">
              {s.answered} of {s.members} answered
            </p>
            {s.class_range && (
              <p className="live-class-range">
                The class's average range: {n(s.class_range[0])}
                {card.unit} to {n(s.class_range[1])}
                {card.unit}
              </p>
            )}
            <RangeSlab
              label={card.label}
              unit={card.unit}
              domain={domain}
              value={s.class_range}
              onChange={() => {}}
              lastYear={card.last_year}
              lastQuarter={card.last_quarter}
              disabled
              result={s.revealed ? s.actual : null}
            />
            {s.revealed && s.actual !== null && (
              <p className="quick-reveal-number">
                {n(s.actual)}
                {card.unit}
                <span className="section-text"> {s.class_hit ? "Inside the class's range" : "Outside the class's range"}</span>
              </p>
            )}
            <div className="quick-end-actions">
              {!s.revealed ? (
                <button type="button" className="btn btn-primary" onClick={() => act(() => stepSession(id, "reveal"))}>
                  Reveal
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => act(() => stepSession(id, "next"))}>
                  {s.index < s.total - 1 ? "Next card" : "Finish"}
                </button>
              )}
              <button type="button" className="btn btn-secondary" onClick={() => act(() => stepSession(id, "end"))}>
                End the round
              </button>
            </div>
          </>
        ) : (
          <>
            <RangeSlab
              label={card.label}
              unit={card.unit}
              domain={domain}
              value={s.my_range ?? range}
              onChange={setRange}
              lastYear={card.last_year}
              lastQuarter={card.last_quarter}
              disabled={s.revealed || s.my_range !== null}
              result={s.revealed ? s.actual : null}
            />
            {!s.revealed && !s.my_range && (
              <button type="button" className="btn btn-primary btn-block" disabled={!range} onClick={() => range && act(() => answerSession(id, range[0], range[1]))}>
                Send my range
              </button>
            )}
            {!s.revealed && s.my_range && <p className="section-text">Sent. Wait for your teacher to reveal.</p>}
            {s.revealed && s.actual !== null && (
              <p className="quick-reveal-verdict">
                {n(s.actual)}
                {card.unit}: {s.my_hit ? "inside your range" : s.my_range ? "outside your range" : "you didn't answer this one"}
              </p>
            )}
          </>
        )}
        {error && <p className="form-error">{error}</p>}
      </section>
    </div>
  );
}

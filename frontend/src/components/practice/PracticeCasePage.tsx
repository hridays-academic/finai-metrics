import { type FormEvent, forwardRef, useEffect, useRef, useState } from "react";
import ErrorState from "../ErrorState";
import {
  ApiError, fetchLeagueConfig, fetchPracticeCase, fetchPracticeCases, fetchPracticePrices, submitPracticeAttempt,
} from "../../lib/api";
import { asEvent, asHistory, MYSTERY_NAME, MYSTERY_QUARTERS_NOTE, mysteryOn, practiceQuarterLabel, surprise } from "../../lib/practice";
import { formatDay, lastQuarterValues, lastYearValues, metricFacts, slabDomain } from "../../lib/leagueFormat";
import { colourClass, difficultyOf, fromProviderRows } from "../../lib/difficulty";
import type { LeagueConfig, PracticeAttempt, PracticeCase, PracticePrices } from "../../lib/types";
import CompanyStory from "../league/CompanyStory";
import SectorCheatSheet from "../SectorCheatSheet";
import SectorExplainer from "../league/SectorExplainer";
import { QuartersTable } from "../league/ResearchPanel";
import { MetricCard, n } from "../league/ResultsPage";
import { hostOf, LEAGUE_FOOTNOTE } from "../league/outcome";
import RangeSlab from "../RangeSlab";
import MetricSteps, { type MetricFacts } from "../league/MetricSteps";
import { recordUsage } from "../../lib/reports";
import FinePrint from "../FinePrint";
import SiteFooter from "../SiteFooter";

// #/practice/<code> (2026-11-18, plan and wording approved): one past
// quarter, with the company page's story and research as they were before
// the results came out (the server cuts everything to that moment), a range
// for each number, then the answer and your score on the same page.
// Not shown here, because it can't be cut to the date or would give the
// answer away: the full share price chart, "Open in Research", the research
// workspace, the Yahoo-vs-league margin note, the outcome panel, the lock
// countdown and "Results expected".

interface Props {
  code: string;
  onOpenAuth: () => void;
}

type Ranges = Record<string, { low: string; high: string }>;

export default function PracticeCasePage({ code, onOpenAuth }: Props) {
  // Decided when the page opens, so the page never changes under you.
  const [mystery] = useState(mysteryOn);
  const [practice, setPractice] = useState<PracticeCase | null>(null);
  const [prices, setPrices] = useState<PracticePrices["points"] | null>(null);
  const [config, setConfig] = useState<LeagueConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PracticeAttempt | null>(null);
  const resultRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    setPractice(null);
    setResult(null);
    setError(null);
    Promise.all([fetchPracticeCase(code, mystery), fetchLeagueConfig()])
      .then(([c, cfg]) => {
        if (cancelled) return;
        setPractice(c);
        setConfig(cfg);
      })
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Couldn't load this company."));
    fetchPracticePrices(code, mystery)
      .then((p) => !cancelled && setPrices(p.points))
      .catch(() => !cancelled && setPrices([]));
    return () => {
      cancelled = true;
    };
  }, [code, mystery]);

  if (error) {
    return (
      <div className="page">
        <a className="back-link" href="#/practice" data-keep-scroll>
          ← Practice
        </a>
        <ErrorState message={error} />
      </div>
    );
  }
  if (!practice || !config) {
    return (
      <div className="page">
        <p className="empty-note">Loading...</p>
      </div>
    );
  }

  const event = asEvent(practice);
  const history = asHistory(practice);
  const quarterName = practiceQuarterLabel(practice);
  const explainer = config.sector_explainers.find((e) => e.sector === practice.sector);
  const toForm = () => document.getElementById("forecast")?.scrollIntoView({ behavior: "smooth", block: "start" });

  function showResult(r: PracticeAttempt) {
    setResult(r);
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return (
    <div className={`page company-page practice-case round-page company-colour ${colourClass(difficultyOf(fromProviderRows(history.provider_rows)))}`}>
      {/* P10 (master plan): the practice note is one small line, not a panel. */}
      <p className="practice-note-line">
        A past quarter. Everything here is as it was before the results came out. Practice scores don't count in the league.
      </p>
      <RoundNav code={practice.code} mystery={practice.mystery} />
      <header className="glass panel company-facts">
        <a className="back-link" href="#/practice" data-keep-scroll>
          ← Practice
        </a>
        <h1 className="hero-title round-title">{practice.name ?? MYSTERY_NAME}</h1>
        <p className="meta">
          <span>{practice.sector_name}</span>
        </p>
        {practice.description && <p className="section-text">{practice.description}</p>}
      </header>

      <div className="round-main">
        {result ? (
          <PracticeResult
            ref={resultRef}
            practice={practice}
            result={result}
            onOpenAuth={onOpenAuth}
            onReplay={() => {
              setResult(null);
              requestAnimationFrame(toForm);
            }}
          />
        ) : (
          <section id="forecast" className="glass panel forecast-section" aria-labelledby="forecast-title">
            <h2 className="panel-title" id="forecast-title">
              Your forecast
            </h2>
            <PracticeForm
              practice={practice}
              onScored={showResult}
              lastYear={lastYearValues(history.actuals, event.period_end_date, practice.metrics.map((m) => m.key))}
              lastQuarter={lastQuarterValues(history.actuals, event.period_end_date, practice.metrics.map((m) => m.key))}
              facts={metricFacts(history.actuals, event.period_end_date, practice.metrics.map((m) => m.key), quarterName)}
            />
          </section>
        )}
      </div>
      {/* C1/C6 (master plan): the story is optional, under "About this company";
          the explainer below it keeps only what the story doesn't say. */}
      <details className="about-company glass panel">
        <summary className="panel-title">About this company</summary>
        <CompanyStory
          flat
          event={event}
          explainer={explainer}
          history={history}
          sectorName={practice.sector_name}
          hasForecast={false}
          onJumpToForm={toForm}
          practice={{
            backHref: "#/practice",
            backLabel: "← Practice",
            quarterName,
            prices,
            hideDates: practice.mystery,
          }}
        />
        {explainer && <SectorExplainer explainer={explainer} compact />}
        <SectorCheatSheet sector={practice.sector} sectorName={practice.sector_name} latest={false} />
      </details>
      <div className="page-main">
        <section className="glass panel" aria-labelledby="research-title">
          <h2 className="panel-title" id="research-title">
            Research
          </h2>
          <div className="league-research">
            {practice.research_notes && (
              <aside className="research-tip" aria-label="Tip from Stackly">
                <div className="research-tip-label">Tip</div>
                <p>{practice.research_notes}</p>
              </aside>
            )}
            {practice.mystery && <p className="section-text">{MYSTERY_QUARTERS_NOTE}</p>}
            <QuartersTable event={event} history={history} historyError={null} practice={{ quarterName }} />
          </div>
        </section>
      </div>


      <SiteFooter />
    </div>
  );
}

function PracticeForm({
  practice,
  onScored,
  lastYear,
  lastQuarter,
  facts,
}: {
  practice: PracticeCase;
  onScored: (r: PracticeAttempt) => void;
  lastYear?: Record<string, number | null>;
  lastQuarter?: Record<string, number | null>;
  facts?: Record<string, MetricFacts | undefined>;
}) {
  const [tried, setTried] = useState(false);
  useEffect(() => recordUsage("round_started", "practice"), []);
  const [ranges, setRanges] = useState<Ranges>(() =>
    Object.fromEntries(practice.metrics.map((m) => [m.key, { low: "", high: "" }]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    const values = practice.metrics.map((m) => ({
      metric_key: m.key,
      low: Number(ranges[m.key].low),
      high: Number(ranges[m.key].high),
    }));
    const bad = practice.metrics.find(
      (m, i) => ranges[m.key].low === "" || ranges[m.key].high === "" || values[i].low > values[i].high
    );
    if (bad) {
      setError(`${bad.label}: enter a low and a high, with low no bigger than high.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onScored(await submitPracticeAttempt(practice.code, values, practice.mystery));
      recordUsage("round_submitted", "practice");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't score this. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="league-form" onSubmit={submit} data-guide-keep>
      <p className="league-eighty">
        Pick a low and a high you're pretty sure the result lands between. Too tight and you might miss. Too wide and
        you lose points for playing it safe.
      </p>
      <MetricSteps metrics={practice.metrics} ranges={Object.fromEntries(
          practice.metrics.map((m) => {
            const r = ranges[m.key];
            const ok = r.low !== "" && r.high !== "" && Number(r.low) <= Number(r.high);
            return [m.key, ok ? ([Number(r.low), Number(r.high)] as [number, number]) : null];
          })
        )} facts={facts}>
        {(m) => {
        const r = ranges[m.key];
        const width = r.low !== "" && r.high !== "" ? Number(r.high) - Number(r.low) : null;
        const valid = width !== null && width >= 0 && Number.isFinite(width);
        const set = (side: "low" | "high", value: string) =>
          setRanges((prev) => ({ ...prev, [m.key]: { ...prev[m.key], [side]: value } }));
        return (
          <fieldset className="field" key={m.key}>
            <legend className="field-label">{m.label}</legend>
            {/* F1-F7 (master plan phase 4): the one range control. */}
            <RangeSlab
              label={m.label}
              unit={m.unit}
              domain={slabDomain(m.key, lastYear?.[m.key])}
              value={valid ? [Number(r.low), Number(r.high)] : null}
              onChange={([a, b]) => {
                set("low", a.toFixed(1));
                set("high", b.toFixed(1));
              }}
              lastYear={lastYear?.[m.key] ?? null}
              lastQuarter={lastQuarter?.[m.key] ?? null}
              
            />
            <p className={`field-hint ${(width !== null && width < 0) || (width === null && tried) ? "field-hint-error" : ""}`}>
              {width === null
                ? tried
                  ? "Enter both numbers."
                  : ""
                : width < 0
                  ? "Low is above high. Swap them."
                  : ""}
            </p>
            <details className="league-definition">
              <summary>How this is measured</summary>
              <p>{m.definition}</p>
            </details>
          </fieldset>
        );
      }}
      </MetricSteps>
      {error && <div className="form-error">{error}</div>}
      <button type="submit" className="btn btn-primary btn-block" disabled={saving} aria-busy={saving}>
        Submit and see my score
      </button>
    </form>
  );
}

const NOT_SAVED: Record<string, string> = {
  // P9 (approved 2.29).
  signed_out: "Sign in to keep this score.",
  consent_pending: "Your practice scores will be saved once your parent's consent is recorded.",
  // Draft, for approval (vault note, phase B wording).
  profile_required: "Choose a handle and your age group to keep your practice scores. This one isn't saved.",
};

interface ResultProps {
  practice: PracticeCase;
  result: PracticeAttempt;
  onOpenAuth: () => void;
  onReplay: () => void;
}

const PracticeResult = forwardRef<HTMLElement, ResultProps>(function PracticeResult(
  { practice, result, onOpenAuth, onReplay },
  ref
) {
  const [others, setOthers] = useState(false);
  const r = result.reveal;
  async function tryAnother() {
    setOthers(true);
    try {
      const cards = await fetchPracticeCases(practice.mystery);
      const pick = surprise(cards, practice.code);
      if (pick) window.location.hash = `#/practice/${pick.code}`;
    } finally {
      setOthers(false);
    }
  }
  return (
    <section id="forecast" className="glass panel practice-result" aria-labelledby="practice-score-title" ref={ref} tabIndex={-1}>
      {practice.mystery && (
        <p className="practice-reveal" aria-live="polite">
          It was {r.name}: {r.season_label} results, out on {formatDay(r.results_date, true)}.
        </p>
      )}
      <div className="results-score">
        <h2 className="results-score-label" id="practice-score-title">
          Your score {result.is_replay && <span className="practice-badge">Replay</span>}
        </h2>
        <div className="results-score-value">{n(result.event_score)}</div>
        <p>{result.event_score_explanation}</p>
        {result.is_replay && (
          <p className="practice-replay">
            Replays don't change your first score.
            {result.first_score !== null && <> First try: {n(result.first_score)} points</>}
          </p>
        )}
      </div>
      {result.not_saved_reason && NOT_SAVED[result.not_saved_reason] && (
        <div className="notice practice-not-saved">
          {NOT_SAVED[result.not_saved_reason]}
          {result.not_saved_reason === "signed_out" && (
            <button type="button" className="link-button" onClick={onOpenAuth}>
              Sign in
            </button>
          )}
        </div>
      )}
      <ul className="group results-list">
        {result.metrics.map((m, i) => (
          <MetricCard key={m.metric_key} m={m} index={i} />
        ))}
      </ul>
      <ul className="practice-sources">
        {result.metrics.map((m) =>
          r.sources[m.metric_key] ? (
            <li key={m.metric_key} className="outcome-source">
              {m.label}. Source:{" "}
              <a href={r.sources[m.metric_key]} target="_blank" rel="noopener noreferrer">
                {hostOf(r.sources[m.metric_key])}
              </a>
            </li>
          ) : null
        )}
      </ul>
      <div className="practice-actions">
        <button type="button" className="btn btn-primary" onClick={tryAnother} disabled={others} aria-busy={others}>
          Try another
        </button>
        <button type="button" className="btn btn-secondary" onClick={onReplay}>
          Replay
        </button>
      </div>
      <FinePrint>{LEAGUE_FOOTNOTE}</FinePrint>
    </section>
  );
});

// I4 (master plan; approved 2.27): where you are in Practice, with Previous
// and Next. The order is the Practice page's list.
function RoundNav({ code, mystery }: { code: string; mystery: boolean }) {
  const [codes, setCodes] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchPracticeCases(mystery)
      .then((all) => !cancelled && setCodes(all.map((c) => c.code)))
      .catch(() => !cancelled && setCodes(null));
    return () => {
      cancelled = true;
    };
  }, [mystery]);
  const i = codes ? codes.indexOf(code) : -1;
  if (!codes || i < 0) return null;
  return (
    <nav className="round-nav" aria-label="Practice rounds">
      <span className="round-nav-count">
        Round {i + 1} of {codes.length}
      </span>
      <span className="round-nav-links">
        {i > 0 && (
          <a className="btn btn-secondary btn-compact" href={`#/practice/${codes[i - 1]}`}>
            Previous
          </a>
        )}
        {i < codes.length - 1 && (
          <a className="btn btn-secondary btn-compact" href={`#/practice/${codes[i + 1]}`}>
            Next
          </a>
        )}
      </span>
    </nav>
  );
}

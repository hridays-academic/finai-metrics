<!-- Moved word for word from CLAUDE.md on 2026-11-25 (master plan Z1). The index is CLAUDE.md. -->
# Results League and scoring

## Results League (2026-09, in progress)

**Status (2026-10-20):** Phases 1-2, the student front end, the
simplified admin page, and scoring + the results page are deployed; schema
version 7. That's every core piece for the November mini-pilot. Not part of
it (deferred by Hriday): written diagnosis rules, leagues, profiles, design
polish. Handoffs are in the codebase map's `03_logs/` (latest first).

**Plan (changed 2026-10-16):** a small November mini-pilot (Hriday plus
5-15 friends, 8-10 companies reporting from late October), then the full
school pilot in January. First pilot companies report from ~2026-10-30.

**Product decisions already made (don't re-ask):**
- Hide analyst consensus and price targets everywhere, including the
  standalone Research page; Return Calculator becomes historical-returns
  only (remove its analyst-target fallback).
- If an event defines a sector KPI, every forecaster must forecast it.
- Crowd median is shown only with at least 5 forecasters.
- The research panel's quarterly table shows whatever quarters yfinance has
  (N/A for the rest) alongside admin-entered past actuals, each labelled by
  source and definition.
- Diagnosis rules: draft them and get approval before wiring them in.
- Sector KPIs for the pilot: cement, autos, FMCG, IT (drafts in
  `league_config.py`, awaiting sign-off). Banks/NBFCs excluded from the
  pilot and from Practice; a bank template comes in January.
- Practice shows revenue indexed to Year 1 = 100, never absolute figures.
- No third-party analytics (GA4 removed; see "First-party visit counter").
  Measure the pilot from our own database.
- Submitting a forecast counts as league participation: under-18 users with
  pending guardian consent can't submit. Consent is collected through
  schools on signed forms, and an admin marks it received. Keep the
  `TODO(legal)` placeholder and never claim legal compliance anywhere.

Stackly is becoming a forecasting league: before a company reports
quarterly results, users forecast revenue growth, operating margin and an
optional sector KPI as 80% ranges; after results, each forecast is scored
for accuracy, skill (vs. a "lazy" baseline) and calibration. Built in phases
for a Q2 FY27 pilot (results late Oct - mid Nov 2026).

- `services/league_schema.py` -- the league's tables, in the same
  idempotent-SQL style as `db.py`. Actuals are keyed by **fiscal period**,
  not event, and carry a versioned `definition_key`. Integrity lives in
  **database triggers**: forecasts can't be created, edited or deleted after
  their event's `lock_at` (database clock), and a passed `lock_at` can't be
  moved.
- `services/scoring.py` -- all scoring, pure functions (interval score,
  points, beat-lazy, calibration and leaderboard thresholds).
- `league_config.py` -- per-market metric definitions, sector KPI templates
  (cement, autos, FMCG, IT; banks/NBFCs excluded for now), reason tags and
  bounds. Change a definition by adding a new `.vN` key, never by editing
  the text of an existing one.
- yfinance history depth (measured 2026-09, 41 NSE tickers): 5 quarters,
  non-consecutive (Sep 2025 missing for 28 of 40), so year-ago quarters are
  admin-entered; 4 complete fiscal years for 39 of 41.

**Phase 2 (built 2026-09-30).** Reached by hash URL only for now
(`#/league`, `#/event/<id>`, `#/admin`; `lib/router.ts`) -- the sidebar
nav switch is Phase 5 and not urgent.
- Backend: `routes/league.py` (config, events, forecast save/read, research
  history, `PATCH /api/league/me`), `routes/admin.py` (quick event setup,
  event edits, periods, actuals, baselines, users + guardian consent,
  audit log, visits), `routes/deps.py` (optional_user / require_user /
  require_admin). Logic in `services/league_service.py` (user side),
  `services/league_admin.py`, `services/research_history.py`,
  `services/audit.py`, `services/results_provider.py` (Manual + a documented
  SEC EDGAR stub). Rule violations raise `LeagueError` -> JSON
  `{"detail": {"code", "message"}}`.
- Eligibility: forecasting needs a handle and age band; under-18 needs
  `guardian_consent_status = 'granted'`, set by an admin (Players tab) when
  the school's signed form arrives. The age band can only be set once by
  the user (admins can correct it), so a minor can't self-exempt.
- The research table always shows the eight quarter-ends before the event,
  N/A where yfinance lacks one; yfinance figures (Yahoo definitions,
  labelled) and admin actuals (league definitions, with source links) sit
  in separate columns and are never merged.
- Demo companies (`is_demo`) are hidden from listings whenever `VERCEL` is
  set. Draft events are invisible to players.
- Analyst consensus and price targets are no longer rendered anywhere
  (`AnalystConsensus.tsx`/`PriceForecastChart.tsx` kept but unused); the
  Return Calculator is historical-returns only.
- Not built yet: diagnosis (Phase 3), seed script, profiles/leagues,
  practice. Scoring, the results page and crowd stats shipped 2026-10-20.
- The full backend suite takes ~30 minutes from India against Neon; use
  `scripts/test_local.sh` (32 s) instead. A lone "server closed the connection
  unexpectedly" failure is a dropped Neon connection -- rerun that test.

**Student front end + simplified admin (2026-10-19).**
- **Home is the landing page** (`league/LeagueHome.tsx`, view `"home"`;
  `#/league` is another address for it). Four random *open* events, one
  per sector where possible, plus "Show me 4 others". Each card: sector,
  name, one-line description, results countdown (IST days); hover
  (desktop) / first tap (touch) expands it to show the latest quarter's
  revenue and profit from the research-history endpoint (Yahoo, labelled
  with quarter end and fetch date, N/A when missing). "My forecasts" below
  for signed-in users. Mounted only while shown, so it refetches each visit.
- **Company page** (`#/event/<id>`) is one column: "How this business makes
  money" (`league/SectorExplainer.tsx`), research, then the forecast form.
  **No ratio tiles on the company page (2026-11-07).** Its research section
  shows the Tip, the quarters table + sparklines and the lagged price chart
  (`PriceChart` from `event.company.provider_symbol`, so the page makes no
  `/api/company` call), then a callout "Open in Research". That calls
  `App.tsx`'s `openInResearch`: `leaveRoute()` (a real history entry, so the
  browser's Back returns), switch to Research, prefill and load the symbol,
  and show "← Back to forecast: <name>" on the Research panel until the
  visitor uses it or picks another sidebar view. Research itself is unchanged.
- **Explainer layout fields (2026-11-07):** `lead` is the first sentence of
  the approved "what it sells" text, moved out of `sells` (not copied);
  `equation` uses only terms the text itself uses; `key_insight` must quote
  an approved sentence word for word (`test_league_config.py` checks it).
- **Explainers and default card descriptions live in `league_config.py`**
  (`sector_explainers`, `company_descriptions` by ticker), both approved by
  Hriday 2026-10-19. `companies.description` (schema v6, set from the admin
  form) overrides the config default. M&M is deliberately not in the pool:
  its car and tractor sales come in separate releases, so the autos units
  KPI is ambiguous for it.
- **KPI decisions are final (2026-10-16):** cement volume growth (tonnes,
  YoY); autos total units (domestic + exports, every vehicle type in the
  monthly sales release, `.v2`); FMCG underlying volume growth only where
  disclosed (`non_disclosing_tickers`, currently ITC and NESTLEIND, are
  refused a KPI -- never estimate one); IT constant-currency growth YoY.
- **Admin page = Companies / Students / More.** `GET /api/admin/events`
  returns `AdminBoardRow`s with a derived `status`: `needs_last_year` ->
  `open` (or `hidden` if an admin moved it to draft) -> `results_due` (lock
  passed, the event's own actuals incomplete) -> `ready_to_score` ->
  `scored` (-> `rescore_needed` if any current or year-ago actual was
  entered after `forecast_events.scored_at`). "Complete" means an actual exists under the event's own
  `definition_key`, not just the metric key.
- **New events are hidden (draft) until last year's numbers are in.**
  `QuickEventIn.open_now` defaults to False (only tests/seed scripts set
  it). `PUT /api/admin/events/{id}/last-year` writes the year-ago quarter
  (`year_ago_label`: FY27 -> FY26) and opens the event once every metric
  has a value. `PUT .../results` refuses before the lock
  (`results_before_lock`), so a result can never be visible while
  forecasts are open. The old generic Results/Events tabs were removed.
- `statement_history_cache` rows now carry `net_income`; rows cached
  before that are treated as stale and refetched once.

**Scoring and the results page (2026-10-20).** `services/league_scoring.py`;
the maths in `scoring.py` is unchanged.
- **Lazy baseline = the same metric's year-ago actual** (the admin's "last
  year's numbers", under the event's own `definition_key`): revenue growth
  -> last year's same-quarter YoY growth (Q2 FY26 vs Q2 FY25, which the
  admin computes from the Q2 FY26 filing; the form shows the formula);
  margin -> last year's margin; KPI -> last year's KPI value. Missing or
  differently defined -> NULL -> N/A, no bonus. Never estimated. Computed
  at each scoring run and written to `baselines`.
- **A tie with the lazy guess never earns the bonus, including decimal ties
  (fixed 2026-11-24).** Both distances are compared rounded to 6 decimal
  places, as whole millionths (`scoring._micro` / `lib/scoring.ts`'s
  `micro`, the same float operations so the two agree); raw floats made
  |38.9 - 26| (12.899999999999999) smaller than |13.1 - 26| (12.9).
  `backend/scripts/recheck_lazy_ties.py` re-scores every stored score
  read-only (`RECHECK_DATABASE_URL`; production's string is Sensitive in
  Vercel, so only Hriday can run it there). On 2026-11-24 production's 7
  scored events had 0 forecasts (public `outcome` counts), so nothing
  changed.
- `POST /api/admin/events/{id}/score` refuses before the lock
  (`not_locked`) or with any result missing (`results_missing`, naming
  them); returns `{"scored": n}`. Each run deletes and rewrites the event's
  scores in one transaction (idempotent), sets status `scored` +
  `scored_at`, and audits `score`/`rescore` with the actuals and lazy
  values used. A typo is fixed via "Correct a result" (results or last
  year's numbers, audited as an `actual` update), then "Re-score".
- `scores` also stores `actual_value` and `lazy_value` (schema v7), so the
  results page always shows exactly what was scored, even after a
  correction that hasn't been re-scored yet.
- **Student side:** `GET /api/league/events/{id}/my-result` (own forecast
  only; `not_scored`/`no_forecast` -> 404, which the page turns into "Locked.
  Results are announced on <date>; your score appears here after that." --
  never an error), `GET /api/league/me/season` (events scored, average,
  calibration once 10 metrics are scored), `EventSummary.my_score`. Page:
  `#/results/<id>` (`league/ResultsPage.tsx`), number line with labels
  stacked in lanes so close values never overlap.
- **Explanations** come from `scoring.explain_metric`/`explain_event_score`/
  `explain_crowd` (pure, tested). Wording approved by Hriday: widths and
  misses are "percentage points" (or the KPI's unit); "points" only ever
  means score; a floored score adds "Scores can't go below 0, so this
  counts as 0." -- for a miss AND for a hit so wide its width alone costs
  over 100 (it used to read "100 - 200 = 0"; fixed 2026-11-12). `_n` rounds half up so a sentence never disagrees with the
  frontend's `toFixed` label (7.25 -> 7.3 in both).
- Crowd median = median of all forecasters' midpoints, shown only at
  `min_forecasters_for_crowd` (5)+.

**Reviewing and approving results (2026-11-12).** Hriday only checks and
approves from now on; whoever researches results never writes them to the
database.
- **Proposals are committed JSON**, `backend/data/proposed_results/<FY>-Q<n>.json`
  (first file: `FY27-Q2.json`, the 7 pilot companies), shipped with a deploy
  (`vercel.json` `includeFiles: backend/data/**`; the main app logs "Result
  proposals loaded: N" at cold start, so check that line in the runtime log
  after a deploy). One entry per company: ticker, then per metric the
  value, definition key, source URL, PDF page, working, an optional `flag`
  (shown as a warning chip) and an optional one-line `note`. The research
  behind each file is a vault doc (`approval_doc`).
- **Matched by (ticker, fiscal year label, quarter)**, not event id
  (production ids aren't visible when preparing the file). Offered only if
  the proposal's (metric, definition key) set equals the event's exactly; a
  malformed file is skipped and logged, never fatal
  (`services/result_proposals.py`).
- **Board:** `AdminBoardRow.has_proposal` is true when the lock has passed,
  the event isn't scored, no result is saved yet, and a matching proposal
  exists. Then the status reads "Results due: review proposal" and the
  button is "Review results" (`admin/ReviewResultsPanel.tsx`): each metric's
  proposed value in an editable field, last year's value, source link and
  page, working, note and flag. Without a proposal the manual "Enter
  results" path is unchanged.
- **Approve and save** calls the same `PUT /api/admin/events/{id}/results`
  with `?from_proposal=true`: identical checks and save (lock, definitions,
  bounds, source link); it then writes one audit entry (action `approve`,
  entity `result_proposal`) with each metric's proposed and saved value,
  `edited` per metric and overall. Who approved and when are the audit
  row's actor and timestamp, so no schema change was needed. Approving
  never scores; the normal "Score" button follows. `GET
  /api/admin/events/{id}/proposal` serves the panel (404 `no_proposal`).
- **League rule (Hriday, 2026-11-12): if a company restates last year or
  sells a business, use the company's own like-for-like figure and note
  it** (the proposal's `note`). First uses: Marico revenue growth against
  last year as restated (accounting change: customer promotions netted off
  revenue, Q2 FY26 3,482 -> 3,450 cr); Jyothy volume growth excluding the
  Pril and Fa brands it exited on 31 May 2026. Stored year-ago numbers (the
  lazy guess) are never changed for this. FMCG volume growth is taken as
  the company states it (Dabur's "underlying volume growth", basis note kept).
- **Sources when NSE/BSE refuse an honest user agent** (they did on
  2026-11-12, from Hriday's machine and from WebFetch): each company's own
  investor site has the same filings. Scanned PDFs (Maruti, Marico, Dabur)
  must be read from the rendered page, not the OCR text.
- **Student notes** (`student_note` in the proposal file, wording approved by
  Hriday) are what students see; the admin-only `note` is not. Shown on the
  results page (forecasters and everyone else) only when the saved value
  equals the proposed one, since an edited value may make the note wrong
  (`league_scoring._student_notes`). First notes: Marico revenue growth,
  Jyothy revenue growth and volume growth.

**Dry run of scoring (2026-11-12, dev only).** A fictional DRYRUNCEM event,
three accounts covering hit, miss below, miss above, a 0 floor, bonus, no
bonus and bonus ties (equal distance = no bonus), scored through the normal
admin flow: all 9 metric and 3 event scores matched hand maths
(IS = width + 10 x miss, points = max(0, 100 - 2 x IS), +10 if strictly
closer than the lazy guess). Fixes from it: the floored-hit sentence above,
and the results legend now reads "-36% to 64%" for a negative low end
(`rangeText`). Seed data was deleted afterwards; deleting locked forecasts
needs the two lock triggers disabled inside the same transaction (dev only).

**After scoring, everyone sees how it turned out (2026-11-12, wording
approved by Hriday).** No schema or scoring change.
- `GET /api/league/events/{id}/outcome` (public; 404 `not_scored` before
  scoring): per metric the actual as saved now (with its source link), last
  year's value as scored (the `baselines` row written at every scoring run),
  the crowd median at 5+ forecasters (`_crowd`, shared with `my_result`) and
  any student note. Nobody's forecast or points. `GET /api/league/recent-results`
  (public): scored events, newest results first, with their actuals.
- Results page (`#/results/<id>`): with no forecast, or signed out, it shows
  "How it turned out" (`league/outcome.tsx`); signed in without a forecast it
  adds "You didn't forecast this company, so there's no score for you here."
  Signed out before scoring still asks to sign in. Forecasters' pages gained
  the student note and the league footnote.
- Company page after scoring: the header tile reads "Results are in"; the
  forecast form is replaced by "How it turned out" with "See the full
  results" (or "See your score"). Under the header tiles, "Yahoo Finance puts
  the operating margin at X%; the league's figure is Y%. ..." appears only
  when Yahoo's latest quarter is the event's quarter and the two differ once
  rounded (`yahooLeagueNote`).
- Home: "Recent results" lists scored companies with "Revenue growth +13.0%,
  margin 18.2%, volume growth +10.0%" (each sector's KPI short name:
  `KPI_SHORT` in `outcome.tsx`), linking to the results page, or "Your score"
  for forecasters. Outcome figures use one decimal, growth signed.
- **Local DNS (2026-11-12):** this Mac's router intermittently fails to
  resolve the Neon hosts. Workaround for local runs only: set libpq's
  `PGHOSTADDR` to the address from `dig @1.1.1.1 <host>` (the hostname still
  drives TLS/SNI). Never in Vercel.

**Schema changes need a version bump.** `init_db()` skips all schema
statements when the database's `schema_version` row is already at
`db.SCHEMA_VERSION`, saving ~50 round trips per cold start. If you add or
change any statement in `db.py` or `league_schema.py`, bump
`SCHEMA_VERSION`, or deployed databases will never run it.

Note the frontend build is a genuine check worth running -- `npm run build`
runs `tsc -b` with `strict`, `noUnusedLocals` and `noUnusedParameters`, so
it catches dead state and type drift even without tests.

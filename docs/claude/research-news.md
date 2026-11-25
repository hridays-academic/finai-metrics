<!-- Moved word for word from CLAUDE.md on 2026-11-25 (master plan Z1). The index is CLAUDE.md. -->
# Research, news and the workspace

## Research page expansion (2026-11, phase 1 of 4: ratios + history)

Plan approved by Hriday 2026-11-08: (1) ratios + financial history, (2) profile,
peers, documents, NSE announcements feed, (3) rule-based analysis (wording
approved first), (4) news, world events, macro charts. No AI in any of them.

- **Seven ratio sections** in `metrics.compute_metric_groups(raw, name, history,
  sector, industry)`: Growth, Profitability, Cash Flow, Working Capital
  (includes the old liquidity ratios), Returns (incl. a DuPont tile whose
  `parts` multiply back to ROE), Leverage, Valuation. 47 tiles. The old
  inventory/receivables turnover tiles were replaced by days figures.
- **`FinancialHistory`** (every year and quarter Yahoo returns) comes from the
  same download as `RawFinancials` (`YFinanceProvider.get_financials_with_history`)
  and is cached in `company_fundamentals_cache.history_json` (schema v9). Rows
  without it count as stale and are refetched once. `metrics.history_table`
  pads to five years and eight quarter-ends (N/A rows, never filled).
- **EBITDA = operating income + depreciation**, never Yahoo's own EBITDA row
  (it adds other income). Other income as % of PBT is always N/A: Yahoo's
  nearest row isn't Indian other income.
- **Days are "days of revenue"** (approved): Yahoo's cost of revenue is often
  materials only. **Payable days and the cash conversion cycle are withheld
  (N/A) for every company**, and debtor days when Yahoo's "Other Receivables"
  exceed its trade receivables. Reason: the 2026-11-08 check against the 7
  pilot companies' audited FY26 filings (vault: `Ratio check FY26 pilot
  companies.md`) found Yahoo's payables 75% off for Sagar Cements and 14% for
  Escorts, and Mphasis' receivables 77% off (unbilled revenue moved), with no
  way to spot the payables cases from the data. Yahoo's revenue runs 0-3.4%
  below filed revenue from operations; disclosed in the history footnote.
- **Dividend yield** = dividends paid in the last fiscal year / shares / the
  30-day-old price. Yahoo's per-share dividend fields are wrong for most
  Indian stocks (trailing rate 0; "dividend rate" = the latest single payment).
- **Cash ratio** includes short-term investments (liquid funds), as in the
  textbook definition.
- Sector-aware benchmarks (`_SECTOR_BENCHMARKS`: EBITDA margin, debtor and
  inventory days) use Yahoo's sector/industry via `sector_group`; banks and
  lenders get "Not meaningful" for the EBITDA, cash-flow, days and EV tiles.
- Known, not fixed: some companies' Yahoo statements are in USD (Infosys
  looked like it); the Research page formats every figure as rupees.

## News, world events and macro context (2026-11, Research phase 2 of 4)

Built before profile/peers/documents and the analysis, per Hriday 2026-11-08.
All wording (theme sentences, event-type lines) approved as written; change it
only with approval. Config in `app/news_config.py`, logic in `services/news.py`,
routes in `routes/news.py` + `routes/cron.py`, tables in `db.NEWS_SCHEMA_STATEMENTS`
(schema v10, run after the league tables because they reference companies).

- **Pages read Postgres only.** Scheduled jobs fill it (Vercel Cron in
  `vercel.json`, ~1,950 runs/month): NSE filings hourly 08:30-22:30 IST
  Mon-Sat, GDELT hourly, RBI every 6 h, macro daily. `/api/cron/*` needs
  `Authorization: Bearer $CRON_SECRET` (set by Hriday in Vercel Production)
  and returns 503 when it isn't set.
- **Cron runs in its own function** (`api/cron.py` -> `app/cron_app.py`), which
  imports only the job code: no `main.py`, no yfinance/pandas, no schema check
  (<1 s to start; a test enforces it). Reason: on 2026-11-10 an NSE run was
  SIGKILLed while the main app started. So **schema changes for job tables only
  take effect after the main app's first request post-deploy**: hit
  `/api/health` right after deploying, before the next cron. A failed job
  answers 502 and logs `Job <name> failed`, so Vercel's logs show it.
- **Data jobs** (Admin > More): each job's last success, last error (cleared
  by the next success), items added on the last run and items stored
  (`job_runs.last_items`, schema v11).
- **GDELT headlines come from GDELT's raw 15-minute GKG files**
  (data.gdeltproject.org), not its search API: the API rate-limited Vercel's
  shared addresses in every region tried (2026-11-08/10), and rotating
  regions to dodge that was ruled out by Hriday. The files have no limit
  (24/24 fetched in a test). The job reads the files after the last one it
  finished (`job_runs.state`), up to 6 per run, 6 hours back at most; a file
  still missing after 3 hours is skipped. Measured: ~1,700 articles/day from
  6 of the 12 publishers (Economic Times, Reuters, FE, NDTV Profit, CNBC-TV18
  and Indian Express aren't in GDELT's crawl); after the section allowlist
  (`PUBLISHER_SECTIONS`: business, economy, markets, world) and themes, ~75
  headlines/day. BigQuery holds the same data (same gaps) and needs an
  account, so it wasn't used. The same story on two sites is stored once
  (matching title within 2 days). Company matching: name, name without
  "India"/"Limited", a distinctive first word, and the ticker; acronyms and
  tickers only in capitals.
- **Headline rules:** headline, publisher, date and link only, never article
  text or images; GDELT credited on every list. Advice-style headlines (buy,
  sell, target, ratings, brokerage...) are dropped; headlines matching no theme
  (company news: no event type) are hidden, not shown without a line. Company
  headlines only for companies in the `companies` table (league companies).
- **BSE** has an announcements RSS, but it returns 403 to our honest user
  agent and BSE's terms forbid reproducing its material without written
  permission (checked 2026-11-10), so it isn't used.
- **NSE filings** come from NSE's official announcements RSS (latest ~40 filings
  only, so it is lossy at peaks; the panel says "filings we captured since" and
  links to NSE). Reachable from Vercel (tested). The job sends an honest
  "StacklyNews" user agent; locally that timed out once. Never switch to a
  browser user agent to get past a block (that is bot-check circumvention); if
  NSE keeps refusing, the panel's NSE link is the fallback Hriday approved.
  Confirmed 2026-11-11: from Vercel too, NSE times out for the honest agent
  (502 logged every run), so the job was cut from every 15 min to hourly.
- **RBI** press-release RSS, themed items only, minus routine notices
  (`RBI_ROUTINE`: auctions, money-market data, T-bills). RBI and NSE times
  without a zone are IST.
- **Macro:** World Bank Pink Sheet (monthly, CC BY 4.0, no key, read with
  `openpyxl`) for Brent, Australian coal, aluminium, iron ore, palm oil; FRED
  DEXINUS for USD/INR (public domain), "Coming soon" until `FRED_API_KEY` is set.
  FRED's Brent series is third-party copyrighted, so crude is the World Bank's.
  The 30-day lag applies: a daily value once its date is 30 days past, a monthly
  average once the month's last day is (`news.lag_points`). Gold left out.
- **World event cards** are admin-written (Admin > World events: title, date,
  sectors, "why it may matter" up to 200 characters, a longer "Why it
  matters" up to 800 characters and a cause-and-effect chain (schema v13),
  source link, pinned, show until), audited, with soft warnings for "will" or
  advice words.

## Research phase 3: profile, segments, peers, documents (2026-11)

- **Approved data lives in `app/company_profiles.py`** (segments with filed
  FY26 figures, single-business notes, IR and annual-report links, peers),
  approved by Hriday 2026-11-10 from `Areas/Pilot Companies.md`. Tests check
  that segments add up to filed revenue and that no profile links
  `marico.com/investorspdf/Annual_Report_2025-26.pdf`, which is **Marico
  Bangladesh's** report, not Marico Limited's. Maruti, Marico and Escorts have
  no reliable annual-report link (NSE archive file names can't be derived), so
  they show the IR page only. Jyothy's annual-report page didn't load when
  checked; left out.
- `services/company_profile.build_profile` assembles `CompanyFinancialsResponse.profile`:
  the approved card description (or Yahoo's `longBusinessSummary`, labelled
  "from Yahoo Finance"), headquarters/website/employees from Yahoo
  (`CompanyInfo.has_profile`; older cache rows refetch once), the next
  results date from our non-draft events, segments with shares, documents
  (IR, annual report, newest captured NSE results/commentary filings, all-filings link) and peers.
- **Peers**: per pilot company, else per sector (`SECTOR_PEERS`); every symbol
  checked live (LTIM.NS was dead). Each peer loads separately from
  `GET /api/peer/{symbol}` (rate-limited; same cache and 30-day price), eight
  ratios plus "Reported" when Yahoo already has the latest quarter-end.

## News cards and videos (2026-11)

- **Cards** (`components/news/NewsCards.tsx`): top story + grid, theme filter
  chips, our own theme icons (`ThemeIcon.tsx`) and colours (`--th-*` tokens,
  icons and tints only, text stays in text tokens), sector chips, relative
  time and "Why it matters" (below). Every card (news, video, filing, world
  event) has the same order and padding: source and time, headline (3 lines
  max), 2-line summary, "Why it matters", chips on the bottom edge.
- **Publisher icons are self-hosted** in `frontend/public/publishers/`
  (downloaded once, 2026-11-10), on a white plate (`--icon-plate`). No page
  makes a request to a publisher. Business Standard, Moneycontrol and NDTV
  Profit didn't serve one: lettered badge.
- **Videos** (`services/videos.py`, cron `/api/cron/videos`): eight
  allowlisted channels (`news_config.YOUTUBE_CHANNELS`, IDs verified against
  each channel's own feed; the NDTV main channel was a near miss for NDTV
  Profit) via the official YouTube Data API: uploads playlist (1 unit) + one
  durations call (1 unit) per run. Same theme/advice rules as headlines, plus
  war-and-supply videos need an economic word. Live streams skipped. Rows
  deleted after 30 days (YouTube developer policy). Skips without
  `YOUTUBE_API_KEY`. Measured yield is low (1 of ~120 recent videos matched):
  expect a few a day.
- **Thumbnails (2026-11-18, Hriday chose this):** the video job copies each
  video's thumbnail (i.ytimg.com hqdefault, JPEG, <=400 KB, 40 per run) into
  `news_video_thumbnails` (schema v15, deleted with its video by cascade at
  30 days) and `/api/videos/{id}/thumbnail` serves it (cached 6 h). Read as
  API data under YouTube's 30-day storage rule; YouTube's III.E.1 ("no
  caching audiovisual content") is ambiguous for stills, accepted risk.
  Cards fall back to our illustration without a copy. Each card credits
  "<channel> on YouTube" (YouTube policy III.F.2.a). Privacy Policy line
  updated to match (approved 2026-11-18; LEGAL_UPDATED 18 Nov 2026,
  TERMS_VERSION unchanged since nothing new is shared about visitors).
- **Privacy:** nothing loads from
  YouTube or Google until the visitor presses play, then the
  youtube-nocookie.com player loads (CSP `frame-src` allows only that). The
  Privacy Policy says so (LEGAL_UPDATED 11 Nov 2026, TERMS_VERSION 2026-11-11,
  so signed-in users agree once more). Checked in a browser: 0 requests to
  Google/YouTube before the click.
- **Input-price and war-and-supply videos need an economic word** in the title
  (`videos.NEEDS_ECONOMIC`): the first production run tagged "Deadly blast at
  Turkey steel factory" as steel prices. Each run also deletes stored videos
  that fail the current rule. First production run (2026-11-11 12:25 UTC): 3
  videos, ET Now, CNBC-TV18, DW News (the DW one is removed by the rule).

## "Why it matters" and the analysis (2026-11-11, approved)

- **Paragraphs and chains** (approved 2026-11-11, `Areas/News explanations`)
  live in `app/news_explanations.py`, copied word for word: 33 theme x sector
  pairs and 8 event types, the same coverage as the one-line sentences
  (`news_config.explanation_for`). Change wording only with approval.
- **Interaction** (`components/news/WhyItMatters.tsx`, click only since
  2026-11-11; hover was removed at Hriday's request): the one-line text is
  always shown, clamped to 2 lines. The "Why it matters" button
  (`aria-expanded`/`aria-controls`) opens, on click, Enter or Space, a glass
  popover with a ×, the chain and the paragraph (tooltip style and
  animation, portalled to `<body>`, above the button, flips below near the
  top, shifted to stay on screen, follows the button on scroll). Phones
  (no fine pointer) get a bottom sheet instead (tap outside, swipe down 80px
  with the distance kept in a ref, or Close). It closes on a second click,
  a click outside, Escape or ×; only one is open at a time (module-level
  `closeOpen`). Focus moves into it and returns to the button on Escape, ×,
  a second click or Tab out. No hover, no expand-in-place.
- **Phase 4 analysis** (`services/analysis.py`, `AnalysisPanel.tsx`, "What
  the numbers show"): the approved templates (`Areas/Analysis templates`)
  over figures already on the page, 7 sections plus up to 4 questions.
  Guards so a template can't say something false: G6 (one-off gain) only
  with a positive profit before tax; the DuPont driver sentences only with a
  positive ROE; V1 only with a positive P/E; M3 ("held roughly steady") only
  when all four quarters sit within 2 points. "a"/"an" before a percentage
  follows how the number is read (`a_pct`). V2 (P/E against the peers'
  median) is added on the page once 2+ peers with a positive P/E load
  (`usePeers` is shared with the peers table). Tests: `tests/test_analysis.py`.
- **Spacing**: panels stack with `--panel-gap` (the Research landing was
  missing its wrapper, so its panels touched); panels with stacked blocks use
  `.news-panel` (gap `--title-gap`, subsection titles get extra space above);
  card padding is `--card-pad`. News, video, world-event and analysis grids
  use `TileGrid` (no orphans; `pairOnPhones={false}` keeps one card per row
  on phones) with heights matched per row. A video alone in a wide row puts
  its poster beside the text (container query).

## Research workspace and driver worksheet (2026-11-13, phase A)

Plan and wording approved by Hriday 2026-11-13 (vault: `Areas/Research workspace
and AI tutor (plan, for approval)`, `Areas/Research workspace wording (for
approval)`). Phase B (the AI research tutor) is NOT approved yet: he decides
after a hosted side by side (Cerebras/Groq keys in `backend/.env`; never run
models on his Mac). Under-18s with consent pending will get no tutor.

- **Page** `#/workspace/<event>` (`components/workspace/WorkspacePage.tsx`,
  kept mounted like the company page; `keptPage` in `App.tsx`), opened from the
  company page ("Open research workspace" / "Continue research (n of 10 steps
  done)"). Ten steps, each: title + why, the data Stackly already has (reused
  panels in `StepData.tsx`), guiding questions, notes, "Mark as done".
  Desktop: step list on the left; 900px and below: all ten as numbers in a grid.
- **Wording** lives in `app/workspace_config.py` (steps, per-sector items) and
  `app/glossary.py` (14 new terms + the league's own metric/KPI definitions),
  copied word for word; change only with approval. Lines reused from earlier
  approvals are listed and checked against their sources in `test_workspace.py`.
- **Table** `research_workspaces` (schema v14): notes per step (jsonb, merged per
  step on save), done steps, worksheet (jsonb). `GET/PUT/DELETE /api/workspace/{event}`
  (`routes/workspace.py`, `services/workspace.py`). Private: no admin view.
  Deleted by "Clear this workspace" and by `delete_account`.
- **Who can save**: the same as forecasting (`forecast_eligibility`: terms,
  handle + age group, under-18 needs consent granted). Anyone can read every
  step and use the worksheet on screen; otherwise nothing is stored (worksheet
  kept in memory only, `lib/workspaceMemory.ts`, cleared on sign-out). The
  consent message is "Your notes will be saved once your parent's consent is
  recorded." Enforced on the server (403).
- **Lock**: notes and ticks stay editable after the lock; the worksheet is
  hidden and refused (409 `worksheet_locked` in the API, and the trigger
  `workspace_reject_late_worksheet` on the database clock).
- **Worksheet** (`lib/worksheet.ts`, tested): every input is the student's;
  revenue growth = (1 + volume) x (1 + price) - 1 (IT: constant currency x
  currency effect); margin = 1 - (1 - start) x (1 + cost) / (1 + price) + other
  (IT: start + points adjustments); KPI = the student's volume (IT: CC growth);
  autos units helper from three monthly releases. **Starting margin options are
  league figures only**: last year's same quarter, last quarter only when the
  league has that quarter under the same definition, or the student's own.
  Yahoo's margin is never offered (different definition). "Use as a starting
  point" puts result ± "how unsure" into the forecast form's unsaved draft
  (`lib/forecastDrafts.ts`, `fromWorksheet`) and jumps to the form, which says
  "Started from your worksheet. Change anything before you save." The Python
  mirror of the formulas in the plan is deferred to phase B (only the tutor
  would need it).
- Autos "sales release" links per company are waiting for approval (vault:
  `Areas/Autos sales-release links (for approval)`); not wired in.
- Privacy Policy gained the workspace lines (LEGAL_UPDATED 13 Nov 2026,
  TERMS_VERSION 2026-11-13, so signed-in users agree once more).

# CLAUDE.md

Guidance for Claude Code (and any future contributor) working in this repository.


**Stackly**: a free web app where students forecast Indian listed companies'
quarterly results as 80% ranges and get scored (the Results League), with
Practice on past quarters, a 10-page guide (#/learn) and a Research page.
FastAPI backend (`backend/`), React + Vite frontend (`frontend/`), Neon
Postgres, one Vercel project. Live at stackslymetrics.com.

**This file is the index (split 2026-11-25, master plan Z1).** The detail,
moved word for word, lives in topic files. Read the ones your task touches
before changing code there:

| File | What's in it |
|---|---|
| [docs/claude/architecture.md](docs/claude/architecture.md) | What the project is, backend and frontend layout, data-source abstraction |
| [docs/claude/guide-practice.md](docs/claude/guide-practice.md) | The first-visit guide (#/learn: layouts, motion, objects) and Practice (mystery mode, attempts) |
| [docs/claude/design.md](docs/claude/design.md) | Voice and wording rules, the design passes (flat and sharp, Redesign v3, older Liquid Glass history), responsive rules, chart theming, Return Calculator history |
| [docs/claude/research-news.md](docs/claude/research-news.md) | Ratios and history, news, world events, macro, profiles and peers, videos, 'Why it matters', the analysis, the research workspace and worksheet |
| [docs/claude/hidden-tools.md](docs/claude/hidden-tools.md) | Market Simulator and Paper Trading (behind SHOW_EXTRA_TOOLS), removed homepage recommendations and health snapshot |
| [docs/claude/accounts-privacy.md](docs/claude/accounts-privacy.md) | Accounts, sessions, Google sign-in, forgot password, privacy, consent and security, the visit counter |
| [docs/claude/data-sourcing.md](docs/claude/data-sourcing.md) | Keyless cache-first sourcing (yfinance), renamed tickers, rate limiting, removed Tapetide history, the 30-day share-price lag, known constraints |
| [docs/claude/deploy-env-testing.md](docs/claude/deploy-env-testing.md) | Environment variables, deployment (Vercel, aliases, the 2026-09-29 incident), testing (local Postgres, guards, Vitest) |
| [docs/claude/league-scoring.md](docs/claude/league-scoring.md) | Events, forecasts, scoring and the lazy guess, results pages, reviewing and approving results |

## Rules that apply to every change

- **Wording**: new or changed user-facing text is drafted in the vault for
  Hriday's approval first; approved text is copied word for word. Voice: a
  curious 14-year-old, formal not cute; no em dashes, exclamation marks,
  emojis, "Surprise me" or buzzwords (docs/claude/design.md).
- **Data and safety**: Claude never writes results to the production
  database (proposal files + Hriday's Approve button only); never works
  around `STACKLY_DATABASE_URL` (Sensitive); never prints or commits secrets;
  no money or prizes; no buy/sell/hold advice or price targets; share prices
  at least 30 days old; league and practice answers use league figures only,
  never Yahoo; consent-pending under-18s save nothing.
- **Gold** means "yours" (your range, your score). Difficulty colour: emerald
  Easy, cobalt Medium, violet Hard. Motion only explains or answers an action;
  everything is calm under reduced motion.
- **Git**: one branch per piece of work; never `git stash` (it once silently
  lost work); push branches; merge to master and deploy only after Hriday
  writes "approved, deploy".
- **Schema changes need a `SCHEMA_VERSION` bump** in
  `backend/app/services/db.py`, or deployed databases skip them.
- **Root `requirements.txt` must match `backend/requirements.txt`**
  (`tests/test_requirements_sync.py`).
- **Machine**: a fanless 8 GB MacBook Air. One heavy job at a time (tests,
  build or browser), no local AI models; stop every server you start.

## Commands

- Backend tests (local Postgres, ~35 s): `cd backend && scripts/test_local.sh -q`
- End-to-end core loop (before every deploy):
  `E2E=1 scripts/test_local.sh tests/test_e2e_core_loop.py`
- Frontend: `cd frontend && npm test` (Vitest) and `npm run build` (strict tsc + vite)
- Visual baselines (on demand): `cd frontend && npm run test:visual`
- Staging: `vercel deploy --yes` gives a preview on the dev database
- Deploy (only after "approved, deploy"): merge to master, push,
  `vercel deploy --prod --yes`, `vercel alias set <url> stackly-metrics.vercel.app`,
  check `/api/health` says "production" on stackslymetrics.com,
  finai-metrics.vercel.app and stackly-metrics.vercel.app, smoke-check the
  pages with writes blocked, and roll back at once if anything fails
  (docs/claude/deploy-env-testing.md).

## Master plan (2026-11-24, in progress)

Hriday's plan and audit are in the vault: `Areas/Stackly master plan (24 Nov)`,
`Areas/Site audit (24 Nov)` (225 IDs); per-ID status in `Areas/Master plan
progress` (read it first when told "continue the master plan"); open
decisions in `Areas/Decisions for Hriday (master plan)`. One branch per phase
(`phase-0`, `phase-1`, ... each from the previous), pushed. Phases 0 and 1
were deployed 2026-11-24 (rollback target stackly-i5q2pqoj5).
Never `git stash`. Things the code now relies on:

- **Root `requirements.txt` must list everything in `backend/requirements.txt`**
  (`tests/test_requirements_sync.py`). It lacked `openpyxl`, so the macro cron
  failed daily from at least 2026-11-20.
- League figures only next to league numbers: `lib/leagueFormat.ts`
  `leagueSeries` / `latestLeague` / `lastYearValues` / `scaleAround`; Yahoo's
  margin is no longer shown beside the league's (Research keeps Yahoo ratios).
- News: `news_config.BLOCKED` drops violent headlines; `sectors_for` tags a
  sector only when the headline names it; stored rows are re-checked at read
  (`news._still_fits`). News videos are off unless `ENABLE_NEWS_VIDEOS=true`.
- Addresses: `#/research` and a `notfound` route; Home/Practice/Research tabs
  are links (`Sidebar` `hrefs`), the view follows the address.
- Sheets use `hooks/useSheet.ts` (Escape, focus trap, inert page, focus back);
  layers use the `--z-*` tokens in theme.css.
- "Forgot password?" shows only when the build has `VITE_RESET_EMAIL=true`.
- `scoring.explain_crowd` returns "" below the crowd minimum (never a count).

## Running locally

See `README.md` at the project root for full setup/run instructions
(dependency installation, `.env` setup, dev server commands for both
backend and frontend).

## Conventions

- Backend: Python, type-hinted, Pydantic models for all API request/response
  shapes. FastAPI route handlers stay thin — business logic lives in
  `services/`.
- Frontend: TypeScript, functional components + hooks, no class components.
- Keep comments minimal and focused on *why*, not *what* — code should be
  self-explanatory via naming.
  
## Second brain (codebase map + logs)

A maintained knowledge map of this codebase lives at:
/Users/hriday/Documents/Second Brain - Obsidian/Second Brain/Projects/finai-metrics/

- 02_wiki/00_Codebase_Root.md is the index. At the start of a session,
  READ IT FIRST to orient before grepping or reading many source files —
  it summarizes the architecture, data flow, and where things live, which
  is cheaper than re-scanning the tree.
- 03_logs/ holds dated session logs. After making meaningful changes in a
  session, append a dated log entry there describing what changed and why,
  following the existing log format, so the next session has continuity.
- The map is only accurate if 01_raw/ is refreshed. If the map seems to
  contradict the actual code, the code wins — flag the discrepancy in the
  log and tell me to re-run the rsync refresh (command is in the brain's
  PROJECT.md).
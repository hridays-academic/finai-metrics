<!-- Moved word for word from CLAUDE.md on 2026-11-25 (master plan Z1). The index is CLAUDE.md. -->
# Deploy, environment and testing

## Environment variables

Backend reads from `backend/.env` locally (see `backend/.env.example`), or
from Vercel project environment variables in production:

- **`STACKLY_DATABASE_URL` — Production only, set in Vercel to the Neon
  `main` branch's pooled string. When set it wins over `DATABASE_URL`
  (`config.effective_database_url`).** It exists because the Neon
  integration manages `DATABASE_URL` itself (one value for Production,
  Preview and Development) and on 2026-09-29 re-pointed it at the `dev`
  branch, so the live site ran on dev until 2026-10-02 (see "Incident
  2026-09-29" below). Never print or log either value. Never set
  `STACKLY_DATABASE_URL` locally; tests strip it.
- `DATABASE_URL` — required. Neon Postgres connection string (free tier, no
  credit card) backing user accounts, sessions, activity logs, and Tapetide
  quota tracking — see "Deployment" and "Accounts & activity tracking"
  above. Use the **pooled** connection string, not the direct one.
- `ENCRYPTION_KEY` — **no longer used** (2026-09). It only encrypted saved
  Tapetide keys, which were removed. Already gone from `backend/.env`;
  delete it from Vercel too.
- `TEST_DATABASE_URL` — local only, the Neon `test` branch. See "Testing".
- `IP_HASH_KEY` — Production. Secret key for hashing IPs/emails in
  `rate_limit_buckets`. Never print it. Without it each process invents one.
- `ENABLE_PAPER_TRADING` — off by default (2026-11); see "30-day share-price lag".
- `ENABLE_GUIDE` (default false), `GUIDE_MODE_DEFAULT` (default off; previews
  only), `GUIDE_FAKE_MODEL` (never in Production: refused on the production
  database), `ANTHROPIC_API_KEY` (Sensitive; never print it), `GUIDE_MODEL`
  (default claude-haiku-5-5), `GUIDE_INFERENCE_GEO` (default us),
  `GUIDE_DAILY_QUESTIONS` (20), `GUIDE_PER_MINUTE` (6),
  `GUIDE_DAILY_SPEND_USD` (3). The AI guide; see architecture.md.
- `PUBLIC_ORIGINS` — origins a password-reset link may use (has a default).
- `GOOGLE_CLIENT_ID` — required for Google Sign-In to work (see "Google
  Sign-In" below). Must be the exact same value as the frontend's
  `VITE_GOOGLE_CLIENT_ID` (a public OAuth Client ID, safe in frontend
  bundle code — this is the ID-token flow, no client secret anywhere).
  Without it, `/api/auth/google` returns a clean 503 rather than crashing.
- `GMAIL_ADDRESS` / `GMAIL_APP_PASSWORD` — optional, together power "forgot
  password" reset emails via Gmail's own SMTP (see `gmail_service.py` and
  "Forgot password" above) rather than a third-party email provider.
  `GMAIL_APP_PASSWORD` must be an App Password
  (https://myaccount.google.com/apppasswords), never the account's real
  password -- Google blocks plain-password SMTP auth by default, and
  requires 2-Step Verification to be turned on first before it'll issue
  one. `GMAIL_ADDRESS` becomes the visible "From" on every reset email.
  Without both set, forgot-password requests still return the same
  generic success response (never leaks whether an email has an account)
  — the send failure is just logged server-side instead of an email
  actually going out.
- **No Tapetide key here** — see "Optional bring-your-own Tapetide key" above.
  Every user supplies their own via the website, sent per-request as the
  `X-Tapetide-Token` header, never a `.env` secret.
- `ALPHA_VANTAGE_API_KEY` / `FMP_API_KEY` — optional, only needed if you swap
  the data provider to one of these instead.
- `DEV_CACHE_DIR` — optional, **dev-only**, shared by both `TapetideProvider`
  and `BharatSMProvider` (2026-07 -- was `TAPETIDE_CACHE_DIR`/Tapetide-only
  before Bharat became the fundamentals source for every search; renamed
  once a second provider needed the same treatment). Each caches its own
  real network calls to disk under this one directory and serves repeat
  calls (same call + same arguments) from there instead of hitting the
  network — set locally to `.tapetide_cache` so testing the same symbol
  repeatedly doesn't burn Tapetide's free tier (50 calls/day) or wait on
  Bharat's slower per-call fetches. The two providers can't collide despite
  sharing a directory: Tapetide's files are unprefixed JSON (unchanged
  format, so pre-existing cache entries stay valid across the rename);
  Bharat's are pickled (its calls return pandas DataFrames, not JSON-shaped
  dicts) and prefixed `bharat__`. Only successful responses are ever
  cached, never a quota-exceeded error or other failure, so a temporarily-
  exhausted quota (or a flaky Bharat call) can't get "stuck" cached as a
  fake failure. **Never set this in a real deployment** — it would silently
  serve stale financial data to end users, the same class of mistake this
  codebase avoids everywhere else (see `tapetide_provider.py`'s docstring).
  Delete `backend/.tapetide_cache/` (gitignored) to force fresh data for
  both providers, or just the `bharat__*` files to refresh only fundamentals.

Never commit `.env`. Never hardcode keys in source. The frontend has no env
vars containing secrets — it only needs the backend's base URL.


## Deployment

(2026-07) Deployed as a single Vercel project -- both the frontend and the
backend, not split across two services. This follows directly from
`lib/api.ts`'s `BASE_URL = "/api"` already being a same-origin relative
path (written that way for the dev proxy in `vite.config.ts`, but it works
unchanged in production too as long as both pieces share one domain).

**Live at the custom domain `stackslymetrics.com`** (2026-09); the
`stackly-*.vercel.app` aliases below still serve the same deployment.

**stackslymetrics.com is blocked by at least one network's web filter**
(found 2026-10-16: a FortiGuard-style "Web Filter Violation" page,
category "Unrated" -- the domain is new, so filters haven't classified it).
Schools are exactly the kind of network that filters, so check this before
the January school pilot: ask the school's IT to allowlist the domain, or
submit it for categorisation with the filter vendor. When the custom domain
is blocked, use `finai-metrics.vercel.app` (a production alias that follows
every `--prod` deploy) for `/api/health` checks. `stackly-metrics.vercel.app`
is a manual alias that does NOT follow deploys: it was left on an old,
broken deployment (500 `FUNCTION_INVOCATION_FAILED`) until 2026-10-19, when
it was re-pointed with `vercel alias set`. Re-point it after each deploy,
or ignore it.

**Incident 2026-09-29 -> 2026-10-02: production ran on the dev database.**
The Neon integration recreated `DATABASE_URL` for all environments
pointing at `dev` (around when the dev/test branches were created and
`main`'s password was rotated). Every deploy after that read and wrote dev:
two real Google accounts and their searches landed there (since deleted
from dev; not copied to production). **Earlier notes claiming the league
migrations and the Tapetide cleanup ran on production were wrong** -- they
ran on dev; production was migrated (none -> v5, Tapetide column/table
removed) only on 2026-10-02, confirmed from its startup log. Safeguards
since: `STACKLY_DATABASE_URL` (above); a production deployment refuses to
start on a database labelled `dev`/`test`; `/api/health` reports the
database label (`production`/`dev`/`test`, never the URL); migrations log
before/after version and Tapetide state. **After every deploy, check
`/api/health` says `"database": "production"`.**

**Deploying = `vercel deploy --prod --yes` from the repo root. Pushing to
GitHub does NOT deploy.** The Vercel project ("stackly") is linked to this
folder via `.vercel/project.json` and is not Git-connected -- confirmed
2026-09-29, when a push produced no deployment at all. Push too (so GitHub
matches production), but a commit is only live once you've run the CLI
deploy. `.vercelignore` keeps `.env` files, venvs, tests and `node_modules`
out of the upload; don't delete it. To verify a deploy, compare the
`/assets/index-*.js` hash served by stackslymetrics.com with
`frontend/dist` after a local `npm run build` -- identical source builds to
the identical hash. Runtime logs: `vercel logs <deployment-url> --json`.

**Previously live at `stackly-metrics.vercel.app`** (2026-08, renamed from
`finai-metrics.vercel.app` alongside the app's own rename -- see "What this
project is" above). The Vercel *project* itself was renamed again shortly
after, from `stackly-metrics` to `stackly` (dropping "Metrics" everywhere,
including the dashboard), but the serving domain deliberately did NOT
follow -- same "rename doesn't move the alias" behavior below, re-confirmed
a second time, plus `stackly.vercel.app` still being someone else's site
(see below) means there was no shorter domain to move to anyway. Don't
expect the live URL to say just "stackly" without a fresh `alias set`.
Two things worth knowing if this ever needs touching again:
- **Renaming a Vercel project (`vercel project rename`) does NOT move its
  production `*.vercel.app` alias domain.** Confirmed live: after renaming
  the project, `vercel deploy --prod` kept aliasing to the *old* domain
  (`finai-metrics.vercel.app`) — the new name only changed the project's
  internal label/dashboard identity and its auto-generated per-deployment
  preview URLs. Claiming the new domain needed an explicit
  `vercel alias set <deployment-url> stackly-metrics.vercel.app`. Also
  confirmed live: `stackly.vercel.app` (the first choice) turned out to
  already be a real, unrelated site owned by someone else -- `*.vercel.app`
  subdomains are global across all Vercel accounts, not scoped per-user, so
  short/generic names can't be assumed free without checking first.
- **A manually-`alias set` domain isn't automatically exempt from SSO
  deployment protection the way a project's original default domain is.**
  `stackly-metrics.vercel.app` 302-redirected to a `vercel.com/sso-api`
  login gate on first check, even though `finai-metrics.vercel.app` (the
  original, Vercel-auto-provisioned production alias) never did — this
  project had `ssoProtection: "all_except_custom_domains"` set (from
  project creation), and an ad-hoc `.vercel.app` alias apparently doesn't
  count as a "custom domain" for that exemption the way the project's
  original auto-assigned domain did. Fixed with
  `vercel project protection disable <project> --sso` -- appropriate here
  since this is meant to be a public site with no visitor-facing
  authentication gate of its own beyond the app's own sign-in.

- **Frontend**: built via `vercel.json`'s `buildCommand`
  (`cd frontend && npm install && npm run build`) and served as a static
  site from `frontend/dist`.
- **Backend**: `api/index.py` is the one file Vercel's Python builder needs
  -- it just puts `backend/` on `sys.path` and re-exports FastAPI's `app`
  object from `main.py` unchanged (FastAPI is ASGI, which Vercel's Python
  runtime handles natively, no adapter). `vercel.json` rewrites every
  `/api/*` request to this one function while preserving the original path,
  so FastAPI's own route decorators (already written as e.g.
  `"/api/company/{query}"`) match exactly as they do locally. A root-level
  `requirements.txt` (`-r backend/requirements.txt`) exists only because
  Vercel's Python builder looks for that file at the project root --
  `backend/requirements.txt` stays the real, single source of truth.
- **Why not two separate services** (frontend on Vercel, backend on
  something else): investigated first. Every free tier with a real
  persistent disk (Render, Fly.io, Railway) either dropped its free tier
  entirely (now requires a card) or never had persistent storage on the
  free plan to begin with (Render's free web services have an ephemeral
  filesystem with no disk add-on available) -- see the Postgres migration
  below for how persistence is actually handled instead. Once storage
  no longer needs local disk, running the backend as Vercel functions
  alongside the frontend is simpler than managing two platforms, and avoids
  CORS entirely (same origin).
- **The Vercel account is on the Pro plan** (verified via the Vercel API,
  2026-09-30 -- older notes here said Hobby). Pro bills metered usage beyond
  its included credit, so check the cost of any usage-billed Vercel feature
  (e.g. Web Analytics) with the user before enabling it.
- **`vercel.json`'s `maxDuration: 60`** gives headroom for `/api/company`'s
  worst case (an uncached yfinance fetch) rather than the platform default.
- **Persistence moved to Neon Postgres** (see "Accounts & activity
  tracking" and the quota-tracking section above) specifically because
  Vercel's serverless functions have no persistent local filesystem --
  anything written to disk (the old SQLite file, the old quota-tracking
  JSON file) is wiped on every cold start/redeploy. Neon's free tier is
  permanent and needs no credit card, unlike every "backend host with a
  real disk" option that was considered first.
- **`DATABASE_URL`** must be set as a Vercel project environment variable
  (Project Settings -> Environment Variables), using Neon's **pooled**
  connection string (the `-pooler` hostname, backed by PgBouncer) rather
  than the direct one -- this app opens a fresh `psycopg` connection per
  request (see `db.py`), which is exactly the "many short-lived serverless
  connections" pattern the pooler exists for.
- No Tapetide key is ever a Vercel env var, same as it never was a
  `backend/.env` var -- see "Optional bring-your-own Tapetide key" below.

## Testing

(2026-09) **Backend: pytest, in `backend/tests/`.** Install the dev-only
dependencies with `python -m pip install -r requirements-dev.txt` (Vercel
never installs that file), then run `python -m pytest` from `backend/`.

**Run them locally: `scripts/test_local.sh -q` from `backend/` (2026-11-18,
Hriday: "fasten it up").** It starts a local Postgres 17 (Homebrew
`postgresql@17`, matching Neon's 17.x, port 54329, durability off since the
data is throwaway), labels its `stackly_test` database 'test' in
`stackly_env`, runs pytest with `TEST_DATABASE_URL` pointed at it, and stops
Postgres afterwards. Full suite: 32 s locally vs ~30 min against the Neon
`test` branch from India (0.3 s per round trip). The conftest guard is
unchanged and applies the same way. The Neon `test` branch (in
`backend/.env`) still works with plain `python -m pytest` if a Neon-specific
check is ever needed.

- **Pure tests** (`test_scoring.py`, `test_league_config.py`) need no
  database.
- **Test events use `tests/future_dates.py`** (IST today + 60 days), never
  a fixed results date: a hard-coded 2026-11-20 broke 41 tests once it
  passed (the default lock was then in the past).
- **Database tests** run ONLY against the Neon `test` branch
  (`TEST_DATABASE_URL` in `backend/.env`). They truncate tables. The guard in
  `tests/conftest.py` refuses to run unless that URL differs from
  `DATABASE_URL` AND the database's `stackly_env` table says `test`.
  Production has no `stackly_env` table, so a pasted-wrong connection string
  still can't reach it. Never weaken this guard.
- Neon branches: `main` = production (its URL lives only in Vercel, managed
  by the Neon integration -- never edit it); `dev` = local development
  (`DATABASE_URL` in `backend/.env`, labelled `dev`); `test` = tests
  (labelled `test`). Both are schema-only copies with no user data.
- **Before any local test, confirm which database the running server is
  connected to.** Check who owns the port (`lsof -nP -iTCP:8000
  -sTCP:LISTEN`) and look for the startup log line `Local server using the
  Neon 'dev' database`. On 2026-09-30 a server started on 2026-09-13 was
  still holding production's string, and a local test created a real
  account in production. Since then `db.init_db()` refuses to start any
  non-Vercel server whose database isn't labelled `dev`/`test`
  (`_refuse_unlabelled_database_locally`; Vercel deployments are exempt via
  the `VERCEL=1` system env var, which this project exposes).
- From India each round trip to Neon (US East) takes ~0.3s, so the database
  tests take a few minutes locally. That's latency, not a hang.
- **Per-test limit (2026-11-13):** `pytest-timeout` (dev only), 600 s per test,
  signal method, so a hung Neon connection fails one test instead of stalling the
  run for hours. Test connections also get `connect_timeout` and TCP keepalives
  (conftest adds them to TEST_DATABASE_URL; the "test URL differs from
  DATABASE_URL" guard still compares the URL as configured).
- **Faster database tests (2026-11-13):** a new TLS connection to Neon costs
  ~2.3 s from India, and the app opens one per `get_conn()`. conftest now
  reuses `get_conn()` connections (each use still commits or rolls back its own
  transaction; nested calls get separate connections; the app has no
  connection-level state) and each test's label check, wipe and `conn` share one
  connection. The 7 workspace DB tests went from 8.4 to under 3.6 minutes.
- **Local DNS:** if the Neon test host won't resolve, pin its address in the URL
  for that run (libpq `hostaddr=`, from `dig @1.1.1.1 <host>`); `PGHOSTADDR`
  alone wasn't enough (psycopg still looked the name up and tests hung).

Several older sections above describe tests as though they were permanent
artifacts ("unit-tested", "verified with a mocked-clock test"). Those were
throwaway scripts, run once and discarded -- don't go looking for them.

**Frontend: Vitest (since 2026-11-12), plus the build.** `npm test` runs
Vitest; test files sit next to their component (`*.test.tsx`) and opt into
jsdom with a `// @vitest-environment jsdom` first line (no vitest config).
Testing Library renders components with `lib/api` mocked via `vi.mock`.
Dev dependencies only (vitest, jsdom, @testing-library/react + dom); nothing
ships in the bundle. 121 tests (2026-11-24; 63 on 2026-11-17): results/outcome pages, the guide, the
workspace, RangeLine, the company story (poses, zoom), the sidebar, the
difficulty rule, the ball store and the ratio bars. The outcome test's
`lib/api` mock must list every call the company page makes (it gained
`fetchPriceHistory` for the story's share price chapter).
`npm run build` (strict `tsc -b` plus `noUnusedLocals`/`noUnusedParameters`,
which also type-checks the test files) is still the main check. Untested
pure functions worth covering next: `lib/portfolioHistory.ts` (already had
one off-by-one-day bug) and `lib/marketHolidays.ts` (IST dates).

<!-- Moved word for word from CLAUDE.md on 2026-11-25 (master plan Z1). The index is CLAUDE.md. -->
# Architecture

## What this project is

**Stackly** (renamed 2026-08 from "FinAI Metrics", briefly "Stackly
Metrics" in between -- same app, no functional change through either rename;
older comments/history throughout this file still say "FinAI Metrics" or
"Stackly Metrics" in places, left as-is rather than rewritten purely for the
name) — a web app that fetches financial data for Indian public listed
companies (NSE/BSE) and computes standard financial ratios, with hover
popovers explaining what each metric means and whether the company's actual
value is healthy, a zoomable/pannable ~5-year weekly price history chart, a **separate** Share
Price Forecast chart (analyst-target fan: High/Mean/Low dashed lines from
today's price to the target date — deliberately its own card, not overlaid
on the price history chart, where a ~9-month-out fan was an imperceptible
sliver against 5 years of history), and third-party analyst consensus
(rating breakdown + price target range). Before any search, the empty state
is just a plain "search a company" prompt -- it briefly showed a
daily-rotating set of "recommended" companies, removed 2026-08 (see
"Homepage recommendations" below for why).

**On "analyst consensus" vs. the app's own opinion:** the backend's
`compute_health_snapshot` (our own verdict on the ratios it computed) and
`AnalystConsensus` (sell-side analysts' verdict, reported as-is) are
fundamentally different things, even though the health-snapshot verdict is
no longer surfaced in the UI (see "Financial Health Snapshot" below) --
FinAI Metrics describing the ratios it computed vs. third-party data we're
relaying with attribution. Never blend them into a single "FinAI Metrics
says" framing, and never let the app generate its own buy/sell/hold call —
see the "AI assistant" section below for why that line is a hard one.

The `AnalystConsensus` model carries both `buy`/`hold`/`sell` (raw analyst
counts) and `buy_pct`/`hold_pct`/`sell_pct` (percentages) -- the frontend
(`AnalystConsensus.tsx`) deliberately displays only the percentages in the
rating-breakdown legend, per user request, not because the counts are
unavailable. Keep both fields on the backend model regardless (the "Based
on N analysts" line still needs the total, and a future UI change might
want the split again).

`target_date` on the same model is a machine-readable "YYYY-MM-DD" (last
day of the forecast period's month) alongside the human-readable
`target_period` string -- it exists specifically so `PriceChart.tsx` can
plot the forecast fan's endpoint on the time axis; don't remove it as
"redundant" with `target_period`.

The old AI chat assistant (`/api/chat`, Moonshot/DeepSeek/Claude backends) was retired in phase 12 (2026-11-27); the AI guide replaces it (below).

## Architecture

Two independent services, run separately in development:

```
backend/    FastAPI (Python) — data fetching, ratio calculations, the league, the AI guide (off by default)
frontend/   React + Vite (TypeScript) — dark-mode-first, full-width metrics dashboard
```

The backend is the only thing that talks to external APIs (Yahoo via yfinance, Anthropic for the guide).
The frontend never sees API keys — it only calls the local backend.

### Backend layout

```
backend/app/
  main.py                 FastAPI app, route wiring, CORS
  config.py               Env var loading (.env) via pydantic-settings
  models.py                Pydantic response/request schemas
  services/
    data_provider.py       Abstract base class for a financial data provider
    yfinance_provider.py   The only data provider (Tapetide was removed 2026-09) --
                            fundamentals, price history, analyst consensus, and
                            Paper Trading's live quote polling + intraday chart (see
                            get_live_quote/get_intraday_history and the "Paper
                            Trading" section below), which has no Tapetide
                            equivalent at all
    bharat_sm_provider.py  Not wired into main.py anymore (see "Sourcing" below) --
                            kept as a dormant, fully-implemented provider in case
                            Tickertape's IP block on Vercel ever lifts
    metrics.py              Pure functions: computes ratios from raw financials
    guide.py, guide_context.py, guide_model.py   The AI guide (phase 12, off by default)
    db.py                    Postgres (Neon) connection + schema (users, sessions,
                              activity_log, tapetide_quota)
    auth_service.py          Signup/login/sessions/activity logging -- see
                              "Accounts & activity tracking" below
    gmail_service.py          Sends password-reset emails via Gmail's own SMTP --
                              see "Forgot password" below
```

**Data source abstraction is intentional.** `data_provider.py` defines
`FinancialDataProvider` (ABC) with `resolve_symbol`, `get_company_info`,
`get_raw_financials`, `get_price_history`, `get_recent_price_history`, and
`get_analyst_consensus`. `TapetideProvider` is the primary implementation
for price history/analyst consensus. Do not let provider-specific types/
objects leak past this layer — always return the shared `CompanyInfo`/
`RawFinancials` models.

> **SUPERSEDED (2026-09): read "Keyless, cache-first sourcing" below
> first.** yfinance is the primary source now and no key is required. The
> Tapetide-primary account that follows is kept because it explains *why*
> sourcing moved around (Tickertape's IP block, the quota arithmetic) --
> not because it still describes today's behaviour.

**Sourcing (revised 2026-07): Tapetide serves fundamentals, price history,
AND analyst consensus for `/api/company` and `/api/price-history` — not
Bharat-SM-Data.** This reverses the "hybrid sourcing" design described
below in the git history: `bharat_provider` (Bharat-SM-Data, wrapping
Tickertape's public JSON API) briefly served company info + raw financials
for every search, free and unmetered, with Tapetide reserved for the two
things Bharat structurally couldn't provide. That broke the moment the app
deployed to Vercel — **Tickertape 403-blocks Vercel's cloud IP range** for
its search/profile endpoints (confirmed live: every `/api/company` request
came back a 502, `bharat_provider.resolve_symbol` raising
`DataProviderError` with a `too many 403 error responses` cause), the same
anti-bot posture already documented below for NSE's price-history API, just
hitting the fundamentals path too this time. Tapetide, being a real metered
API rather than a scraper, is unaffected (confirmed reachable from Vercel).
`bharat_provider`'s last remaining caller, `get_recommendations` (the
homepage suggestions), was removed (2026-08, see "Homepage recommendations"
below) — `bharat_sm_provider.py` is now not wired into `main.py` at all,
kept only as a dormant, fully-implemented provider (same "kept but not
currently wired in" pattern)
in case Tickertape's block ever lifts. Don't route `/api/company`/
`/api/price-history` back through Bharat-SM-Data without first re-verifying
Tickertape's block is gone (the same discipline this file already asks for
NSE's block on price history).

- `GET /api/company/{query}` **no longer requires a key at all (2026-09)**
  -- the 400 below was removed; see "Keyless, cache-first sourcing". The
  account that follows describes the 2026-07..09 Tapetide-primary design:
  it required a Tapetide key (400 if missing —
  this is new; the old Bharat-only fundamentals path never needed one).
  Fetches `info`/`raw` via `TapetideProvider(tapetide_token)`, falling back
  to `fallback_provider` (yfinance) on `ProviderQuotaExceededError` — same
  fallback shape `/api/price-history` already used. Analyst consensus stays
  best-effort and reuses the *same* `TapetideProvider` instance (its
  `_profile_cache` means fetching it costs only one more call,
  `get_forecasts`, not a second profile fetch) — skipped entirely if
  fundamentals already exhausted this key's quota this request, rather than
  constructing a fresh instance that would just fail again while also
  falsely inflating the local call counter (see `_call_tool`'s counter,
  which increments before the network request even fires).
- `GET /api/price-history/{symbol}` **also keyless as of 2026-09** (same
  removal). Historically it required a Tapetide key (400
  if missing), always tries Tapetide first, falling back to
  `fallback_provider` (yfinance) on `ProviderQuotaExceededError`
  (`DataProviderError`'s quota-specific subclass; `tapetide_provider.py`
  raises it from `_call_tool` for both known quota signals — HTTP 429, and
  the plain-text-instead-of-JSON response body). If both providers fail,
  the endpoint returns a 502; an invalid key specifically
  (`InvalidTapetideKeyError`) returns 401.

`info.resolved_symbol` -- Tapetide's own plain ticker (e.g. `"RELIANCE"`,
from its `get_company_profile` response) -- is what gets chained into
`/api/price-history/{symbol}` (called by the frontend with this same
value).

`CompanyFinancialsResponse.consensus_source: "tapetide" | "yfinance" | None`
and `PriceHistoryResponse.active_source: "tapetide" | "yfinance"` report
which provider served each of those two pieces (`DataSourceName` enum --
Bharat isn't a member). There's no equivalent `fundamentals_source` field
even though fundamentals can now genuinely come from either Tapetide or the
yfinance fallback, same as price history -- nothing in the frontend has
ever needed to distinguish that for fundamentals specifically, so it was
never added; add one if that changes. Neither existing field drives any UI
control anymore (no dropdown to reflect them into) -- their only remaining
job is populating `tapetide_reset_at` when a fallback happens, which feeds
`CompanySearch.tsx`'s "Tapetide resets in Xh Ym" countdown
(`TapetideResetCountdown`, self-updating every 60s).

Any *other* `DataProviderError` (network failure, bad token, upstream 5xx)
deliberately does NOT trigger the yfinance fallback for either endpoint —
those aren't "the quota is exhausted," and silently serving less-reliable
scraped data for them would mask real outages. Because yfinance is a live
runtime dependency (not just an optional reference provider), it's pinned
in `requirements.txt`. Yahoo Finance's own undocumented crumb/rate-limit
gate is still real (see `yfinance_provider.py`'s docstring) — the fallback
can itself fail, in which case both endpoints return a 502 rather than
fabricating data.

**`GET /api/quota`** still requires a Tapetide key (400 if missing) --
correctly so, since there is no quota to report without one, and the
frontend simply doesn't call it when no key is stored. See
"Optional bring-your-own Tapetide key" below) and returns `QuotaStatus`: a *local
estimate* of THAT key's calls used/remaining today, since Tapetide exposes
no server-side "calls remaining" API of its own. `TapetideProvider` counts
every real `_call_tool` invocation (`get_quota_status()`; dev-cache hits
from `DEV_CACHE_DIR` do NOT count, since those never reach the network),
reset at local midnight -- the same cadence as Tapetide's own quota reset.
**The count is persisted to the `tapetide_quota` Postgres table (Neon, see
"Accounts & activity tracking" below), keyed by a hash of the token, on
every increment, not just kept in memory** -- without this, any process
restart (uvicorn `--reload` firing on a routine `.py` edit during dev, a
serverless cold start, or any redeploy in production) would silently zero
out "calls used today" back to the full quota, understating real usage
right up until Tapetide's own 429 catches you by surprise. This was a local
JSON file (`backend/.tapetide_quota_state.json`) before the app moved to
Vercel (2026-07) -- serverless functions have no persistent filesystem, so
that file was silently wiped on every cold start, same problem the old
SQLite file had. Keyed by token hash (never the raw token) specifically
because every user has their own key now: a single shared counter (the
pre-multi-user design) would blend everyone's usage into one number, which
is worse than useless once each person's key has its own independent
50-calls/day budget. This is separate, always-on bookkeeping, deliberately
not gated behind `DEV_CACHE_DIR` (that's an opt-in response cache; this is
a number the UI shows unconditionally).
`main.py`'s `TAPETIDE_CALLS_PER_SEARCH` (currently 10: 6 for fundamentals +
1 for analyst consensus + 3 for price history, see the quota breakdown
below) converts
the remaining-calls figure into a "~N searches left today" estimate. This
constant is a hand-kept mirror of the real call sites in
`get_company`/`get_price_history` -- recount it from those functions if you
add/remove a Tapetide call anywhere, same discipline as the per-search call
count below. `CompanySearch.tsx` fetches this on mount and after every
search/price-history load, rendering it next to the search box
(`.search-quota-counter`, green/amber/red as the estimate runs low) -- this
is what replaced the old source dropdown.

**`bharat_sm_provider.py` (Bharat-SM-Data, wrapping Tickertape's public
JSON API) has a permanent, structural gap: no price history, ever.** The
underlying library gets OHLC data from NSE's own charting service, which
requires a handshake against `www.nseindia.com` first — and that site
flat-out 403-blocks automated/cloud traffic (confirmed live, not assumed;
this is NSE's well-known, long-standing anti-bot posture against
datacenter IP ranges, not a fluke of one dev sandbox). So
`get_price_history`/`get_recent_price_history` don't even attempt the
call — they return `[]` unconditionally, by design. `get_analyst_consensus`
also always returns `None`: the library only exposes Tickertape's own
proprietary "fundamental score" (Performance/Valuation/Growth/Profitability
flags), which is Tickertape's *opinion*, not third-party sell-side
analyst ratings — mapping that to `AnalystConsensus` would be exactly the
"blend our own view with third-party opinion" mistake this file warns
against elsewhere (see the "analyst consensus" vs. the app's own opinion
distinction at the top). Fundamentals themselves are solid where they
exist — verified live against known Reliance/TCS figures, and this source's
balance sheet actually breaks out current assets/liabilities separately
(Tickertape's `balTca`/`balTcl`), unlike Tapetide's condensed format. That
made it attractive for `/api/company` to use for a while (liquidity ratios
that show as permanent "N/A" under Tapetide alone would have been genuinely
available) — but Tickertape 403-blocks Vercel's cloud IP range for its own
search/profile endpoints too (see "Sourcing" above), which is a second,
independent anti-bot block from the NSE one described here, not the same
one. None of this provider's methods are called by `main.py` anymore (see
"Sourcing" above) -- `get_price_history`/`get_recent_price_history`/
`get_analyst_consensus` never were (the permanent gap described above), and
`get_company_info`/`get_raw_financials` stopped being once
`get_recommendations`, their last caller, was removed (2026-08, see
"Homepage recommendations" below). Don't route `/api/company` back through
this provider without re-verifying Tickertape's block is gone, and don't
route price history or analyst consensus through it without re-verifying
NSE's separate block is gone.

**Tapetide is consumed as plain JSON-RPC over HTTP, not via an MCP client
library.** `tapetide_provider.py`'s module docstring documents every field
mapping and *why* it's mapped that way, verified against live API responses
during development — read it before changing the parsing logic. Key things
to know:
- Tapetide's condensed (Screener.in-style) balance sheet does NOT break out
  current assets/current liabilities/cash/inventory/receivables separately.
  Current ratio, quick ratio, cash ratio, and working capital are therefore
  genuinely unavailable from this provider and show as "N/A" — this is not a
  bug, and should not be "fixed" by assuming a split.
  Inventory Turnover / Receivables Turnover ARE derived precisely (from
  Tapetide's own Inventory Days / Debtor Days), and ROCE is derived by
  inverting Tapetide's own ROCE % against our EBIT (see `capital_employed`
  on `RawFinancials`) — both are exact, not approximations.
- Banks/NBFCs report their P&L top line as "Revenue" instead of "Sales" (a
  structural difference in Indian financial-sector filings, not a data gap);
  the provider falls back to that field name.
- The free tier is rate-limited (50 calls/day as of writing). A full search
  costs **10 calls** (back up from a brief ~5-call window when fundamentals
  lived on Bharat-SM-Data -- see "Sourcing" above for why that reverted):
  `/api/company`'s fundamentals fetch costs 6 (`search_stocks` for
  `resolve_symbol` + `get_company_profile`, cached 60s and fetched with
  `include=["ratings"]` so rating data rides along free, + `get_financials`
  × 3 for profit_loss/balance_sheet/ratios + `get_stock_ownership`), and its
  analyst-consensus fetch costs 1 more (`get_forecasts` -- the profile is
  already cached from fundamentals, so no second `get_company_profile`
  call); `/api/price-history` costs 3 (`get_price_history` × 2 for the
  5-year weekly merge, `get_recent_price_history` × 1, daily, for the 1D/5D
  period buttons). That's **5 complete searches per day** on the free tier
  starting from zero usage — recount from the actual `_call_tool` call
  sites in this file (and update `main.py`'s `TAPETIDE_CALLS_PER_SEARCH`,
  which powers the `/api/quota` searches-remaining estimate) if you add/
  remove a Tapetide call anywhere, rather than trusting either number to
  stay accurate on its own. Tapetide returns quota-exceeded responses as a
  plain human-readable string rather than JSON — `_call_tool` detects this
  and raises `ProviderQuotaExceededError` (rather than trying, and failing,
  to parse it as JSON), which is what triggers the yfinance fallback
  described above.
- Large tool responses (e.g. mutual fund holdings) come back as valid JSON
  followed by a trailing plain-text truncation notice; `_call_tool` uses
  `json.JSONDecoder().raw_decode()` rather than `json.loads()` to tolerate that.
- **`get_price_history` truncates silently and keeps the OLDEST rows, not the
  newest** — a single `days=1825` (~5yr) request returns only the oldest
  ~157 of 261 available weeks, ending in 2024, with zero recent data, and
  *no* visible `[TRUNCATED...]` marker in that case (unlike the mutual-fund-
  holdings case above). `get_price_history` now deliberately exploits that
  same behavior in two calls instead of fighting it: one safe
  `days=1000`/weekly request (verified untruncated, reaches today) plus one
  intentionally-oversized `days=1825`/weekly request (truncates, but the
  truncated remainder is exactly the older ~3 years we can't get any other
  way), merged into one continuous ~5-year series. Verified live: no
  duplicate dates, no gaps, consistent 7-day spacing across the merge
  boundary. Don't "simplify" this back to one call without re-verifying —
  see the method's comment in `tapetide_provider.py` for the exact numbers.
  Weekly granularity (not daily) throughout is a deliberate choice, not a
  side-effect of the cap — see the same comment.
- **The weekly `points` series and the daily `recent_points` series don't
  always land on the same real last date, since they're fetched via
  separate Tapetide calls** -- confirmed live with a genuine cached
  response where `points` ended 4 real days before `recent_points` did.
  Left alone, `PriceChart.tsx` showed a different "latest price"/date in
  its header depending on which period button was selected (1D/5D use
  `recent_points`, 1Y/3Y/5Y use `points`), which read as inaccurate/broken
  even though both numbers were genuinely real. Fixed frontend-only, in
  `PriceChart.tsx`'s `sliceForPeriod`/`withLatestDailyPoint`: when a weekly
  slice's own last point is older than `recent_points`' true last point,
  that daily point is appended onto the end of the weekly slice (never
  fabricated, never a fetch of anything not already loaded) so every period
  ends on the same real, most-recent point. Don't "fix" this on the backend
  by trying to force the two Tapetide calls to agree on a last date --
  they're independent requests against a live data source and can drift by
  design; reconciling them for *display* is the right layer for this.
- **`get_company_profile` is deduped via `_get_profile`'s 60s TTL cache.**
  `get_company_info` and `get_raw_financials` both need a profile fetch for
  the same symbol; without the cache, main.py's `get_company` handler would
  make that call twice per request. `_get_profile` always passes
  `include=["ratings"]` so analyst rating data comes along for the same
  call cost. The `ratings` block is a top-level *sibling* of `data` in the
  parsed response (`{"data": {...}, "ratings": {"data": {...}}}`), not
  nested under `data` like every other section — easy to miss.
  `get_analyst_consensus` also calls `get_forecasts` (uncached, genuinely
  one new call) for the price-target range; the two additions together are
  quota-neutral versus the pre-existing double-fetch bug they replaced.

**Metrics are pure functions.** `metrics.py` takes already-fetched raw numbers
(revenue, net income, current assets, etc.) and returns computed ratios. It has
no knowledge of Tapetide/yfinance or any HTTP client — this keeps it
unit-testable and provider-agnostic.

**The AI guide (phase 12, off by default).** `services/guide.py` (rules, caps,
switches, the stream), `guide_context.py` (what the model may see) and
`guide_model.py` (Anthropic's official SDK, or the fake), behind
`POST /api/guide/ask` and `GET /api/guide/status` (`routes/guide.py`). It is
off unless `ENABLE_GUIDE=true` **and** the admin toggle (Admin, or
`PUT /api/admin/guide`) says `staff` (teachers and admins) or `on`; with no
toggle saved, `GUIDE_MODE_DEFAULT` applies (previews only). Signed-in only;
an under-18 needs the main parent approval and the separate guide tick.
The browser sends only which page it is on; `guide_context.build` rebuilds
the context from public data and never includes a figure for a quarter in
the play pool or an unscored league event's own quarter. Questions the
server recognises (advice, prices, the answer or a range, the hidden
company, safety, personal details) get a fixed reply with no model call;
replies stream sentence by sentence and each sentence is checked before it
is sent. No chat text is stored: `guide_usage` (per-person daily counts, 31
days) and `guide_spend` (the day's tokens and dollars) only. Caps: 6 a
minute, 20 a day per person, `GUIDE_DAILY_SPEND_USD` overall.
`GUIDE_ENGINE` picks where replies come from: `answers` (default, the
January version, `services/guide_answers.py`: approved text, the glossary,
the page's public figures and approved notes, matched by simple search with
a small English and Hinglish synonym list; no AI call, nothing leaves
Stackly, and nothing per person is stored, so neither the daily count nor
the parent tick applies), `fake` (canned replies; refused on the production
database) or `model` (Anthropic; refused without `ANTHROPIC_API_KEY`, and
never used without Hriday approving an amount). The red-team set is
`backend/tests/data/guide_redteam.json` (150 prompts; the real run is
`backend/scripts/guide_redteam.py`). The old `/api/chat` and its Moonshot,
DeepSeek and Claude services were retired in phase 12 (tested).

### Frontend layout

```
frontend/src/
  App.tsx                  Root: owns theme, auth, selected company, and active view state
  main.tsx                  Vite entry point
  components/
    Header.tsx              Logo (left) + account icon + settings gear (top-right)
    SettingsPanel.tsx        Slide-over sheet: Light/Dark, Delete my account, (behind
                              SHOW_EXTRA_TOOLS) Paper Trading starting balance
    AuthPanel.tsx            Slide-over: sign in/up form, or (once signed in) account
                              summary + recent activity feed + sign out -- see "Accounts
                              & activity tracking" below
    ForgotPasswordForm.tsx   Used by AuthPanel.tsx's sign-in form -- see "Forgot
                              password" below
    ResetPasswordPanel.tsx   Shown via "?reset_token=" in the URL -- see "Forgot
                              password" below
    Sidebar.tsx              Primary nav (2026-10): Home (league stock picker),
                              Research (company search), Paper Trading. Left icon
                              rail on desktop, labelled bottom bar at <=640px.
                              An Admin button (opens #/admin) renders only when
                              the signed-in user has is_admin (2026-11-12); for
                              anyone else it isn't in the DOM at all. Server
                              checks (require_admin) are unchanged; AdminPage
                              mounts its tabs, the only callers of /api/admin/*,
                              for admins only (Sidebar.test.tsx checks both).
                              ReturnCalculator/StockMarketSimulator only appear when
                              lib/features.ts's SHOW_EXTRA_TOOLS is on
                              (VITE_SHOW_EXTRA_TOOLS=true at build time) -- hidden,
                              not deleted
    SiteFooter.tsx           The one-line "Educational forecasting game. Not
                              investment advice..." footer on every page
    CompanySearch.tsx        Ticker/company name input. No source dropdown -- sourcing
                              is fixed, see "Keyless, cache-first sourcing" below
    MetricsDashboard.tsx     Full-width, grouped color-coded metric cards
    MetricCard.tsx           Single metric card; hover/tap opens a popover with
                              its plain-English definition + value-aware assessment
    PriceChart.tsx           Zoomable/pannable ~5yr weekly price history (lightweight-charts)
    PriceForecastChart.tsx   Separate standalone chart: High/Mean/Low dashed fan from
                              today's price to the analyst target date (own card, own
                              time axis -- see below for why it's not part of PriceChart)
    AnalystConsensus.tsx     Third-party rating breakdown (percentages only, no raw
                              analyst counts -- see below) + price target range
    ReturnCalculator.tsx     Second top-level page (via Sidebar): a compound-growth
                              calculator personalized to a real picked stock -- historical
                              CAGR, analyst target scenarios, and a risk profile, all
                              computed from real data already fetched elsewhere in the app
    StockMarketSimulator.tsx Third top-level page (via Sidebar): a Monte Carlo "what if"
                              game -- generates a random future price path for a picked
                              stock from its own historical drift/volatility, animates it
                              drawing on SimulatorChart.tsx, and shows a hypothetical
                              portfolio outcome. Explicitly not a forecast -- see below
    SimulatorChart.tsx       Standalone lightweight-charts line, same pattern as
                              PriceForecastChart.tsx, colored --status-warning (not
                              --accent) specifically to visually flag the line as
                              synthetic rather than real observed price data
    PaperTrading.tsx         Fourth top-level page (via Sidebar): buy/sell real
                              NSE/BSE stocks with virtual money at their current
                              (delayed) price -- see "Paper Trading" below
    TradingChart.tsx         Candlestick/line-toggle chart for Paper Trading, with
                              its own 1D/1W/1M/3M/1Y/5Y range set -- a new component,
                              not a PriceChart.tsx extension, see "Paper Trading" below
    TradingTutorial.tsx      First-visit-only modal explaining Paper Trading, reopenable
                              via the "?" button next to the page heading -- see below
    MarketStatusNotice.tsx   Modal explaining a closed market (holiday/weekend) on Paper
                              Trading -- see below
    PortfolioAnalysis.tsx    Paper Trading's second tab ("Analysis" alongside "Trade") --
                              stat grid, best/worst trade, allocation breakdown, and the
                              value-over-time chart below -- see "Paper Trading" below
    PortfolioValueChart.tsx  Reconstructs + charts portfolio value over time from the
                              real transaction log + real historical prices -- see
                              "Paper Trading" below
    CoinIcon.tsx              Minimalist outline coin glyph (no fill, currentColor) for
                              Paper Trading's currency -- see "Paper Trading" below
    CoinAmount.tsx            Pairs CoinIcon with a formatted coin number as one inline
                              unit with real spacing between them -- see below
  hooks/
    useTheme.ts               Reads/writes theme to localStorage
    usePortfolio.ts           Paper Trading's buy/sell/reset logic + cost-basis and
                              P&L math, on top of lib/portfolio.ts's pure storage
    useLiveQuotes.ts          Polls /api/trading/quote for one or many symbols on a
                              shared interval -- see "Paper Trading" below
  lib/
    auth.ts                   Pure localStorage token storage (get/set/clear) -- no
                              network calls, to avoid a circular import with api.ts
    api.ts                    All backend calls, including auth -- attaches the stored
                              token as `Authorization: Bearer <token>` automatically
                              wherever main.py's optional-auth dependency reads it
    portfolio.ts               Pure localStorage storage for Paper Trading's virtual
                              portfolio (cash/holdings/transactions) -- same pattern
                              as tapetideKey.ts, see "Paper Trading" below
    coins.ts                   Paper Trading's own currency formatters (🪙, not ₹) --
                              deliberately separate from format.ts's real-rupee
                              formatINR, see "Paper Trading" below
    portfolioHistory.ts        Pure functions reconstructing portfolio value over time
                              from the transaction log + fetched price history -- see
                              "Paper Trading" below
    marketHolidays.ts           Hand-maintained NSE/BSE 2026 holiday calendar + IST-aware
                              today/weekend helpers -- see "Paper Trading" below
  styles/
    theme.css                 CSS custom properties for dark/light themes
```

**All three top-level views stay mounted simultaneously now (2026-09), not
just whichever one Sidebar has selected.** `App.tsx` used to pick one of
the three with a plain ternary (`view === "search" ? <>...</> : view ===
"calculator" ? <ReturnCalculator/> : <StockMarketSimulator/>`), which
unmounted whichever branch wasn't active -- so leaving the Calculator tab
and coming back silently discarded its picked stock, investment amount,
time period, everything, forcing a full re-pick. The search page never had
this problem, but only by accident: `company` happens to live in `App.tsx`
itself, not in `CompanySearch.tsx`, so it survived that component being
unmounted/remounted -- the ternary was unmounting it too, same as the other
two, just without anywhere for it to lose data. Real, reported user
complaint (had to re-search/re-pick every time they switched tabs and
came back). Fixed by rendering all three views unconditionally, each
wrapped in a `<div className="view-wrapper">` toggled visible/hidden via a
`view-hidden` class (`app.css`: the wrapper is `display: contents` when
visible, so its real children become direct flex items of `.app-main`
exactly as before, and plain `display: none` when hidden, removing the
whole subtree from layout) -- CSS visibility, never a remount. Safe because
neither `ReturnCalculator` nor `StockMarketSimulator` has a mount-time
network effect; both only fetch on explicit user action (picking a stock),
so keeping all three alive in the background costs nothing extra. If you
ever add a view with an effect that fires on mount/prop-change rather than
on a user action, that effect will now keep running in the background for
every OTHER view too, the whole time it's mounted -- guard it or lift it,
don't assume "not currently selected" means "not running."

**Home keeps its place too (2026-11-08).** The Home list (`LeagueHome`)
stays mounted once seen, and the last company/results page opened from Home
(`keptPage` in `App.tsx`) stays mounted, hidden, even under the list. The
Home tab returns to wherever Home was (`homeAt`); tapping it while on a
company page goes to the list, and on the list scrolls to the top. Both pages
refetch when shown again (`visible` prop) without re-dealing the four cards
or remounting the form. `hooks/useScrollMemory.ts` remembers the content
column's scroll per page (the column, not the window, scrolls, so the
browser can't); links start a page at the top unless marked
`data-keep-scroll` (the "← Companies" and "Back to forecast" links).
Unsaved forecast inputs live in `lib/forecastDrafts.ts`: memory only, never
stored or sent, gone on reload, cleared on sign-out.

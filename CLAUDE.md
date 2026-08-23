# CLAUDE.md

Guidance for Claude Code (and any future contributor) working in this repository.

## What this project is

**Stackly** (renamed 2026-08 from "FinAI Metrics", briefly "Stackly
Metrics" in between -- same app, no functional change through either rename;
older comments/history throughout this file still say "FinAI Metrics" or
"Stackly Metrics" in places, left as-is rather than rewritten purely for the
name) — a web app that fetches financial data for Indian public listed
companies (NSE/BSE) and computes standard financial ratios, with hover
popovers explaining what each metric means and whether the company's actual
value is healthy, an aggregate "Financial Health Snapshot" verdict, a
zoomable/pannable ~5-year weekly price history chart, a **separate** Share
Price Forecast chart (analyst-target fan: High/Mean/Low dashed lines from
today's price to the target date — deliberately its own card, not overlaid
on the price history chart, where a ~9-month-out fan was an imperceptible
sliver against 5 years of history), and third-party analyst consensus
(rating breakdown + price target range). Before any search, the empty state
is just a plain "search a company" prompt -- it briefly showed a
daily-rotating set of "recommended" companies, removed 2026-08 (see
"Homepage recommendations" below for why).

**On "analyst consensus" vs. the app's own opinion:** `HealthSnapshot` (our
verdict) and `AnalystConsensus` (sell-side analysts' verdict, reported
as-is) look similar in the UI but are fundamentally different things — one
is FinAI Metrics describing the ratios it computed; the other is
third-party data we're relaying with attribution. Never blend them into a
single "FinAI Metrics says" framing, and never let the app generate its
own buy/sell/hold call — see the "AI assistant" section below for why that
line is a hard one.

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

The backend also has a working AI chat assistant (`/api/chat`) that was
removed from the frontend UI at the user's request (2026-07) to keep the
site to a single, full-width metrics view — the endpoint and its three
swappable LLM backends are still intact and functional, just not rendered
anywhere. To bring it back, re-add a chat component that calls `POST
/api/chat` (see backend/app/main.py for the request/response shape).

## Architecture

Two independent services, run separately in development:

```
backend/    FastAPI (Python) — data fetching, ratio calculations, AI assistant proxy (unused by frontend)
frontend/   React + Vite (TypeScript) — dark-mode-first, full-width metrics dashboard
```

The backend is the only thing that talks to external APIs (Tapetide, Moonshot).
The frontend never sees API keys — it only calls the local backend.

### Backend layout

```
backend/app/
  main.py                 FastAPI app, route wiring, CORS
  config.py               Env var loading (.env) via pydantic-settings
  models.py                Pydantic response/request schemas
  services/
    data_provider.py       Abstract base class for a financial data provider
    tapetide_provider.py   Serves price history + analyst consensus for every search
                            (the two things Bharat-SM-Data structurally can't provide)
    yfinance_provider.py   Automatic fallback for the above, used when Tapetide's
                            quota is exhausted
    bharat_sm_provider.py  Not wired into main.py anymore (see "Sourcing" below) --
                            kept as a dormant, fully-implemented provider in case
                            Tickertape's IP block on Vercel ever lifts
    metrics.py              Pure functions: computes ratios from raw financials
    ai_prompt.py             Shared system prompt + context formatting (provider-agnostic)
    moonshot_service.py      Active AI backend, wraps the Moonshot (Kimi) API
    deepseek_service.py      Alternate AI backend using DeepSeek (not wired in)
    claude_service.py       Alternate AI backend using Anthropic Claude (not wired in)
    db.py                    Postgres (Neon) connection + schema (users, sessions,
                              activity_log, tapetide_quota)
    auth_service.py          Signup/login/sessions/activity logging -- see
                              "Accounts & activity tracking" below
```

**Data source abstraction is intentional.** `data_provider.py` defines
`FinancialDataProvider` (ABC) with `resolve_symbol`, `get_company_info`,
`get_raw_financials`, `get_price_history`, `get_recent_price_history`, and
`get_analyst_consensus`. `TapetideProvider` is the primary implementation
for price history/analyst consensus. Do not let provider-specific types/
objects leak past this layer — always return the shared `CompanyInfo`/
`RawFinancials` models.

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
currently wired in" pattern as `deepseek_service.py`/`claude_service.py`)
in case Tickertape's block ever lifts. Don't route `/api/company`/
`/api/price-history` back through Bharat-SM-Data without first re-verifying
Tickertape's block is gone (the same discipline this file already asks for
NSE's block on price history).

- `GET /api/company/{query}` now requires a Tapetide key (400 if missing —
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
- `GET /api/price-history/{symbol}` unchanged: requires a Tapetide key (400
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

**`GET /api/quota`** requires a Tapetide key (400 if missing -- see
"Bring-your-own Tapetide key" below) and returns `QuotaStatus`: a *local
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
against elsewhere (see the `HealthSnapshot` vs `AnalystConsensus`
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

**The AI assistant is only reachable server-side.** `moonshot_service.py` is
the active backend (wired in `main.py`), reads `MOONSHOT_API_KEY` from the
environment, and talks to Moonshot's OpenAI-compatible Chat Completions API
via plain `requests` (no SDK) — note it uses `max_completion_tokens`, not the
deprecated `max_tokens`, and its base URL has a `/v1` prefix unlike
DeepSeek's. `deepseek_service.py` and `claude_service.py` are kept as
alternate backends — same swap pattern as the data providers; change one
line in `main.py`'s import to switch. All three share `ai_prompt.py` for the
system prompt and company-context formatting, so the assistant's scope stays
identical regardless of which LLM is active: it's scoped to financial
education about the currently loaded company and forbids investment advice —
do not relax this scoping without discussing it with the user first, since a
"personal finance chatbox" that starts giving buy/sell advice is a compliance
concern, not just a product decision. If you touch the prompt, edit
`ai_prompt.py` once, not each service file separately.

Moonshot maps billing suspension ("insufficient balance") to **HTTP 429**
with `error.type == "exceeded_current_quota_error"`, not HTTP 402 like
DeepSeek — `moonshot_service.py` inspects the error body to distinguish that
from an actual rate limit before choosing the user-facing message; don't
collapse that branch back to a generic 429 handler.

### Frontend layout

```
frontend/src/
  App.tsx                  Root: owns theme, auth, selected company, and active view state
  main.tsx                  Vite entry point
  components/
    Header.tsx              Logo (left) + account icon + settings gear (top-right)
    SettingsPanel.tsx        Slide-over: theme (green/blue) + mode (dark/light)
                              pickers, independently persisted to localStorage, +
                              Tapetide key reconfiguration
    AuthPanel.tsx            Slide-over: sign in/up form, or (once signed in) account
                              summary + recent activity feed + sign out -- see "Accounts
                              & activity tracking" below
    Sidebar.tsx              Left icon rail: switches between the search page,
                              ReturnCalculator, and StockMarketSimulator (the app's
                              three top-level views)
    CompanySearch.tsx        Ticker/company name input + "~N searches left today" quota
                              counter + Tapetide-reset countdown (no source dropdown --
                              sourcing is now fixed/hybrid, see "Hybrid sourcing" above)
    QuotaCounter.tsx          The "~N searches left today" pill -- shared by
                              CompanySearch.tsx and ReturnCalculator.tsx so both stay in sync
    MetricsDashboard.tsx     Full-width, grouped color-coded metric cards
    MetricCard.tsx           Single metric card; hover/tap opens a popover with
                              its plain-English definition + value-aware assessment
    HealthSnapshot.tsx       Aggregate "Strong/Mixed/Weak Fundamentals" verdict box
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
  hooks/
    useTheme.ts               Reads/writes theme to localStorage
  lib/
    auth.ts                   Pure localStorage token storage (get/set/clear) -- no
                              network calls, to avoid a circular import with api.ts
    api.ts                    All backend calls, including auth -- attaches the stored
                              token as `Authorization: Bearer <token>` automatically
                              wherever main.py's optional-auth dependency reads it
  styles/
    theme.css                 CSS custom properties for dark/light themes
```

Theming uses plain CSS custom properties (no Tailwind/styled-components) —
keep it that way unless there's a concrete reason to add a CSS framework.
Fonts: Inter (sans, UI) + Lora (serif, used sparingly for body/long-form
explainer text), both loaded via Google Fonts in `index.html`.

**Responsive breakpoints (`app.css`).** Built 2026-07 after a live phone-width
audit (375px viewport) found two severely broken layouts: `.summary-row`'s
2-column grid clipped the Analyst Consensus card off the right edge of the
screen entirely, and (now removed along with the recommendations feature
itself, see "Homepage recommendations" below) `.recommended-companies-grid`'s
inline `repeat(N, 1fr)` column count squeezed name/ticker text unreadably at
phone width. Fixes live in a dedicated "Responsive: phone-width screens"
section at the end of `app.css`, plus the pre-existing 900px `.charts-row`
stack above it:
- `max-width: 640px` is the general phone cutoff — sidebar/header/search-bar
  padding, calculator result/scenario grids (3-col → 1-col; three equal
  columns leave too little width per currency value), and `.metric-card`
  corner rounding (every card gets its own radius here, since `.metric-cards`
  normally rounds only the grid's outer first/last child on the assumption
  each group fits one row — an assumption `auto-fit` breaks once rows wrap
  at phone width).
- `max-width: 760px` stacks `.summary-row` to one column — needs a wider
  cutoff than 640px since two side-by-side compact cards stop fitting
  before a general single-column phone layout would kick in.
- `.settings-panel`/`.auth-panel` and the Tapetide key gate needed no
  breakpoint — their existing `max-width: 90vw` / centered-card patterns
  already adapted correctly, confirmed live rather than assumed.

**`useTheme.ts` sets the `data-theme` attribute in a `useLayoutEffect`, not
a plain `useEffect` — this one matters, don't "simplify" it back.**
`PriceChart.tsx`/`PriceForecastChart.tsx` each have their own `[theme]`-
triggered effect that reads CSS variables via `getComputedStyle` (`cssVar()`)
to re-theme their lightweight-charts `<canvas>` (which can't just pick up
new CSS custom properties on its own the way normal DOM elements do). React
runs every component's `useLayoutEffect`s, tree-wide, before any
component's plain `useEffect`s in the same commit — but within the same
effect type, a child's effect still fires before its parent's. `useTheme()`
lives in `App.tsx` (the root); the two chart components are deep
descendants. With a plain `useEffect` here, their child effects fired
*before* this parent effect had actually flipped the `data-theme`
attribute, so they read the *previous* theme's colors and never corrected
themselves until some unrelated re-render happened to trigger another
read — matching a user-reported bug where the charts "glitched"
specifically after a theme change, and specifically after a search (since
that's the only time these two chart components are mounted at all). The
fix follows directly from React's documented effect-ordering guarantees;
it wasn't independently reproduced frame-by-frame before fixing (a
live-rendered canvas glitch that self-corrects on the next unrelated
re-render is inherently hard to catch with a static screenshot).

**Theme and mode are two independent axes, not one flat list (2026-08) —
`useTheme.ts`'s `ThemeName` (`"green"` default | `"blue"`) and
`ThemeMode` (`"dark"` default | `"light"`).** First built as a single
3-option list (`"money" | "dark" | "light"`), then corrected at the user's
explicit request: a theme (color identity) and its mode (light/dark
appearance) should be pickable independently, so *every* theme gets both a
light and a dark variant rather than the green theme only ever being dark.
`"money"`/`"classic"` were the theme's original internal names (and still
the vocabulary used to describe *why* the palettes look the way they do,
below) — renamed to `"green"`/`"blue"` almost immediately after, same
colors, just color names instead of concept names. Both attributes
(`data-theme`, `data-mode`) live on `<html>` together, set by the same
`useLayoutEffect` in `useTheme.ts` (still `useLayoutEffect`, not
`useEffect` — see below for why that specifically matters), each persisted
to its own localStorage key. `theme.css` defines the resulting 2x2 matrix
as four blocks: `[data-theme="green"][data-mode="dark"]`,
`[data-theme="green"][data-mode="light"]`,
`[data-theme="blue"][data-mode="dark"]`,
`[data-theme="blue"][data-mode="light"]`.

- **"Green"** is a lowkey money-green & black identity — dark mode:
  `--bg-app: #0a0f0b`, `--accent: #4f9d6f`; light mode: a cream/paper
  background (`--bg-app: #f6f8f4`, not pure white — a nod to actual
  currency) with a deeper, more saturated green (`--accent: #2f7d52`) for
  contrast, the same relationship "blue" light already has to its own
  dark mode (re-tuned per-mode, not just inverted lightness on the same
  hex values). Gold for `--status-warning` in both modes, rather than this
  app's usual amber, since gold fits the money-green theme without
  inventing a new status vocabulary.
- **"Blue"** (both modes) is the *original*, only theme from before the
  green theme existed, kept byte-for-byte untouched specifically as a
  no-code-change revert path — picking "Blue" (either mode) from the
  Settings panel's theme picker fully restores the app's exact prior look.
  Don't repurpose or delete either "blue" block without checking with
  the user first.

`SettingsPanel.tsx` has two separate picker rows now (`.theme-picker`,
reused for both — segmented-control style matching
`.auth-mode-toggle`/`.calculator-mode-toggle` elsewhere in the app), not
one combined list: "Theme" (Green/Blue) and "Mode" (Dark/Light), so
either can be changed without touching the other. Preview swatch colors in
both (`SettingsPanel.tsx`'s `THEME_OPTIONS`/`MODE_OPTIONS`) are hand-kept
copies of the real CSS values, not read live — there's no way to sample
"what would this look like under a theme/mode that isn't currently active"
without something like an offscreen iframe per swatch, and these are
purely decorative preview dots, never applied anywhere as real UI color.
Theme swatches always preview that theme's dark mode (its primary
identity, regardless of the currently-selected mode); mode swatches are
deliberately generic near-black/near-white circles, not theme-tinted,
since mode is conceptually independent of which theme is active.

`useTheme()` exports a combined `Theme = \`${ThemeName}-${ThemeMode}\``
value (template literal type) purely for `PriceChart.tsx`/
`PriceForecastChart.tsx`'s `useEffect` dependency arrays — both re-read
CSS variables via `getComputedStyle` to re-theme their lightweight-charts
canvas whenever this changes, never branching on the literal string.
Either axis changing alone still needs to trigger that re-read (a
theme-only change and a mode-only change both produce different CSS
variable values), which is exactly why those two components need one
*combined* changing value rather than depending on `themeName`/`mode`
separately and risking a missed re-render if only one of the two effects'
dependency arrays gets updated correctly.

**`MetricCard`'s popover and `HealthSnapshot` both carry `definition`/
`assessment`/`explanation` text computed server-side in `metrics.py`** (not
generated client-side or via the LLM) — see `_build_assessment` and
`compute_health_snapshot`. `HealthSnapshot` is deliberately worded as a
description of the *ratios* ("Strong Fundamentals", "driven by strong
profitability") and explicitly disclaims itself in the UI ("not a
recommendation to buy, sell, or hold") — this was a specific compliance
line drawn after the user asked for a buy/sell/hold verdict box and it was
scoped down instead; don't casually reintroduce buy/sell/hold wording here.

**`.metric-card`'s status color is a left-edge ribbon (`border-left`), not
a small dot.** (2026-07) Originally a 6px `.status-dot` next to the label,
per user feedback that it was too hard to register at a glance across a
dense 20-30-card grid. `MetricCard.tsx` now puts the status class directly
on the card itself (`metric-card good/warning/bad/neutral`) rather than on
a child dot span, matching the same left-border convention already used by
`.calculator-scenario-tile`/`.calculator-risk-row`. `.status-dot` itself
still exists in `app.css` and is still used elsewhere (`HealthSnapshot`'s
compact tile) — only `MetricCard.tsx` dropped it.

**`PriceForecastChart` is a deliberately separate chart, not a series
overlaid on `PriceChart`.** An earlier version drew the High/Mean/Low fan
directly on the 5-year price chart; the fan's ~9-month horizon made it an
imperceptible sliver against 5 years of history (confirmed live — a user
couldn't find it on screen). `PriceForecastChart`'s whole time axis is just
"today" → the target date, so the fan fills the frame, with its own
smaller canvas height (`.price-forecast-canvas`, 220px vs. the main
chart's 280px). Two lightweight-charts details worth preserving if you
touch this file: the % return figures are shown in the legend below the
chart, *not* as on-chart text markers — an earlier attempt at on-chart
labels had the marker's own circle clip its text (fixed by `position:
"aboveBar"`), and then had adjacent High/Mean labels collide with each
other when the targets are close in price (a real, recurring case, not an
edge case) — legend-only sidesteps both permanently. The "Today" origin
marker needs `zOrder: "top"` in `createSeriesMarkers`, or the three dashed
lines' strokes render on top of it since they all pass through that exact
shared point.

**`ReturnCalculator.tsx`'s main projection tiles are driven by the analyst
consensus mean price target when one exists, not the stock's own trailing
price history.** This went through two iterations before landing here,
both driven by real, confirmed user-visible problems -- worth knowing the
history if you touch this file again:
1. Originally, the rate's lookback window was tied directly to whatever
   "Time period" the user was projecting forward with
   (`targetDays = periodInYears * 365.25`). Picking a short period like
   "1 Month" made it annualize a mere 30-day price window, and CAGR math
   (`(end/start)^(1/years) - 1`) massively amplifies noise over a short
   window -- a perfectly ordinary ~7% move over 30 days compounded to a
   headline "133% annual return."
2. Fixed by switching to a fixed ~1-year trailing lookback, independent of
   the projection period -- stable, but this surfaced a *second* problem:
   the rate was still purely backward-looking (what the stock's price
   actually did), while the separate "Analyst price target scenario"
   section below it is forward-looking (what analysts expect). A stock can
   easily have had a down trailing year while analysts expect a recovery --
   nothing wrong with that individually, but it read as broken to see the
   main "Total Gain" tile negative while a "Worst case" analyst scenario
   right below it was positive, with no indication these were two
   unrelated kinds of numbers.
3. **Current design**: `computeProjectionRate` tries `computeForecastRate`
   first -- annualizing the analyst consensus mean target from today to
   `AnalystConsensus.target_date` (`(meanTarget/basePrice)^(1/yearsToTarget) - 1`)
   -- and only falls back to `computeHistoricalRate` (the fixed ~1yr
   trailing calculation from iteration 2, kept as-is) when a stock has no
   analyst coverage to derive a forecast rate from. The rate field's label,
   helper text, and the bottom disclaimer all switch wording based on
   `ProjectionRate.source` ("forecast" vs "historical") so it's never
   ambiguous which basis produced the number. This makes the main tiles
   agree in direction with the "Likely case" scenario tile by construction
   (both ultimately derive from the same mean target) -- if "Time period"
   happens to exactly match the real analyst horizon, the two even compute
   to the exact same figure, since `p*(1+r)^t` with `t = spanYears` and `r`
   derived from that same span algebraically reduces to the scenario
   section's own `p*(mean/basePrice)`.
   `PickedStock.recentPoints` (the ~6-7mo daily series, used by the very
   first, period-coupled version above) is no longer needed anywhere in
   this component and was removed rather than left dead.
4. **(2026-08) Attempted fix, later reverted (see iteration 5) for
   reintroducing iteration 1's exact bug via a different path.** Tapetide's
   `target_date` is typically well under a year out (~7-10 months, see
   `AnalystConsensus`'s own docs above) -- annualizing that short a real
   span with `(mean/base)^(1/spanYears) - 1` amplifies it the same way
   iteration 1's user-chosen short window did. Confirmed live with real
   cached RELIANCE data: a genuine ~28% raw upside to a ~0.64yr-out target
   compounded to a headline ~47% "annual return" -- a user-reported,
   verified mismatch (they expected ~30-40%, matching the raw figure, and
   saw ~50%). "Fixed" by flooring the exponent's denominator at 1yr in both
   `computeForecastRate`/`computeHistoricalRate`, on the theory that a
   sub-1yr target should show its real, un-extrapolated return instead of
   a stretched annual pace -- explicitly flagged at the time as breaking
   the iteration-3 invariant (main tiles no longer reduce to the scenario
   section's figure) as an "accepted trade-off." That trade-off turned out
   to be a real bug, not a cosmetic one -- see iteration 5.
5. **(2026-08) Reverted iteration 4 -- the floor broke Time Period
   compounding, a second user-reported, verified mismatch.** The floored
   rate is only the true annual pace at exactly `Time Period = spanYears`;
   compounding it via `p*(1+r)^t` for ANY other `t` (which is the whole
   point of the Time Period field) no longer means anything, because a
   floored rate isn't a real per-year figure. Confirmed live: RELIANCE's
   floored ~27% rate compounded over a 1.5yr Time Period produced a
   "Total Return" of ~45% -- not the rate shown, not the real target
   return, not annualized correctly for 1.5 years, just wrong. `ratePct`
   is now ALWAYS true CAGR again (`(mean/base)^(1/spanYears) - 1`,
   uncapped) so Time Period compounding is coherent for every value, and
   the iteration-3 invariant (main tiles == scenario section at
   `Time Period = spanYears`) holds again unconditionally. The real,
   non-annualized number iteration 4 was trying to surface didn't
   disappear -- `ProjectionRate.rawPct` carries it separately now, and the
   rate field's helper text shows both together whenever `spanYears < 1`
   ("implies a +27% move by then -- the rate above is that pace stretched
   to a full year") instead of silently substituting one number for the
   other. Lesson: a "more honest number" that breaks the field it feeds
   into isn't more honest, it's just wrong in a different place -- fix
   confusing *labeling* with better labels, not by changing what the
   underlying rate mathematically means.
6. **(2026-08) Flipped the priority: trailing historical performance is
   now the DEFAULT, analyst-forecast is now the fallback -- reversing
   iteration 3's own choice.** Iterations 4/5 kept trying to fix the
   *display* of the forecast-annualized rate, but the deeper problem
   never went away: annualizing a sub-1yr analyst target, however
   honestly labeled, kept producing headline numbers a user twice
   reported as implausibly high -- first "~50%, should be 30-40%," then
   after the raw figure was surfaced, still "~50%, should be ~15%."
   Investigated with real live data rather than guessing a third
   formula: RELIANCE's true forecast-annualized CAGR was ~46%/yr, while
   its actual trailing performance over 1/3/5 years was -3% to +6% --
   *nowhere near* either the forecast-derived number or the user's
   expected ~15%. There is no honest RELIANCE-specific figure that lands
   near a generic "stocks return ~15%" intuition; the fix isn't a better
   formula, it's changing what's being measured. `computeProjectionRate`
   now tries `computeHistoricalRate` first, falling back to
   `computeForecastRate` only when a stock has no price history yet (a
   very recent listing) -- inverting iteration 3's `computeForecastRate
   ?? computeHistoricalRate`. This reintroduces the exact "main tiles vs.
   scenario section can point in different directions" risk iteration 3
   moved away from (a stock can have a weak trailing year while analysts
   expect a recovery) -- accepted as the better trade-off given two
   real, escalating complaints about the forecast-first design and zero
   complaints about the historical one.
   **Also fixed a real, separate bug found while investigating:**
   `computeHistoricalRate` anchored to `series[series.length - 1]` --
   Tapetide's price-history feed was confirmed live to sometimes serve a
   "latest" weekly point several months stale (a fetch made in August
   returned a series ending in March), silently computing the wrong
   1-year window and pricing off a stale close. Now anchored to the live
   current price and `Date.now()` instead (the same fresh price already
   fetched for the stock picker) -- the price-history *series* is still
   used to find the point ~1 year back, just not trusted for "today."
   The rate field's label and helper text now say explicitly "trailing
   historical performance" whenever this basis is used, per direct user
   request, so it's never ambiguous that the number is backward-looking,
   not a forecast.

**The "Analyst price target scenario" section is still on a different,
fixed horizon than the main projection tiles above it — a deliberate,
disclosed difference, not a bug.** It always projects to Tapetide's
`target_period` (e.g. "FY2027 (period ending Mar 2027)", ~8-9 months out),
independent of "Time period," via a straight linear price-ratio scale-up
(`p * (targetPrice / basePrice)`) with no compounding, showing the real,
non-extrapolated Low/Mean/High range at the actual target date -- the same
"don't blend two different kinds of projections" principle as
`PriceForecastChart` being its own card rather than overlaid on
`PriceChart` (see above). The main results section is labeled with its own
horizon too ("Projected over N days/months/years/decades," reusing
`periodValue`/`periodUnit`) specifically so both sections' timeframes are
visible side by side rather than implicit.

## Market Simulator

(2026-08) The app's third top-level page (`StockMarketSimulator.tsx`, via
Sidebar). Deliberately a different kind of tool than Return Calculator's
deterministic, analyst-target-driven projection above -- this one is a
Monte Carlo "what if" game: it generates a *random* future weekly price
path for a picked stock via geometric Brownian motion, seeded by that
stock's own historical drift/volatility (mean and standard deviation of
weekly log returns, computed from the same ~5yr weekly `points` series
Return Calculator's volatility factor already uses), then shows what a
hypothetical investment would be worth at the end of that one random path.
Running it again with the exact same stock produces a *different* path
every time -- that's the point, not a bug to seed away.

- **Not a forecast, and disclosed as such twice.** A `.page-disclaimer`
  line (same red, page-level treatment as the search and calculator pages
  -- see below) states up front that this is a random simulation, not a
  prediction, with no liability accepted for decisions made from it; a
  second `.calculator-field-note` under the results repeats the same point
  in the context of the actual numbers shown. This is a stronger
  disclaimer than Return Calculator's, deliberately -- that page's rate is
  at least *derived* from a real analyst consensus or real past prices;
  this page's entire output is synthetic, generated fresh on every click,
  so the risk of it being misread as a real prediction is higher, not
  lower.
- **`SimulatorChart.tsx` colors its line `--status-warning`, not `--accent`.**
  Every other chart in the app (`PriceChart`, `PriceForecastChart`) uses
  `--accent` for what is, ultimately, real fetched data. Reusing that same
  color for a randomly-generated path would visually imply it belongs to
  the same category of trustworthiness. `--status-warning` (this app's
  existing "uncertain/caution" token) was already the right semantic fit
  without inventing a new color.
- **The path animates in over ~2.2s regardless of horizon length**
  (`StockMarketSimulator.tsx`'s animation `useEffect`, tick interval =
  `2200 / totalSteps` steps, clamped to a 30ms floor) rather than appearing
  all at once -- a chart that's already fully drawn the instant you click
  "Run Simulation" reads as a static chart, not something being simulated
  live. The full path is computed synchronously up front (not generated
  tick-by-tick) purely so the result tiles below can show final numbers
  immediately without waiting on the animation to finish; the animation is
  a visual replay of an already-known path, not the actual computation.
- **Changing the horizon toggle does NOT auto-regenerate the chart** -- same
  "locked until you act" pattern as Return Calculator's Time period field.
  `pathHorizon` state tracks which horizon the *currently displayed* `path`
  was actually generated for, kept deliberately separate from the live
  `horizon` toggle value, specifically so the results header ("Simulated
  outcome after N Months/Years") can't end up describing a horizon that
  doesn't match what's actually on screen if someone clicks a different
  toggle option without pressing "Run New Simulation" afterward -- a real
  bug caught and fixed before this shipped, not a hypothetical.
- **Picking a stock costs the same Tapetide quota as Return Calculator's
  stock picker** (one `fetchCompany` + one `fetchPriceHistory` call pair --
  see "Sourcing" above), shown via the same `QuotaCounter`. Re-running the
  simulation itself, including every "Run New Simulation" click, is pure
  client-side math on data already fetched and costs nothing -- worth
  knowing since it's not obvious from the UI alone which action spends
  quota and which doesn't.
- A stock with under ~10 weeks of price history (`computeWeeklyStats`'
  minimum) can't have a simulation generated for it at all -- shown as a
  plain "Not enough price history for {ticker} to run a simulation" note
  rather than a silently blank chart area.

## Homepage recommendations (removed 2026-08)

Before any search, the empty state used to show 3-5 companies via
`RecommendedCompanies.tsx`, fetched from `GET /api/recommendations` --
`main.py`'s `get_recommendations` ran `compute_metric_groups` +
`compute_health_snapshot` (the same functions a real search uses) against a
rotating pool of 20 large-cap NSE tickers, sourced from `bharat_provider`
specifically so loading the homepage cost zero Tapetide quota and needed no
key. Removed entirely at the user's request rather than fixed, because it
was already broken in production and staying that way: Tickertape
403-blocks Vercel's cloud IP range (see "Sourcing" above), so every
candidate fetch failed and `GET /api/recommendations` had been silently
returning `{"companies": []}` with no visible error. Re-pointing it at
Tapetide instead would have fixed the block but defeated the point of the
feature (it needs to work before a visitor has entered a Tapetide key, and
without spending their quota just to load the homepage) -- CLAUDE.md had
flagged this exact tradeoff as a known, unresolved gap needing a product
decision, and the decision made was to drop the feature rather than pay
that cost. The empty state (`App.tsx`) is now just the plain
"No company loaded yet" prompt with no suggestions below it.
`bharat_sm_provider.py` (`get_recommendations`' only remaining caller) is
now fully unwired from `main.py` -- see "Sourcing" above.

## Accounts & activity tracking

(2026-07) The only piece of genuinely persistent, user-specific state in
this app -- everything else is either fetched live from a provider or an
in-process cache that resets on restart (well, quota tracking is the
exception there too, see `tapetide_provider.py`'s `tapetide_quota` table).

**Sign-in is additive, never a gate.** Every feature in this app works
fully signed-out, exactly as before this existed. Signing in (via the
account icon in the header, `AuthPanel.tsx`) only starts recording your own
searches to an activity log you can see in the same panel. Don't make any
endpoint require auth without discussing it with the user first -- that
would be a real product change (turning an open tool into a walled one),
not just an implementation detail.

**Storage is Postgres (Neon's free tier), not SQLite anymore.** This was
SQLite (`backend/app.db`, gitignored) originally -- a single on-disk file
needing no separate server process, consistent with the project's bias
against adding infrastructure (see the dev-only response caches in
`tapetide_provider.py`/`bharat_sm_provider.py`, both plain files on disk,
same reasoning). That stopped working once the app moved to Vercel (2026-07,
see "Deployment" below): serverless functions have no persistent local
filesystem, so anything written to disk -- the SQLite file, and
`tapetide_provider.py`'s old quota-tracking JSON file -- was silently wiped
on every cold start/redeploy. Neon specifically because its free tier is
permanent (not a trial) and needs no credit card. `db.py` creates four
tables on startup (`users`, `sessions`, `activity_log`, `tapetide_quota`)
via plain `psycopg` (v3) -- no ORM, deliberately; four small tables don't
need one. Uses `row_factory=dict_row` so call sites still do `row["col"]`,
same as `sqlite3.Row` did before.

**Auth is session tokens in a DB table, not a JWT.** `auth_service.py`
issues an opaque `secrets.token_urlsafe(32)` on signup/login, stored
server-side in `sessions` with a 30-day expiry. Every request needing auth
does a DB lookup rather than verifying a signature -- the right tradeoff at
this scale (a handful of users), since it makes revocation ("sign out
everywhere") trivial (delete the row), which a stateless JWT can't do
without extra machinery. The frontend stores the token in `localStorage`
(`lib/auth.ts`) and `lib/api.ts`'s `authHeaders()` attaches it to every
request as `Authorization: Bearer <token>` automatically -- no per-call-site
plumbing needed.

**Passwords are hashed with stdlib `hashlib.pbkdf2_hmac` (SHA-256, 200k
iterations, random 16-byte salt per user), not bcrypt/argon2.** No new
dependency needed for it -- PBKDF2 via hashlib is a legitimate, still-widely-
used choice (it was Django's default password hasher for years), and this
project's existing bias is toward the standard library over adding a
package where the stdlib genuinely covers it. Never log or include a
plaintext password in an exception message anywhere in `auth_service.py`.

**`main.py`'s `_current_user` dependency is optional-auth, never raises.**
It returns `None` for a missing/invalid/expired token rather than a 401 --
every route that uses it (currently just `/api/company/{query}`, to log a
`"searched"` activity entry when signed in) needs to keep working perfectly
for anonymous requests, since that's still the default, expected way to use
this app. `GET /api/activity` is the one exception that does require auth
(401 if signed out) since "your activity" is meaningless without a "you."

**What gets logged, and where to add more:** `signed_up`, `logged_in` (both
from `auth_service.py` itself), and `searched` (from `main.py`'s
`get_company`, detail = the resolved company name). If you wire up activity
logging for another action (e.g. a calculator stock pick), call
`auth_service.log_activity(current_user, "action_name", detail)` -- it's a
no-op when `current_user` is `None`, so every call site can call it
unconditionally rather than wrapping every log call in `if current_user:`.

## Bring-your-own Tapetide key

(2026-07) This app is a public, multi-user website now, not a single-owner
local tool -- so Tapetide's free tier (50 calls/day) had to stop being one
shared server-side secret. **Every visitor supplies their own Tapetide API
key**, entered client-side and never persisted server-side.

**There is no `TAPETIDE_TOKEN` env var anymore.** `TapetideProvider.__init__`
takes `token: str` as a required constructor argument and is instantiated
fresh, per request, from whatever key that specific request carried --
there is no module-level singleton in `main.py` the way `fallback_provider`
still is (see "Sourcing" above for why that one didn't need this
treatment). The key travels as the `X-Tapetide-Token`
header, read via `main.py`'s `_tapetide_token` dependency (returns `None`
if missing/blank -- callers decide whether that's fatal).

**The key lives in the browser's `localStorage` (`lib/tapetideKey.ts`) --
that's still the only thing every actual API request reads from (see
`lib/api.ts`'s `tapetideHeaders()`).** Storing a third-party secret server-
side at all was originally avoided entirely, to keep this app from being
responsible for protecting it against a breach. That's now a partial,
opt-in reversal (2026-07): **a signed-in user can additionally save their
key to their account**, encrypted at rest with Fernet
(`auth_service.py`'s `save_tapetide_key`/`get_tapetide_key`, keyed by the
`ENCRYPTION_KEY` env var -- see "Environment variables" below), specifically
so it follows them across browsers/devices instead of needing re-entry
every time. This is still opt-in, not the only path: anyone can choose
"Continue without an account" in the gate below and get the original
client-only behavior with nothing ever touching the backend's database.

**`TapetideKeyGate.tsx` is a hard, blocking gate, not a dismissible
nudge** (unlike the sign-in banner above) -- rendered as an always-mounted
overlay in `App.tsx` whenever `getTapetideKey()` returns nothing,
`backdrop-filter: blur()`'d over the still-fully-rendered app behind it
(not blurred via a class toggle on the app root -- the gate doesn't need to
reach into anything else's DOM). It's now a small multi-step flow rather
than a single form (2026-07):
- **`"welcome"`** (the default first step, unless `App.tsx` already
  resolved a signed-in `user` by mount time -- see below): offers Sign In,
  Sign Up, or "Continue without an account."
- **`"signin"` / `"signup"`**: inline forms (a separate copy from
  `AuthPanel.tsx`'s, not shared -- different surrounding chrome, full-
  screen step vs. slide-over). On successful sign-in, `main.py`'s
  `/api/auth/login` response already includes the account's saved key
  (`UserPublic.tapetide_key`, decrypted) if one exists -- if so, the gate
  adopts it immediately and closes with no further step; if not (or after
  a fresh sign-up, which never has one yet), it proceeds to `"key"`.
- **`"key"`**: the original single pill-shaped input+button, walking
  through getting a free key at
  [tapetide.com](https://tapetide.com/settings/tokens). Submitting calls
  `POST /api/tapetide/validate` (anonymous) or `POST /api/auth/tapetide-key`
  (signed in -- validates the same way, then also persists it to the
  account) *before* storing anything locally -- a genuinely wrong key must
  never sit in `localStorage` looking valid either way.

`App.tsx` also restores a saved key automatically on a plain page load, not
just via the gate's own sign-in step: if a stored auth token resolves (via
`fetchMe`) to a user with a saved key, and this browser doesn't already
have one in `localStorage`, it's adopted immediately and the gate never
even renders. The `!getTapetideKey()` check there matters -- it deliberately
never overwrites a key someone's actively using locally just because
they're also signed into an account with a *different* saved key. A new
`sessionChecked` boolean in `App.tsx` (true immediately if there's no
stored token to check, otherwise flips true once `fetchMe` resolves) exists
purely so the gate shows a neutral "Checking your session..." loading state
instead of flashing the welcome step for a returning signed-in visitor
right before it would auto-dismiss.

**`TapetideProvider.validate_key()` deliberately bypasses `DEV_CACHE_DIR`
(`use_cache=False`)** -- every other method on this class is fine being
served from the dev-only disk cache, but validation specifically must not
be: a cache hit returns before the network request (and Tapetide's own
auth check) ever happens, so if the validated query was ever cached by a
prior *real* call, literally any garbage token would appear "valid." This
was a real bug caught during live testing, not a hypothetical -- don't
remove `use_cache=False` from that one call site.

**Quota tracking is per-key now, not global** -- see `/api/quota` above
and `tapetide_provider.py`'s `_token_hash`/`_load_quota_state`. Each
user's own 50-calls/day budget is tracked independently, keyed by a hash of
their token.

**`SettingsPanel.tsx` can reconfigure the active key after the fact**
(2026-07) -- `TapetideKeyGate.tsx` only ever runs once, whenever no key is
stored yet, so there was previously no in-app way to swap a key afterward
short of clearing `localStorage` by hand. The Settings panel's "Tapetide
API Key" row shows the active key's last 4 characters (read straight from
`getTapetideKey()`, not `user.tapetide_key` -- the two can differ if
someone's using a different key locally than the one saved to their
account) and a "Configure" button. Signed-in users must re-enter their
password first (reuses `POST /api/auth/login` purely as a "prove it's
still you" check, not because the session token itself is distrusted --
matches the user's explicit ask for a verification step before letting a
saved credential be overwritten); anonymous users skip straight to the key
field, since their key was never protected by anything beyond
`localStorage` in the first place. Either path ends by calling the same
`saveTapetideKeyToAccount`/`validateTapetideKey` functions
`TapetideKeyGate.tsx` already uses.

**Google Sign-In (2026-07) is a second way into an account, not a
replacement for email+password.** Deliberately Google-only, not
Google+Apple — Apple Sign-In requires enrolling in Apple's paid Developer
Program ($99/year), which is a real cost decision left with the user
rather than defaulted into quietly (same posture as "If it requires money,
tell me before doing anything" elsewhere in this project's history).
- **No client secret anywhere.** Uses Google Identity Services' (GSI) ID-
  token flow: `frontend/src/lib/googleAuth.ts` renders Google's own button
  (`google.accounts.id.renderButton`, loaded via the `<script>` tag in
  `index.html`) and gets back a signed JWT (`credential`) in its callback —
  that's it client-side, no popup/redirect flow to wire up. `main.py`'s
  `POST /api/auth/google` is what actually verifies it
  (`google.oauth2.id_token.verify_oauth2_token`, checking signature,
  expiry, and that the token's audience matches `GOOGLE_CLIENT_ID` — i.e.
  this token really was minted for this app). `GOOGLE_CLIENT_ID` is the
  *same* value on both sides deliberately: it's a public identifier, safe
  in frontend bundle code (as `VITE_GOOGLE_CLIENT_ID`), unlike a secret.
- **`auth_service.py`'s `login_with_google`** finds-or-creates a user,
  matching on the stable `google_id` first, falling back to a match on
  `email` (links Google Sign-In onto an existing password account rather
  than creating a duplicate — safe since Google already vouched for that
  email by the time this function is called). A Google-created account has
  no password at all — `users.password_hash`/`password_salt` are nullable
  now (`db.py`), not just empty strings, so there's nothing to guess or
  leak. `log_in` (the password path) checks for that explicitly before
  hashing, rather than crashing on `bytes.fromhex(None)`.
- **`GoogleSignInButton.tsx` renders nothing if `VITE_GOOGLE_CLIENT_ID`
  isn't set** — every call site (`AuthPanel.tsx`'s form, `TapetideKeyGate.tsx`'s
  `"signin"`/`"signup"` steps) includes it unconditionally rather than
  checking first, so the button just silently doesn't appear in a
  deployment that hasn't configured Google Sign-In (e.g. before the
  Client ID was set up) instead of rendering broken.
- **`UserPublic.has_password`** exists specifically so `SettingsPanel.tsx`
  can tell a Google-only account apart from a password account before
  deciding whether its "Configure" button leads to the password-
  verification step or skips straight to the key field — a Google-only
  account has nothing to verify (`POST /api/auth/login` would always fail
  for it, permanently locking that account out of ever reconfiguring its
  key otherwise). Skipping straight to the key field for both anonymous
  visitors and Google-signed-in users is a deliberate equivalence: in both
  cases, there's no password to re-check, and the already-authenticated
  session itself stands in for that verification for the Google case.

## Environment variables

Backend reads from `backend/.env` locally (see `backend/.env.example`), or
from Vercel project environment variables in production:

- `DATABASE_URL` — required. Neon Postgres connection string (free tier, no
  credit card) backing user accounts, sessions, activity logs, and Tapetide
  quota tracking — see "Deployment" and "Accounts & activity tracking"
  above. Use the **pooled** connection string, not the direct one.
- `ENCRYPTION_KEY` — required for a signed-in user to save a Tapetide key to
  their account (see "Bring-your-own Tapetide key" below); without it, that
  specific feature just fails gracefully rather than ever storing a key in
  plaintext. Generate one with
  `python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`.
- `MOONSHOT_API_KEY` — required for the chat assistant to function. Get one
  at https://platform.kimi.ai
- **No Tapetide key here** — see "Bring-your-own Tapetide key" above.
  Every user supplies their own via the website, sent per-request as the
  `X-Tapetide-Token` header, never a `.env` secret.
- `DEEPSEEK_API_KEY` / `ANTHROPIC_API_KEY` — optional, only needed if you swap
  the AI backend to `deepseek_service.py` / `claude_service.py`.
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

## Known constraints / things not to "fix" without asking

- **Fundamentals, price history, and analyst consensus all come from
  Tapetide deliberately now** (see "Sourcing" above and both providers'
  docstrings) — this is a live production workaround for Tickertape
  blocking Vercel's IPs, not a preference, and it costs real quota (10
  calls/search instead of the ~5 a brief Bharat-fundamentals window had).
  Don't "simplify" this back to Bharat-SM-Data for fundamentals, or make
  sourcing user-selectable again, without first re-verifying live from an
  actual Vercel deployment (not local dev, where Tickertape may work fine)
  that the block is gone. Tapetide's free tier is rate-limited (50
  calls/day at time of writing); all three fall back to `YFinanceProvider`
  automatically when that quota is hit. Some fields can still be genuinely
  unavailable depending on which provider answered a given piece (e.g.
  analyst consensus is `None` if both Tapetide and yfinance fail for it,
  and liquidity ratios are `None` regardless of provider now that
  fundamentals aren't Bharat's fuller balance sheet -- see "Tapetide is
  consumed as plain JSON-RPC" above) — this is expected and documented, not
  a bug to silently patch around with fabricated data. Missing fields
  should surface as "data unavailable for this metric," never a guessed
  value.
- **Every user brings their own Tapetide key (see "Bring-your-own Tapetide
  key" above) — don't reintroduce a shared server-side `TAPETIDE_TOKEN`.**
  A single shared key's 50-calls/day free tier cannot support more than one
  concurrent user, which is the entire reason this changed from the
  earlier single-owner-tool design. If Tapetide ever adds a hosted paid
  tier suitable for backing the whole site, that's a real product decision
  to make with the user, not something to default back to quietly.
- **The yfinance fallback trades reliability of source for availability.**
  It scrapes Yahoo Finance's undocumented endpoints rather than using a
  licensed API — treat a yfinance-served `consensus_source`/`active_source`
  as lower-confidence than a Tapetide-served one, not equivalent, even
  though there's no dropdown surfacing that distinction to the user anymore.
- The AI assistant must **not** give investment advice (buy/sell/hold
  recommendations, price targets). If asked, it should decline and redirect to
  explaining the underlying metric. This is enforced via the shared system
  prompt in `ai_prompt.py` plus a UI disclaimer — keep both in sync if you
  touch either.
- `MOONSHOT_MODEL` defaults to `kimi-k2.6` (general-purpose). `kimi-k2.7-code`
  is coding-specialized, not a better default for this app's financial-
  explainer use case, despite being newer.
- Neither DeepSeek's nor Moonshot's API access is covered by any Claude/
  claude.ai subscription (Pro, Max, etc.) or by each other's accounts — each
  is separately metered, pay-as-you-go billing. Don't assume a working key
  implies a funded account; both return billing-suspension errors that look
  superficially like rate limits (DeepSeek: HTTP 402; Moonshot: HTTP 429 with
  `exceeded_current_quota_error`) rather than authentication errors.
- Company name → ticker resolution goes through Tapetide's own `search_stocks`
  tool (fuzzy name/symbol/ISIN matching across ~8,200 NSE/BSE stocks), not a
  hardcoded lookup. Users can always type an explicit symbol (e.g. "RELIANCE")
  as a reliable fallback; `.NS`/`.BO` suffixes are stripped if present.
  **That fuzzy search can return a match with no real relation to the
  query** — confirmed live, not hypothetical: searching "AAPL" had it
  silently match some unrelated Indian company, and the app proceeded to
  fetch and would have returned real data for the wrong company (it only
  404'd that one time because Tapetide's quota happened to run out a few
  calls later, forcing a fallback whose own resolve_symbol correctly
  rejected "AAPL"). `main.py`'s `_looks_like_the_query` (called from
  `_fetch_company_core`, right after `get_company_info` — so it checks
  against real returned data, not the raw search hit) guards against this
  for both the Tapetide and yfinance-fallback paths: rejects with a 404
  unless the query has a real textual relationship to the matched ticker/
  resolved symbol/company name (exact match, a real prefix, or a substring
  either direction). Deliberately lenient, not exact-only, so abbreviation-
  style searches keep working ("TCS", "L&T", "ITC", a partial company
  name) — unit-tested against exactly those cases plus the AAPL scenario
  before deploying.

## Deployment

(2026-07) Deployed as a single Vercel project -- both the frontend and the
backend, not split across two services. This follows directly from
`lib/api.ts`'s `BASE_URL = "/api"` already being a same-origin relative
path (written that way for the dev proxy in `vite.config.ts`, but it works
unchanged in production too as long as both pieces share one domain).

**Live at `stackly-metrics.vercel.app`** (2026-08, renamed from
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
- **`vercel.json`'s `maxDuration: 60`** (the max Vercel's Hobby tier allows
  without enabling Fluid compute) gives headroom for `/api/company`'s worst
  case -- a Bharat-SM-Data fetch followed by up to two sequential Tapetide
  calls (each with its own 15s `requests` timeout in `tapetide_provider.py`)
  -- rather than the Hobby default, which has been too short for this in
  practice.
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
  `backend/.env` var -- see "Bring-your-own Tapetide key" below.

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

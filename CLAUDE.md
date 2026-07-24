# CLAUDE.md

Guidance for Claude Code (and any future contributor) working in this repository.

## What this project is

**FinAI Metrics** — a web app that fetches financial data for Indian public listed
companies (NSE/BSE) and computes standard financial ratios, with hover
popovers explaining what each metric means and whether the company's actual
value is healthy, an aggregate "Financial Health Snapshot" verdict, a
zoomable/pannable ~5-year weekly price history chart, a **separate** Share
Price Forecast chart (analyst-target fan: High/Mean/Low dashed lines from
today's price to the target date — deliberately its own card, not overlaid
on the price history chart, where a ~9-month-out fan was an imperceptible
sliver against 5 years of history), and third-party analyst consensus
(rating breakdown + price target range). Before any search, the empty state
shows a daily-rotating set of "recommended" companies, each badged with its
real, freshly-computed Health Snapshot verdict (see "Homepage
recommendations" below).

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
    bharat_sm_provider.py  Serves company info + raw financials for every search --
                            free, no quota (see its module docstring for why price
                            history/analyst consensus can't come from here instead)
    metrics.py              Pure functions: computes ratios from raw financials
    ai_prompt.py             Shared system prompt + context formatting (provider-agnostic)
    moonshot_service.py      Active AI backend, wraps the Moonshot (Kimi) API
    deepseek_service.py      Alternate AI backend using DeepSeek (not wired in)
    claude_service.py       Alternate AI backend using Anthropic Claude (not wired in)
    db.py                    SQLite connection + schema (users, sessions, activity_log)
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

**Hybrid sourcing: three providers, each with one fixed job, no user choice
involved.** (2026-07 -- this replaced an earlier design where the frontend
had a source-switcher dropdown letting the user pick Tapetide/Bharat/
yfinance per request; that dropdown is gone, see "Frontend layout" below.)
The split exists purely to cut Tapetide call volume: `bharat_provider`
(Bharat-SM-Data) serves company info + raw financials for **every** search,
free and unmetered, and Tapetide is reserved for the two things Bharat
structurally can't provide at all — price history and analyst consensus —
with `fallback_provider` (yfinance) silently taking over those two
specifically when a user's Tapetide quota is exhausted. Neither endpoint
takes a `source` query param anymore. `bharat_provider` and
`fallback_provider` stay module-level singletons in `main.py` (they need no
per-user credential); Tapetide does NOT — see "Bring-your-own Tapetide key"
below for why every `TapetideProvider` is now constructed fresh, per
request, from that request's own key rather than one shared instance.

- `GET /api/company/{query}` always calls `bharat_provider` for
  `info`/`raw` (no fallback -- if Bharat itself fails, the request fails,
  same as any single-provider error), computes `metric_groups`/
  `health_snapshot` from that, then -- only if the request carried a
  Tapetide key -- separately attempts
  `TapetideProvider(tapetide_token).get_analyst_consensus(info.resolved_symbol)`,
  falling back to `fallback_provider.get_analyst_consensus(...)` (yfinance,
  via its own `resolve_symbol`) on `ProviderQuotaExceededError`. This
  second half is best-effort: any failure (either provider, or simply no
  key present) just leaves `analyst_consensus` / `consensus_source` as
  `None` rather than failing the whole response -- third-party analyst data
  is a bonus on top of the fundamentals, not core to them.
- `GET /api/price-history/{symbol}` requires a Tapetide key (400 if
  missing -- unlike analyst consensus above, price history IS core to what
  this endpoint does) and always tries Tapetide first, falling back to
  `fallback_provider` (yfinance) on `ProviderQuotaExceededError`
  (`DataProviderError`'s quota-specific subclass; `tapetide_provider.py`
  raises it from `_call_tool` for both known quota signals — HTTP 429, and
  the plain-text-instead-of-JSON response body). If both providers fail,
  the endpoint returns a 502; an invalid key specifically
  (`InvalidTapetideKeyError`) returns 401.

`info.resolved_symbol` -- Bharat's plain ticker (e.g. `"RELIANCE"`), not
Tickertape's internal sid (`"RELI"`) that `bharat_sm_provider.py` uses
internally -- is what gets chained into both the Tapetide consensus call and
`/api/price-history/{symbol}` (called by the frontend with this same
value). Verified live that Tapetide's tools accept this bare-ticker form
directly, with no extra `resolve_symbol` round-trip needed on that side.

`CompanyFinancialsResponse.consensus_source: "tapetide" | "yfinance" | None`
and `PriceHistoryResponse.active_source: "tapetide" | "yfinance"` report
which provider served each of those two pieces (`DataSourceName` enum --
Bharat isn't a member; fundamentals are never reported per-response since
they always come from the same place now). Neither field drives any UI
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
**The count is persisted to `backend/.tapetide_quota_state.json`
(gitignored), keyed by a hash of the token, on every increment, not just
kept in memory** -- without this, any process restart (uvicorn `--reload`
firing on a routine `.py` edit during dev, or any redeploy in production)
would silently zero out "calls used today" back to the full quota,
understating real usage right up until Tapetide's own 429 catches you by
surprise. Keyed by token hash (never the raw token -- this file is plain
JSON on disk) specifically because every user has their own key now: a
single shared counter (the pre-multi-user design) would blend everyone's
usage into one number, which is worse than useless once each person's key
has its own independent 50-calls/day budget. This is separate, always-on
bookkeeping, deliberately not gated behind `DEV_CACHE_DIR` (that's an
opt-in response cache; this is a number the UI shows unconditionally).
`main.py`'s `TAPETIDE_CALLS_PER_SEARCH` (currently 5: 2 for analyst
consensus + 3 for price history, see the quota breakdown below) converts
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
(Tickertape's `balTca`/`balTcl`), unlike Tapetide's condensed format —
which is precisely why Bharat-SM-Data now serves fundamentals for **every**
search (see "Hybrid sourcing" above): liquidity ratios (current/quick/cash
ratio, working capital) that showed as permanent "N/A" under the old
Tapetide-only flow are now genuinely available. Because of the permanent
price-history gap, `get_price_history`/`get_recent_price_history`/
`get_analyst_consensus` on this provider are simply never called by
`main.py` — Tapetide (with yfinance fallback) covers those two
unconditionally instead, no per-request branching needed. Don't route
price history or analyst consensus through this provider without
re-verifying NSE's block is gone.

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
- The free tier is rate-limited (50 calls/day as of writing). Since
  fundamentals moved to Bharat-SM-Data (see "Hybrid sourcing" above), a full
  search now costs exactly **5 calls**, not the ~10 it cost when Tapetide
  served everything: `/api/company`'s analyst-consensus fetch costs 2
  (`get_company_profile`, cached 60s and fetched with `include=["ratings"]`
  so rating data rides along free, + `get_forecasts` for the price target);
  `/api/price-history` costs 3 (`get_price_history` × 2 for the 5-year
  weekly merge, `get_recent_price_history` × 1, daily, for the 1D/5D period
  buttons). That's **10 complete searches per day** on the free tier
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
    SettingsPanel.tsx        Slide-over: dark/light toggle (persisted to localStorage)
    AuthPanel.tsx            Slide-over: sign in/up form, or (once signed in) account
                              summary + recent activity feed + sign out -- see "Accounts
                              & activity tracking" below
    Sidebar.tsx              Left icon rail: switches between the search page and
                              ReturnCalculator (the app's two top-level views)
    CompanySearch.tsx        Ticker/company name input + "~N searches left today" quota
                              counter + Tapetide-reset countdown (no source dropdown --
                              sourcing is now fixed/hybrid, see "Hybrid sourcing" above)
    QuotaCounter.tsx          The "~N searches left today" pill -- shared by
                              CompanySearch.tsx and ReturnCalculator.tsx so both stay in sync
    RecommendedCompanies.tsx Empty-state suggestions, daily-rotating; badge verdict is
                              real Health Snapshot data but shown as plain grey text now,
                              not color-coded (see "Homepage recommendations" below)
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
specifically after a dark/light toggle, and specifically after a search
(since that's the only time these two chart components are mounted at
all). The fix follows directly from React's documented effect-ordering
guarantees; it wasn't independently reproduced frame-by-frame before
fixing (a live-rendered canvas glitch that self-corrects on the next
unrelated re-render is inherently hard to catch with a static screenshot).

**`MetricCard`'s popover and `HealthSnapshot` both carry `definition`/
`assessment`/`explanation` text computed server-side in `metrics.py`** (not
generated client-side or via the LLM) — see `_build_assessment` and
`compute_health_snapshot`. `HealthSnapshot` is deliberately worded as a
description of the *ratios* ("Strong Fundamentals", "driven by strong
profitability") and explicitly disclaims itself in the UI ("not a
recommendation to buy, sell, or hold") — this was a specific compliance
line drawn after the user asked for a buy/sell/hold verdict box and it was
scoped down instead; don't casually reintroduce buy/sell/hold wording here.

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

## Homepage recommendations

Before any search, the empty state shows 3-5 companies via
`RecommendedCompanies.tsx`, fetched from `GET /api/recommendations`. Two
constraints shaped this feature, both from direct user pushback during
development:

- **The verdict is real and computed, not a hand-picked label — but
  (2026-07) deliberately NOT color-coded on the card anymore.** `main.py`'s
  `get_recommendations` still calls `compute_metric_groups` +
  `compute_health_snapshot` — the exact same functions a real search uses —
  against each candidate, and still maps the resulting Strong/Mixed/Weak
  Fundamentals verdict onto the same `good`/`warning`/`bad` `MetricStatus`
  scale used everywhere else in the app (`_VERDICT_TO_STATUS`; a candidate
  that comes back "Not Enough Data" is still skipped entirely rather than
  shown with a fabricated neutral badge). What changed is the frontend:
  `RecommendedCompanies.tsx` no longer renders that status as a colored
  border/name on the card itself — a green/yellow/red badge on an untouched
  empty-state suggestion read as a "buy this" signal at a glance, the same
  kind of misleading-as-advice framing `HealthSnapshot`'s own compliance
  scoping already avoids. Every card is now plain neutral grey
  (`.recommended-company-card`, no `.good`/`.warning`/`.bad` variants); the
  verdict text still shows, just as plain uncolored text in the hover
  popover once there's an explanation alongside it for context. The backend
  still computes and returns `verdict` unchanged — only the frontend's
  presentation of it changed.
- **It must cost zero Tapetide quota.** `get_recommendations` is hardcoded
  to always use `bharat_provider`, never Tapetide — this predates and
  matches the "Hybrid sourcing" design above (fundamentals always come from
  Bharat now, everywhere in the app, not just here), and conveniently means
  the homepage works even before a visitor has entered a Tapetide key at
  all (see "Bring-your-own Tapetide key" below). The response is cached
  in-process, keyed by the calendar date (`_recommendations_cache`), so
  it's computed once per day, not once per page load.

`_RECOMMENDATION_POOL` (20 large-cap NSE tickers spanning sectors) is
rotated through deterministically — `day_of_year % len(pool)` picks the
start of a 5-ticker window — specifically *not* randomly, so every request
on the same day returns the same set (no flicker on refresh) while the set
still visibly changes day to day. **Clicking a recommended card is a normal
search** (`onSelect` → the same `handleSearch` the search bar uses), so it
goes through the app's regular hybrid sourcing like any other search — the
Bharat-sourced badge never influences which provider answers the click.

## Accounts & activity tracking

(2026-07) The only piece of genuinely persistent, user-specific state in
this app -- everything else is either fetched live from a provider or an
in-process cache that resets on restart (well, quota tracking is the
exception there too, see `tapetide_provider.py`'s `_QUOTA_STATE_PATH`).

**Sign-in is additive, never a gate.** Every feature in this app works
fully signed-out, exactly as before this existed. Signing in (via the
account icon in the header, `AuthPanel.tsx`) only starts recording your own
searches to an activity log you can see in the same panel. Don't make any
endpoint require auth without discussing it with the user first -- that
would be a real product change (turning an open tool into a walled one),
not just an implementation detail.

**Storage is SQLite (`backend/app.db`, gitignored), not Postgres/MySQL.**
This app had zero database before this feature, and a single on-disk file
needs no separate server process to run -- consistent with the project's
existing bias against adding infrastructure (see the dev-only response
caches in `tapetide_provider.py`/`bharat_sm_provider.py`, both plain files
on disk, same reasoning). `db.py` creates three tables on startup (`users`,
`sessions`, `activity_log`) via a plain `sqlite3.executescript` -- no ORM,
deliberately; three small tables don't need one.

**Auth is session tokens in a DB table, not a JWT.** `auth_service.py`
issues an opaque `secrets.token_urlsafe(32)` on signup/login, stored
server-side in `sessions` with a 30-day expiry. Every request needing auth
does a DB lookup rather than verifying a signature -- the right tradeoff at
this scale (SQLite, a handful of users), since it makes revocation ("sign
out everywhere") trivial (delete the row), which a stateless JWT can't do
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
there is no module-level singleton in `main.py` the way `bharat_provider`/
`fallback_provider` still are (see "Hybrid sourcing" above for why those
two didn't need this treatment). The key travels as the `X-Tapetide-Token`
header, read via `main.py`'s `_tapetide_token` dependency (returns `None`
if missing/blank -- callers decide whether that's fatal).

**The key lives in the browser's `localStorage` (`lib/tapetideKey.ts`),
never in the backend's database.** `lib/api.ts`'s `tapetideHeaders()`
attaches it to every request that needs it, the same pattern
`lib/auth.ts`/`authHeaders()` already established for sign-in tokens.
Storing a third-party secret server-side (even encrypted, even tied to a
signed-in user's account) would make this app responsible for protecting
it against a breach; keeping it client-only and forwarding it per-request
sidesteps that entirely. This does mean the key doesn't follow a signed-in
user across devices/browsers -- a deliberate tradeoff, not an oversight.

**`TapetideKeyGate.tsx` is a hard, blocking gate, not a dismissible
nudge** (unlike the sign-in banner above) -- rendered as an always-mounted
overlay in `App.tsx` whenever `getTapetideKey()` returns nothing,
`backdrop-filter: blur()`'d over the still-fully-rendered app behind it
(not blurred via a class toggle on the app root -- the gate doesn't need to
reach into anything else's DOM). It walks through getting a free key at
[tapetide.com](https://tapetide.com/settings/tokens) (linked wherever
"Tapetide" is mentioned in the copy) and ends in a single pill-shaped
input+button. Submitting calls `POST /api/tapetide/validate` *before*
storing anything -- a genuinely wrong key must never sit in localStorage
looking valid.

**`TapetideProvider.validate_key()` deliberately bypasses `DEV_CACHE_DIR`
(`use_cache=False`)** -- every other method on this class is fine being
served from the dev-only disk cache, but validation specifically must not
be: a cache hit returns before the network request (and Tapetide's own
auth check) ever happens, so if the validated query was ever cached by a
prior *real* call, literally any garbage token would appear "valid." This
was a real bug caught during live testing, not a hypothetical -- don't
remove `use_cache=False` from that one call site.

**Quota tracking is per-key now, not global** -- see `/api/quota` above
and `tapetide_provider.py`'s `_token_hash`/`_load_all_quota_state`. Each
user's own 50-calls/day budget is tracked independently, keyed by a hash of
their token.

## Environment variables

Backend reads from `backend/.env` (see `backend/.env.example`):

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

- **Fundamentals come from Bharat-SM-Data deliberately, price history and
  analyst consensus from Tapetide deliberately** (see "Hybrid sourcing"
  above and both providers' docstrings) — this is a fixed architectural
  split, not something to "simplify" back to a single provider or make
  user-selectable again. Tapetide's free tier is rate-limited (50 calls/day
  at time of writing); both endpoints fall back to `YFinanceProvider`
  automatically for the two things Tapetide covers when that quota is hit.
  Some fields can still be genuinely unavailable depending on which
  provider answered a given piece (e.g. analyst consensus is `None` if both
  Tapetide and yfinance fail for it) — this is expected and documented, not
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

<!-- Moved word for word from CLAUDE.md on 2026-11-25 (master plan Z1). The index is CLAUDE.md. -->
# Data sourcing

## Keyless, cache-first sourcing (2026-09)

> **Tapetide was removed entirely later in 2026-09** -- see "Tapetide
> integration (removed)" below. Paragraphs here that describe Tapetide
> fallthrough or its never-cached rule are history; yfinance is the only
> provider.

**yfinance is the PRIMARY source for fundamentals and price history, and it
needs no API key.** This supersedes the Tapetide-primary design described in
the "Sourcing" subsection above, which is kept for the history of *why*
things moved around. Neither `/api/company` nor `/api/price-history`
requires a key anymore; both 400s are gone.

**Why this was safe to do -- measured, not assumed.** Before switching,
`YFinanceProvider.get_raw_financials` + `compute_metric_groups` were run
against 15 real tickers. Ordinary non-financial companies (Reliance, TCS,
Asian Paints, DMart, Dixon, KPIT, RailTel) populate **all 21 metrics** --
strictly better than Tapetide, whose condensed balance sheet can never
produce the four liquidity ratios. Banks/NBFCs (HDFC Bank, SBI, Bajaj
Finance) populate 12 of 21, and most of those gaps are genuinely
inapplicable rather than missing (a bank has no inventory or gross profit).
Price history is a straight win: one call returns a clean 262-point weekly
5-year series, versus Tapetide's two-call merge working around its
oldest-rows-first truncation.

**The caches are what make a free, unofficial source viable.** Without them,
keyless would mean one yfinance call per visitor per search, which is the
sustained volume `yfinance_provider.py`'s docstring warns gets an IP
throttled -- breaking the app for everyone, not just the heavy user. Four
tables, all created idempotently in `db.py`, all **additive** (no existing
table was ever altered):

- `company_fundamentals_cache` -- statements/info/consensus, keyed by
  resolved symbol, shared across all users.
- `symbol_resolution_cache` -- "what the user typed" -> symbol. Exists
  because `resolve_symbol` costs two sequential network probes (~2.5-3.5s)
  for a bare ticker it must try as `.NS` then `.BO`.
- `price_history_cache` -- the OHLC series pair.
- `rate_limit_buckets` -- see "Rate limiting" below.

**Three freshness clocks, deliberately different** (`fundamentals_cache.py`):

| Data | TTL | Why |
| --- | --- | --- |
| Statements / info / consensus | 7 days | Financials change quarterly |
| `current_price` + `market_cap` overlay | 15 min | Move daily; feed P/E, P/B, dividend yield |
| Price history | 6 hours | The current week's bar moves while the market is open |
| Symbol resolution | 30 days | Only changes on a rename/delisting |

The price overlay is the subtle one: `RawFinancials` mixes data with very
different lifetimes, so a single 7-day TTL would serve a week-old share
price and make three valuation ratios silently wrong. The overlay refreshes
only `current_price`/`market_cap` via the cheap `fast_info` call
(`get_quick_price`), and only overrides fields that actually came back
non-None -- applying them unconditionally would blank out a good cached
value whenever `fast_info` returned one field but not the other.

**Graceful degradation ladder** (both endpoints, never a crash): fresh cache
hit -> serve; stale hit + refetch succeeds -> serve fresh; stale hit +
upstream unreachable -> **serve the stale row**, flagged via
`is_stale`/`fundamentals_as_of`/`history_as_of` on the response; cache miss
+ upstream fails -> clean 502. A genuine "no such company" is still a 404.

**Tapetide results are NEVER written to the shared cache.** That data is
metered against one user's own 50-calls/day key, so redistributing it to
every other visitor would both spend their quota on strangers and almost
certainly breach Tapetide's terms. Only `source = "yfinance"` rows exist in
`company_fundamentals_cache` -- there's a test asserting exactly that.

**Tapetide failures fall through to yfinance**, including its own fuzzy
search not finding a company. yfinance measurably has broader coverage, so a
user who supplied a key must never end up worse off than one who didn't.
The one exception is `InvalidTapetideKeyError`, which still 401s: a key the
user deliberately configured should fail loudly rather than silently
degrading.

**Connection discipline:** a Postgres connection is opened around database
work only and **never held across a yfinance call**. Holding one
idle-in-transaction for the seconds an upstream fetch takes is harmless with
one user and real pressure on Neon's pooler with many. The fully-cached path
costs one short connection; a miss costs two, with the network work between
them.

**Connections are reused (2026-11-16, `db.get_conn`).** A finished
connection (committed, so never idle-in-transaction) waits in a small idle
list (max 4) and the next `get_conn()` takes it; one used for over 5 s idle
is checked with `SELECT 1` (which starts the caller's transaction, so one
round trip), one idle over 240 s is dropped, and one that saw an error is
closed, never reused. Measured locally (India to Neon US): a cached
`/api/company` went from 11.4 s to 3.7 s. Also: Yahoo's four statements are
fetched in parallel after `info` (`get_financials_with_history`), and
`/api/company` looks up the lagged price and the profile at the same time.

### Renamed / delisted companies

`yfinance_provider.py`'s `_NAME_TO_SYMBOL` is a hand-maintained
company-name -> ticker map, and a hardcoded map is a guess about the world
that goes stale. A live audit of all 48 entries (2026-09) found **two dead
symbols**: `ZOMATO.NS` (the company renamed to Eternal Limited) and
`TATAMOTORS.NS` (Tata Motors demerged -- the commercial-vehicles entity kept
the legal name under `TMCV`, passenger vehicles listed separately as
`TMPV`). The other 31 symbols verified alive.

Three things to preserve here:

- **`resolve_symbol` validates a mapped symbol** with the same cheap
  `_symbol_has_data` probe the bare-ticker path uses, and falls through when
  the mapping is stale, so the map self-heals instead of silently rotting.
  It previously returned mapped symbols unvalidated, which is why one stale
  entry sent every request for that name to a dead ticker indefinitely. The
  cost (one `fast_info` call per *uncached* resolve) is affordable precisely
  because `symbol_resolution_cache` reduces that to at most once per query
  string per 30 days on the `/api/company` path.
- **If both the mapping and the probe fail, the mapping is returned
  anyway**, not a 404 -- from here a transient Yahoo failure is
  indistinguishable from a delisting, and a blip shouldn't turn a working
  lookup into "no such company".
- **`data_provider.FORMER_TICKERS`** records known renames in one shared,
  provider-agnostic place, because two unrelated things need it: the name
  map (to resolve the old name at all) and `main.py`'s
  `_looks_like_the_query` (to avoid rejecting its own correct answer --
  searching "zomato" resolves to ETERNAL.NS, whose company name shares no
  text with the query, so the textual-relationship guard would otherwise
  404 a correct match). Only add an entry once the old ticker is genuinely
  dead AND the new one is verified live; a wrong entry silently sends users
  to the wrong company, which is exactly what that guard exists to prevent.

Note `TMCV.NS` only listed at the demerger, so it legitimately has under a
year of price history. A short series for a recently-listed or recently-
demerged company is correct data, not a bug.

### Rate limiting

`rate_limit.py`, applied to `/api/company` and `/api/price-history` via a
FastAPI dependency so a rejected request costs one Postgres UPSERT rather
than an upstream fetch. Requiring a Tapetide key was never a security
control, but it did incidentally cap per-visitor traffic; without it nothing
stopped one client walking all ~8,200 NSE/BSE symbols.

Fixed windows, **40 requests/minute and 600/hour per IP**. Note these count
HTTP requests, not user actions -- one company view fires two rate-limited
requests, so the real allowance is ~20 lookups/minute. Deliberately more
generous than a one-user-per-IP model implies: this app's audience skews
student, and a campus, office or Indian mobile CGNAT puts dozens of genuine
users behind one address. Limits tight enough to be "correct" for one person
would block a classroom.

Two things not to "simplify":
- **Client IP prefers `x-vercel-forwarded-for`/`x-real-ip` over
  `x-forwarded-for`.** Proxies typically *append* to XFF, so trusting its
  first entry blindly lets a client supply its own header and rotate its
  apparent IP per request.
- **It fails OPEN.** If Postgres is unreachable the request is allowed. A
  limiter that turns a transient DB hiccup into a site-wide outage is worse
  than the abuse it prevents. That's an availability-over-enforcement
  trade-off, not an oversight.

**Known gap:** this is per-IP, not global. Ten IPs each staying just under
the limit could still generate real upstream volume. The cache absorbs most
of it, but there's no global ceiling. The principled refinement would be to
exempt *cache hits* from counting -- the thing worth limiting is misses, and
a scraper is all misses by definition -- but that needs the counter to run
after the cache lookup, so it's a restructure rather than a tweak.

## Tapetide integration (removed 2026-09)

**Tapetide is gone.** The provider class, the `X-Tapetide-Token` header,
`/api/quota`, `/api/tapetide/validate`, `/api/auth/tapetide-key`, the
Settings key panel, the quota counter and the stored keys are all removed.
Schema version 3 (`db.py`) blanks every `users.tapetide_key_encrypted`, then
drops that column and the `tapetide_quota` table; the frontend deletes any
leftover `finai_tapetide_key` from localStorage on load. `ENCRYPTION_KEY`
existed only to encrypt those keys and is no longer read. The shared modal
styles that started life as `.tapetide-gate-*` are now `.modal-*`.

Everything below this line in this section is history, kept for the
reasoning it records. Don't reintroduce a per-user third-party key without
discussing it with the user first.

### (History) Optional bring-your-own Tapetide key

**(2026-09) A Tapetide key is OPTIONAL. There is no key gate.** Visitors
land directly on a fully working app and never have to see the word
"Tapetide" -- yfinance is the primary source for fundamentals and price
history, backed by a shared Postgres cache (see "Keyless, cache-first
sourcing" below). Everything in this section describes an opt-in upgrade
path, not a requirement.

What changed, and why the rest of this section still reads the way it does:
from 2026-07 to 2026-09 this app *required* every visitor to obtain their
own Tapetide key before it would render anything at all --
`TapetideKeyGate.tsx` was a full-screen blocking overlay walking them
through signing up at tapetide.com. That was defensible while Tapetide was
the only viable source (its free tier is 50 calls/day per key, which one
shared key could never spread across many visitors), but for an app aimed
at students and first-time investors it was close to a total conversion
wall. `TapetideKeyGate.tsx` is **deleted**; `SettingsPanel.tsx` is now the
only place a key is ever entered. The historical detail below is kept
because the *mechanics* of how a key is validated, stored and encrypted are
unchanged -- only the "you must have one" part is gone.

**The `.tapetide-gate-*` CSS classes deliberately survive the gate's
deletion** and are now this app's generic modal look, used by
`TradingTutorial`, `MarketStatusNotice`, `ResetPasswordPanel`,
`ForgotPasswordForm`, `PaperTrading` and `SettingsPanel`. Don't delete them
as dead styles, and don't be confused by the name -- see TradingTutorial.tsx's
comment.

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

**Entering a key** now happens only in `SettingsPanel.tsx`. Submitting
calls `POST /api/tapetide/validate` (anonymous) or `POST
/api/auth/tapetide-key` (signed in -- validates the same way, then also
persists it to the account) *before* storing anything locally, so a
genuinely wrong key never sits in `localStorage` looking valid.

`App.tsx` still restores a saved key automatically on page load: if a
stored auth token resolves (via `fetchMe`) to a user with a saved key, and
this browser doesn't already have one in `localStorage`, it's adopted
immediately. The `!getTapetideKey()` check matters -- it deliberately never
overwrites a key someone's actively using locally just because they're also
signed into an account with a *different* saved key. Adopting a key also
triggers a `refreshQuota()`, since the mount-time one already ran and bailed
out before the key existed.

**The quota counter only exists when a key does.** `refreshQuota()` returns
early (setting `quota` to null) when `getTapetideKey()` is empty, rather
than letting `/api/quota` 400 on every page load for the now-common keyless
visitor. That null is also what hides `QuotaCounter` at all three of its
call sites (`CompanySearch`, `ReturnCalculator`, `StockMarketSimulator`),
which each guard on `quota` being non-null. The rule is: **no key -> no
counter, anywhere.** Note `quota` is in-memory React state and is never
persisted, so there's no stale-localStorage path that could resurrect it.

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
- **(2026-09) `GoogleSignInButton.tsx` polls briefly for `window.google`
  instead of checking once on mount.** Confirmed live as a real bug, not
  theoretical: the GSI `<script>` in `index.html` loads `async defer`, and
  the original code only ever checked `window.google` a single time, right
  when the component mounted. If that script hadn't finished loading yet
  at that exact moment (an entirely realistic race — the panel can open
  well before a network-fetched script resolves), `renderGoogleButton`'s
  own no-op guard silently gave up forever: the button never appeared for
  the rest of that mount, not even after the script finished loading
  moments later. Reproduced deterministically by delaying the script's
  response in a test and confirming the container stayed empty indefinitely
  post-fix-vs-pre-fix. Now polls every 100ms for up to 10s and renders the
  moment `window.google` becomes available, whichever check succeeds first.
  This was very likely the actual substance of "Google sign-in doesn't
  work" reports — no error shown anywhere, just a button that sometimes
  silently never rendered depending on load timing.


## 30-day share-price lag (2026-11)

To reduce SEBI and market-data risk before the pilot, **the API never serves
a share price less than 30 days old** (`services/price_lag.py`, pure and
tested). This is enforced server-side, not just hidden in the UI:
- `/api/price-history` cuts both series back to the cutoff (IST today minus
  30 days). A weekly bar counts only once its Monday + 6 days is on or before
  the cutoff, because yfinance gives a Monday-labelled bar the week's latest
  close (checked live). `price_as_of` is the newest close served. PriceChart
  has no 1D/5D buttons and labels the delay.
- `/api/company` replaces `raw.current_price`/`market_cap` with that lagged
  close (`_with_lagged_price`), so P/E, P/B, dividend yield and market cap
  use it too, labelled in the Valuation group. No lagged price available
  means N/A, never a newer price. The 15-minute price overlay is no longer
  fetched. `analyst_consensus` is always null in the response (still cached).
- Paper Trading is behind `SHOW_EXTRA_TOOLS`, and its `/api/trading/*`
  endpoints 404 unless `ENABLE_PAPER_TRADING=true` (backend setting).
- The caches still hold current prices; they just never leave the API.
The league uses company results only and was left alone.


## Known constraints / things not to "fix" without asking

- **Fundamentals, price history, and analyst consensus all come from
  Tapetide deliberately now** (see "Sourcing" above and both providers'
  docstrings) — **outdated as of 2026-09: yfinance is primary and Tapetide
  is optional, see "Keyless, cache-first sourcing".** Liquidity ratios are
  no longer permanently `None`; yfinance supplies the current-asset split
  that Tapetide's condensed balance sheet cannot. The rest of this bullet
  still holds as history: don't "simplify" sourcing back to Bharat-SM-Data
  for fundamentals, or make sourcing user-selectable again, without first
  re-verifying live from an
  actual Vercel deployment (not local dev, where Tickertape may work fine)
  that the block is gone. Some fields can still be genuinely
  unavailable depending on which provider answered a given piece (e.g.
  analyst consensus is `None` if both Tapetide and yfinance fail for it,
  and liquidity ratios were `None` regardless of provider back when
  fundamentals aren't Bharat's fuller balance sheet -- see "Tapetide is
  consumed as plain JSON-RPC" above) — this is expected and documented, not
  a bug to silently patch around with fabricated data. Missing fields
  should surface as "data unavailable for this metric," never a guessed
  value.
- **A Tapetide key is optional and per-user (see "Optional bring-your-own
  Tapetide key" above) — don't reintroduce a shared server-side
  `TAPETIDE_TOKEN`.** A single shared key's 50-calls/day free tier cannot
  support more than one concurrent user, which is the entire reason this
  changed from the earlier single-owner-tool design. Since 2026-09 the app
  needs no key at all to function; a user's own key only changes which
  provider is tried first. If Tapetide ever adds a hosted paid
  tier suitable for backing the whole site, that's a real product decision
  to make with the user, not something to default back to quietly.
- **yfinance is now the PRIMARY source, not just a fallback, and it trades
  reliability of source for availability.**
  It scrapes Yahoo Finance's undocumented endpoints rather than using a
  licensed API — treat a yfinance-served `consensus_source`/`active_source`
  as lower-confidence than a Tapetide-served one, not equivalent, even
  though there's no dropdown surfacing that distinction to the user anymore.
- The AI guide must **not** give investment advice (buy/sell/hold
  recommendations, price targets) or a share price. This is enforced on the
  server (services/guide.py: fixed replies before the model, and a check on
  every sentence before it is sent), not only in the prompt; keep the tests
  in tests/test_guide.py passing if you touch either.
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
  name) — checked against exactly those cases plus the AAPL scenario
  before deploying, via a throwaway script that was not committed (see
  "Testing" below).

<!-- Moved word for word from CLAUDE.md on 2026-11-25 (master plan Z1). The index is CLAUDE.md. -->
# Hidden and removed tools

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

## Paper Trading

(2026-09) The app's fourth top-level page (`PaperTrading.tsx`, via
Sidebar) -- buy/sell real NSE/BSE stocks with virtual money at their
current (delayed) market price, track a portfolio, and watch it move.
Deliberately a different thing from Market Simulator above: that page
generates a synthetic random price path for a hypothetical investment;
this page trades real, currently-quoted prices against a real (if
delayed) chart, just with fake cash. Sidebar's candlestick-pair icon is
this page's identity, distinct from the calculator's grid+dots and the
simulator's bars+dashed-line.

**Entirely yfinance-based, never Tapetide -- deliberately, not as a
stopgap.** Tapetide has no live-quote or intraday-bar capability at all
(see `tapetide_provider.py`'s documented tool set), and even if it did,
its 50-calls/day-per-key quota (see "Optional bring-your-own Tapetide key" above)
could not support the polling this page needs -- a single symbol polled
every 20s is already ~4,300 calls/day, and Paper Trading needs to poll
every picked/held symbol, not just one. `main.py`'s three
`/api/trading/*` endpoints (`search`, `quote`, `history`) call
`fallback_provider` (the same module-level `YFinanceProvider()` singleton
`/api/company`/`/api/price-history` already fall back to) directly and
need neither a Tapetide key nor a signed-in session -- see
`YFinanceProvider.get_live_quote`/`get_intraday_history` for the two
methods added specifically for this (deliberately NOT part of
`FinancialDataProvider`'s ABC, since Tapetide has no equivalent
capability to implement there -- see those methods' comment for the
reasoning and what a future real-time provider swap would need to match).

**All data here is labeled "Delayed," never "Live," because that's what
it genuinely is.** Yahoo Finance's NSE/BSE quotes are exchange-delayed
(commonly ~15 minutes, an undocumented exact figure) rather than a real
tick feed -- `LiveQuote.is_delayed`/`IntradayHistoryResponse.is_delayed`
are always `true` today, read by the frontend to render the "Delayed
data"/"Delayed" badges rather than the frontend assuming a label. A real
tick feed would need a paid broker API with market-data entitlements
(Zerodha Kite Connect or Upstox are the common Indian options) -- a real
recurring-cost decision to make explicitly with the user, not something
to default into. If one is ever wired in, it should implement the same
`get_live_quote`/`get_intraday_history` signatures and flip
`is_delayed`/`source` accordingly; no frontend change would be needed
beyond that, since the badges already read those fields rather than
hardcoding "Delayed".

**Polling, not websockets -- yfinance has no push/streaming capability at
all.** `useLiveQuotes.ts` polls every 20s (`POLL_INTERVAL_MS`), not "every
few seconds," specifically because yfinance's own undocumented guidance
(see `YFinanceProvider`'s module docstring) is to keep sustained request
volume comfortably under ~1-2 requests/second or risk temporary IP
throttling for every user of this app, not just whoever's polling. One
hook covers both the actively-picked/charted symbol (an array of one) and
a whole holdings table's worth of symbols at once, and is gated on a
`visible` prop (`view === "trading"` in `App.tsx`) so it stops polling
entirely while this tab isn't the active one -- see App.tsx's view-wrapper
comment for why every view stays mounted now and what that means for any
future view with its own polling/timers.

**The chart (`TradingChart.tsx`) is a new, separate component from
`PriceChart.tsx`, not a reuse/extension of it** -- a deliberate choice,
not an oversight: the range set (1D/1W/1M/3M/1Y/5Y, vs. PriceChart's
1D/5D/1Y/3Y/5Y), the need for a candlestick/line toggle (lightweight-
charts' `CandlestickSeries`, same library/version already used elsewhere
in this app -- no new dependency), and genuine intraday bars (vs.
PriceChart's weekly/daily-only granularity) are all real differences, not
things worth forcing into PriceChart's existing shape. `PricePoint.date`
carries a full "YYYY-MM-DDTHH:MM:SS" for intraday ranges (1D/1W) and
stays plain "YYYY-MM-DD" for the rest (see `get_intraday_history`'s
`intraday` flag) -- `TradingChart.tsx`'s `toChartTime` converts either
form to a UNIX-timestamp `Time` value for lightweight-charts, sidestepping
that library's stricter date-only "BusinessDay" string format entirely
rather than trying to make one string format serve both cases. The 1D
range additionally re-fetches every 60s (`ONE_DAY_REFRESH_MS`) to pick up
new bars through the trading day; every other range is a fixed historical
window that doesn't meaningfully change minute to minute, so re-fetching
it on the same cadence would just be wasted requests.

**Whole shares only -- no fractional-share trading**, matching how
NSE/BSE actually trade (unlike some US brokers). Enforced in
`usePortfolio.ts`'s `buy`/`sell` (`Number.isInteger` check), not just via
the quantity input's `step="1"`, since a pasted/scripted value could still
arrive non-integer otherwise.

**Portfolio state (cash, holdings, transactions) lives entirely in
localStorage (`lib/portfolio.ts`), never sent to the backend at all** --
same reasoning as the Tapetide key's default storage (see "Bring-your-own
Tapetide key" above): this app has no per-user backend store that doesn't
require being signed in, and every feature, Paper Trading included, works
fully signed-out. **Known, accepted limitation, not silently glossed
over**: a portfolio doesn't sync across devices/browsers, and clearing
site data erases it permanently -- stated plainly in the page's own footer
disclaimer, not just in this file. A signed-in-only backend store (a new
Postgres table, mirroring how a saved Tapetide key already works via
`auth_service.py`) would fix that, but was left as a deliberate follow-up
rather than built now, since it would make this one feature behave
differently signed-in vs. not, unlike everything else in the app.
`usePortfolio.ts` owns the actual trade math (weighted-average cost basis
on buys, realized P&L = `(sellPrice - avgBuyPrice) * qty` on sells,
insufficient-funds/oversell rejection) on top of `lib/portfolio.ts`'s pure
storage functions -- same separation of concerns as every other
storage-vs-logic split in this codebase.

**Starting balance is user-configurable from `SettingsPanel.tsx`**
(`lib/portfolio.ts`'s `getStartingBalance`/`setStartingBalance`, default
₹10,00,000), but changing it deliberately does NOT touch an
already-initialized portfolio's current cash balance -- it only changes
what a *future* first-use or "Reset portfolio" click seeds with. There's
no non-arbitrary way to apply a changed starting balance to an
in-progress portfolio that already has trades in it (add the difference
to cash? to holdings? neither is well-defined), so this sidesteps the
question entirely rather than picking an arbitrary answer -- worded
explicitly in the Settings row's own copy so it's never a surprise.

**(2026-09) The quantity input is wrapped in `.calculator-input-wrap` with
explicit +/- stepper buttons (`.trading-qty-step-btn`), not a bare
`<input type="number">`.** The original version lived outside that
wrapper entirely -- a real bug, not a style choice -- so it never
inherited the spinner-hiding rules every other numeric field in the app
already has (`.calculator-input-wrap input::-webkit-outer-spin-button`
etc.), and rendered with the browser's default, unstyled number spinner
next to properly-boxed fields elsewhere on the same page. Explicit +/-
buttons replace that spinner rather than just hiding it and leaving
scroll-wheel/arrow-key as the only way to adjust the value, which isn't
discoverable.

**(2026-09) Searching for a stock no longer hides itself behind the
picked-stock chip.** Originally, once a stock was picked, the search
form disappeared and only the chip (with an X to remove it) showed --
technically nothing stopped you from clearing it and searching a second
stock (holdings were never tied to "what's currently picked"), but the UI
made it read as if you had to. The chip and the search form now render
together whenever a stock is picked (`.calculator-stock-chip +
.calculator-stock-form { margin-top: ... }` in `app.css` adds the gap
between them only when both are present, so Calculator/Simulator's
chip-OR-form pages are unaffected), with a `.calculator-field-note` right
below spelling out that searching again doesn't touch existing holdings.
The submit button's label switches from "Use" to "Switch" once something
is already picked, and the placeholder changes too, so it's clear this
is "trade something else," not "start over."

**(2026-09) `TradingTutorial.tsx` -- a first-visit modal**, shown once
per browser (`finai_paper_trading_tutorial_seen` in localStorage) and
reachable again anytime via the "?" button next to the page heading
(`.trading-help-btn`). Reuses the shared `.tapetide-gate-*` overlay/card/steps
styling wholesale (`.tapetide-gate-*`) rather than inventing a second
modal pattern, including its optional-video approach: the `<video>`
points at `/videos/paper-trading-guide.mp4`, which does not exist yet as
of this writing -- an `onError` handler hides the element and falls back
to the text-only steps rather than showing a broken player. If a
walkthrough recording is made later, dropping the file at that exact path
is the only change needed; nothing else references it.

**(2026-09) "Delayed" badges now say `~15 min`, not a bare "Delayed."**
Yahoo (yfinance's source) doesn't publish an exact delay figure for NSE/
BSE quotes -- `PaperTrading.tsx`'s `APPROX_DELAY_LABEL` constant and the
page's own disclaimer both frame ~15 minutes explicitly as an
industry-typical figure for free retail data, not a number yfinance
itself guarantees, rather than stating it as if it were a documented fact.

**(2026-09) The currency is "coins," not rupees -- a relabel, NOT an
exchange-rate conversion.** Every cash/portfolio-value/P&L/share-price
figure in Paper Trading is formatted by `lib/coins.ts`
(`formatCoins`/`formatSignedCoins`/`formatCoinPrice`/`formatSignedCoinPrice`)
instead of `lib/format.ts`'s `formatINR` -- same numbers as before, no
symbol baked into the string at all now (1 coin == 1 rupee's worth of
buying power, still). Deliberately scoped to Paper Trading only: the rest
of the app (main dashboard, Return Calculator, Market Simulator) shows
REAL companies' REAL reported financials and REAL prices, which must stay
in real rupees -- relabeling those as a fictional currency would
misrepresent real data, not just reskin a game. `lib/coins.ts`'s module
comment spells this scoping out explicitly, and its own docstring flags
where a *real* exchange rate would need to be applied (before the value
reaches the formatter, not inside it) if a coins-per-rupee conversion is
ever added -- e.g. for a possible future "top up your balance" feature,
discussed but explicitly NOT built as part of this rename (see the user's
own framing:
"maybe in the future"). Don't conflate the two -- the rename shipped, the
conversion mechanic did not.

**(2026-09) The coin symbol is an SVG icon (`CoinIcon.tsx`), not an emoji
character baked into the formatted string.** A first pass used a 🪙 emoji
prefix directly in `lib/coins.ts`'s output (e.g. `"🪙1,000,000"`) --
replaced after direct user feedback that gluing it straight onto the
digits read as cluttered, not minimalist. `CoinIcon.tsx` is a plain
circle-in-circle outline (`stroke="currentColor"`, no fill), matching
every other icon in this app's family (Sidebar/Header/ExpandToggle all
use the same 1.6-1.8 stroke width, currentColor, no-fill convention) --
"white outline" in dark mode is just `currentColor` inheriting the
surrounding (light) text color, not a hardcoded white value, so it stays
correctly readable in light mode too. `lib/coins.ts`'s formatters now
return bare numbers with no symbol at all; `CoinAmount.tsx` is what
actually pairs the icon with a formatted number as one inline unit,
with a real `gap` between them (`.coin-amount` in `app.css`) instead of
zero spacing. Both the icon and the gap are sized in `em` so they scale
with whatever font-size context they're dropped into (a 1.4rem live price
vs. a 0.82rem table cell) without a size prop threaded through every call
site. The two plain-text trade-confirmation toast messages
(`handleBuy`/`handleSell` in `PaperTrading.tsx`) can't render a React
icon inside a string, so they still use `lib/coins.ts`'s formatters
directly with a hand-appended `" coins"` suffix -- the only place in this
feature that spells the unit out as a word rather than showing the icon.

**(2026-09) The page's own subtitle states the 1-coin-equals-₹1 parity
explicitly, with the actual `CoinIcon` inline (not the word "coins")** --
"virtual coins (1 [icon] = ₹1 in the real Indian stock market, so a stock
worth ₹500 costs 500 [icon] here)" in `PaperTrading.tsx`. This is the one
spot in the whole feature where the coin icon is dropped directly into a
sentence rather than paired with a number via `CoinAmount.tsx` -- `.coin-
icon`'s `vertical-align: -0.1em` in `app.css` exists specifically for this
bare-in-running-text case (inside `.coin-amount`'s flex container
elsewhere, `align-items: center` overrides it, so this rule is a no-op
there). Written out explicitly, rather than leaving the 1:1 parity as
something only `lib/coins.ts`'s code comments state, per direct user
request to make the exchange rate visible on the page itself.

**(2026-09) A frozen/unchanged live price during weekend/after-hours
testing is expected, not a bug -- verified live, not assumed.** NSE/BSE
only trade Mon-Fri during market hours; `get_live_quote` still fetches a
genuinely fresh response every poll (confirmed by calling it twice a few
seconds apart: `as_of` advanced both times, `price` was identical both
times) -- the *value* is correctly the real last-traded price, which
simply hasn't moved since the market's last close. Don't "fix" a report
of "the price never changes" by assuming the poll is broken without first
checking whether markets were even open in the window being tested.

**(2026-09) Holdings table rows are directly clickable (`.trading-
holdings-row`), not just the old separate "Trade" button.** Clicking a
row calls the same `selectHolding(symbol, name)` that used to live only
in that button's `onClick` -- switches the chart/trade panel above to
that holding, identical to what "Trade" did. The button itself was
removed rather than kept alongside the clickable row: a `<button>` nested
inside a clickable `<tr>` is a real accessibility anti-pattern (ambiguous
focus order, overlapping click targets), not just visual redundancy. A
plain chevron (`.trading-holdings-row-arrow`) replaces it as a hint that
the row is interactive, and the hover state itself does the rest of that
job -- a small lift (`translateY(-2px)`) using `--ease-snap` (the same
springy overshoot curve Sidebar's icon-scale hover and
`.calculator-scenario-tile` already use for "this is clickable" bounce
feedback elsewhere in the app), with the arrow sliding right and picking
up `--accent` color on the same hover.

**(2026-09) "Analysis" tab -- a second, interactive view on the Paper
Trading page, alongside "Trade".** `PaperTrading.tsx` now has a
`.calculator-mode-toggle` (the same segmented control Return
Calculator/Market Simulator already use) switching between the original
buy/sell/chart/holdings/transactions view ("Trade") and a new
`PortfolioAnalysis.tsx` ("Analysis") that shows the portfolio's
performance as a whole rather than one stock at a time. Cash
balance/portfolio value/total P&L stay visible above the toggle
regardless of which tab is active; Reset portfolio and the storage
disclaimer stay below both, for the same reason.

- **Everything except the value-over-time chart is synchronous, computed
  straight from `portfolio`/`liveQuotes` already in memory** -- no new
  network calls needed for the stat grid or allocation breakdown.
  Realized P&L sums every sell transaction's own `realizedPnl` (already
  computed by `usePortfolio.ts` at trade time); unrealized P&L is current
  holdings value minus their cost basis (`qty * avgBuyPrice` summed);
  win rate is (sells with positive `realizedPnl`) / (all sells with a
  non-null `realizedPnl`) -- `null` (shown as "--", with an explanatory
  note) rather than 0% before any stock has ever been sold, since "0% win
  rate" and "no sells yet" are different facts a bare percentage can't
  tell apart. Best/worst closed trade pick the single sell transaction
  with the highest/lowest `realizedPnl` -- both omitted if nothing's ever
  been sold, and "worst" is hidden (not just deduplicated visually) when
  there's only one sell, since best and worst would otherwise be the
  identical transaction shown twice.
- **The allocation breakdown is a hand-rolled proportional bar
  (`.portfolio-allocation-bar`), not a pie/donut chart** --
  lightweight-charts (this app's only charting dependency, see Price
  History/Forecast/Simulator/Trading charts above) has no chart type for
  "static proportions of a whole" at all, being built entirely around a
  time axis; pulling in a second charting library for one static breakdown
  wasn't worth a new dependency. Each holding (plus a "Cash" segment) gets
  a `hsl()` color spaced by the golden angle (`137.508deg * index`) rather
  than a fixed named palette, so it stays visually distinct regardless of
  how many stocks a portfolio ends up holding, with Cash always pinned to
  a neutral `--text-tertiary` grey rather than competing for a "real"
  holding's hue. **Interactive**: hovering either the bar segment or its
  matching legend row highlights both together (`hoveredSymbol` state
  drives a `.highlighted` class on each), and clicking a non-cash legend
  row calls the same `selectHolding` the Trade tab's holdings table
  already uses, plus switches `activeTab` back to `"trade"` -- clicking a
  holding here is a shortcut to "go look at this stock," identical in
  spirit to the holdings-table row bounce/click above.
- **The portfolio-value-over-time chart (`PortfolioValueChart.tsx`) is the
  one part of this feature that costs real work, because this app has
  genuinely never stored a portfolio value history anywhere.**
  `lib/portfolio.ts` only ever tracks *current* cash + holdings -- there
  was never a "what was it worth last Tuesday" number sitting in
  localStorage to read. `lib/portfolioHistory.ts`'s
  `buildPortfolioValueSeries` reconstructs one instead, purely from data
  that already exists: it replays every real transaction chronologically
  against every ever-traded symbol's own real historical closing prices
  (fetched via the existing `/api/trading/history` endpoint, one call per
  distinct symbol ever bought/sold -- not per current holding, since a
  fully-sold-off position still needs its price history to correctly
  compute the portfolio's value on the days it *was* held). `pickHistoryRange`
  maps the span since the first-ever transaction to one of
  `/api/trading/history`'s fixed ranges (1D/1W/1M/3M/1Y/5Y -- that
  endpoint has no arbitrary-custom-window option), erring wide (e.g. a
  40-day-old portfolio gets "3M," not a precise 41 days). The chart is
  colored `--accent`, like every other *real*-data chart in this app
  (PriceChart, TradingChart) -- deliberately not `--status-warning`, which
  is reserved for Market Simulator's synthetic random walk (see "Market
  Simulator" above); this chart's every point comes from a real,
  independently-verifiable past price and the real transaction log, so it
  earns the "trustworthy" color.
  - **A real bug, caught before shipping, not left in speculatively:**
    the reconstruction's first version filtered candidate x-axis
    timestamps to `>= firstTradeMs` (the exact millisecond of the first
    transaction). Daily/weekly `PricePoint`s are always stamped at that
    day's UTC midnight -- which is *always* earlier than whatever time of
    day a real trade actually happened -- so that filter silently dropped
    the entire first trading day's point on every single portfolio, every
    time, shifting every later point's apparent position by one. Caught
    by writing a throwaway script with hand-computed expected values
    (buy 10 @ ₹100 day 1, sell 5 @ ₹120 day 3, checked against the
    expected value at each of 4 days) before this ever reached the UI --
    it failed exactly as predicted, confirming this wasn't theoretical.
    **That script was never committed** -- see "Testing" below. Fixed by
    flooring the comparison to the first trade's own
    calendar day (`Date.UTC(year, month, date)` of that instant) instead
    of the instant itself; re-ran the same test to confirm all 4 points
    then matched exactly. A symbol whose price-history fetch fails
    entirely falls back to using that holding's own weighted-average buy
    price as a flat stand-in for every timestamp -- a disclosed
    approximation (surfaced via a `.calculator-field-note` under the
    chart), not silently dropping that holding's value from the whole
    series.
  - The series' very last point is always overwritten with the
    live-computed `totalValue` already shown in the summary tiles above
    (not just whatever the reconstruction's own last real data point
    says), so the chart's right edge can never visibly disagree with the
    numbers directly above it -- the reconstructed series' true last point
    can be up to a full trading day stale for daily-granularity ranges.

**(2026-09) `MarketStatusNotice.tsx` -- a modal explaining a closed market
on Paper Trading, so a frozen live price reads as expected, not broken.**
Built directly off a real user report: on an ordinary-looking Monday,
Paper Trading's prices genuinely hadn't moved since Friday -- confirmed
live (see the `get_live_quote` weekend investigation above) to be a real
NSE/BSE holiday (Ganesh Chaturthi), not a polling bug, but nothing in the
UI said so; a user has no reason to know India's holiday calendar off the
top of their head. Rendered in `PaperTrading.tsx` alongside
`TradingTutorial`, gated on `visible && !showTutorial` so a first-time
visitor sees the onboarding tutorial first, never both overlays stacked.

- **`lib/marketHolidays.ts` is a hand-maintained static list
  (`NSE_HOLIDAYS_2026`), not a live lookup** -- neither Tapetide nor
  yfinance expose an "is the market open, and why not" endpoint, and
  there's no free, reliable holiday-calendar API worth a new dependency
  for one list that changes once a year. Cross-verified against two
  independent published 2026 calendars (Zerodha's and Groww's own holiday
  pages, which agreed on every date) before shipping, rather than trusting
  a single source -- a wrong date here would either falsely claim a real
  trading day is a holiday, or silently miss a real one. **Needs a manual
  refresh every December** for the coming year; a date simply absent from
  the list is treated as an ordinary trading day, so an unrefreshed list
  doesn't break anything, it just silently stops flagging holidays once
  the year rolls over -- there's no runtime check that this list still
  covers "today." Deliberately excludes holidays that land on a weekend
  already (e.g. 2026-11-08, Diwali Laxmi Pujan, a Sunday with a special
  short evening "Muhurat Trading" session) -- weekends are covered
  separately, and that symbolic ~1hr session isn't something this app's
  regular-hours polling reflects anyway.
- **"Today" is computed in India Standard Time, not the visitor's own
  browser timezone** (`todayInIndia()`, via
  `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" })`) --
  otherwise a visitor checking from a very different timezone could see
  the wrong weekday/holiday near a midnight-IST boundary, exactly the kind
  of subtle bug this app's other date-handling code has been bitten by
  before (see Return Calculator's calendar-year iteration above). Verified
  with a throwaway mocked-clock script before shipping (not committed --
  see "Testing" below): 19:00 UTC (which is already
  past midnight in India, i.e. the next calendar day there) correctly
  resolved to the *next* day's weekday/holiday status, not the previous
  day's -- confirming this isn't just "correct by accident" for whatever
  moment it happened to be tested at.
- **Holiday and weekend notices are dismissible the same way (a "Got it"
  button, no explicit modal-close ✕), but only the weekend one offers a
  persistent "don't show this again"** (`finai_weekend_market_notice_
  dismissed` in localStorage) -- a deliberate, direct product distinction
  from the user, not an oversight: weekends recur every single week, so a
  one-time acknowledgment makes sense, while holidays are comparatively
  rare and each one states a different fact ("closed today for X"), worth
  surfacing again each time one actually occurs. Both are naturally
  session-scoped even without the persistent flag -- `dismissed` is
  component-local state that survives for as long as `PaperTrading` stays
  mounted, which per the view-wrapper pattern above is the entire time the
  app is open, not just while this tab is active.

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

## Financial Health Snapshot (removed from UI 2026-09)

The company page used to show a "Strong/Mixed/Weak Fundamentals" verdict
tile (`HealthSnapshot.tsx`) inline next to Analyst Consensus in
`.summary-row`, right below the two charts. Removed at the user's request
because the light-mode visual pass this same round made it clear the tile
wasn't earning its place next to the (already-kept) Analyst Consensus card
-- a product/design call, not a bug fix. `AnalystConsensus` now renders
alone in that row, spanning its full width (`fullWidth` prop on
`AnalystConsensus.tsx`, `.analyst-card.full-width { grid-column: 1 / -1; }`
in `app.css`, mirroring the `.health-snapshot.full-width` rule the removed
component used to fall back to when there was no analyst coverage to show
beside it). The row itself is now only rendered at all when
`hasConsensus` is true -- previously HealthSnapshot always rendered
something even without consensus data, so an empty row is a genuinely new
possible state, not a regression of an old one.

**The backend side was deliberately left untouched.** `compute_health_snapshot`
(`metrics.py`) still runs on every search and `CompanyFinancialsResponse`
still carries `health_snapshot` on the wire -- removing that too would
have been scope creep on a frontend-only ask, and the computation is cheap
(pure function over already-fetched data, no extra Tapetide call). Bring
the frontend tile back by re-adding `HealthSnapshot.tsx` (see git history
for the last version before removal) and rendering it from
`MetricsDashboard.tsx`'s already-destructured `health_snapshot` prop,
rather than touching anything server-side.

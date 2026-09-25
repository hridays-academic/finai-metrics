# Stackly

A web app for learning to read the financials of Indian public listed
companies (NSE/BSE). Search a company and you get a full-width dashboard of
21 colour-coded financial ratios, each with a hover popover explaining in
plain English what the metric measures and whether this company's actual
number sits in a healthy range; a zoomable ~5-year weekly price history
chart; a separate Share Price Forecast chart (an analyst High/Mean/Low
target fan, given its own card so a ~9-month fan isn't an invisible sliver
against 5 years of history); and a third-party analyst consensus card,
clearly attributed as sell-side opinion rather than the app's own view.

**No signup and no API key are required.** Open the site and search.

> **On investment advice:** this app is educational. It describes the ratios
> it computes and relays third-party analyst opinion with attribution. It
> never generates its own buy/sell/hold call or price target, and that line
> is deliberate — see `CLAUDE.md`.

## The four modules

Switchable from the left icon rail; all four stay mounted, so moving between
them never discards what you'd picked.

1. **Metrics analyser** — search a company, get its ratios grouped into
   Liquidity, Profitability, Leverage, Efficiency and Valuation, each with a
   definition, the formula, a conventional healthy range, and a value-aware
   assessment of this specific company's number.
2. **Return Calculator** — a compound-growth projection personalised to a
   real picked stock, driven by its most recently completed calendar year's
   performance (falling back to the analyst consensus target for a stock too
   new to have one). The rate's basis is always labelled so it's never
   ambiguous whether a figure is backward- or forward-looking.
3. **Market Simulator** — a Monte Carlo "what if": generates a *random*
   future price path via geometric Brownian motion, seeded from the stock's
   own historical drift and volatility. Explicitly not a forecast, disclosed
   twice on the page, and drawn in a different colour from every real-data
   chart in the app so it never reads as observed data.
4. **Paper Trading** — buy and sell real NSE/BSE stocks with virtual
   "coins" at their current (delayed) price, with a candlestick chart, a
   portfolio, and an Analysis tab showing realised/unrealised P&L, win rate,
   allocation, and portfolio value reconstructed over time from your real
   transaction log against real historical prices.

## Stack

- **Backend: Python + FastAPI + Pydantic v2.** Typed request/response
  models and automatic docs at `/docs`. Deployment pins 3.12
  (`.python-version`); local development has been on 3.13.
- **Database: Neon Postgres**, accessed with `psycopg` v3 directly — no ORM.
  Backs user accounts, sessions, activity logs, the data caches and rate
  limiting.
- **Frontend: React 18 + Vite 6 + TypeScript**, with exactly three runtime
  dependencies (`react`, `react-dom`, `lightweight-charts`). No router, no
  state library, no CSS framework — theming is plain CSS custom properties.
- **Charts: `lightweight-charts`** (TradingView's open-source library) for
  native zoom/pan/crosshair behaviour.
- **Deployment: a single Vercel project** serving both the built frontend and
  the FastAPI backend as Python functions, so there's one origin and no CORS
  in production.

## Where the data comes from

**yfinance is the primary source, and it needs no API key.** That's what
makes the app usable without signup. Because Yahoo's endpoints are
unofficial and rate-sensitive, responses are cached in Postgres and shared
across all visitors — one real upstream fetch serves everyone looking at
that company until it goes stale.

Two freshness clocks, deliberately:

| Data | TTL | Why |
| --- | --- | --- |
| Statements, company info, analyst consensus | 7 days | Financials change quarterly |
| `current_price` / `market_cap` | 15 minutes | They move daily and feed P/E, P/B and dividend yield |
| Price history (OHLC series) | 6 hours | The current week's bar keeps moving while the market is open |

A single TTL would either serve a week-old share price — making three
valuation ratios quietly wrong — or throw away the expensive statement fetch
every 15 minutes.

**Tapetide is an optional upgrade.** Add your own free key in Settings and
the backend will try Tapetide first, mainly for its more precise
analyst-target periods, falling back to yfinance automatically when its
50-calls/day free tier is exhausted. Tapetide results are deliberately
**never written to the shared cache**: that data is metered against your
personal key, so redistributing it to other visitors would spend your quota
on strangers. Everything works identically without a key.

Sources are abstracted behind `FinancialDataProvider`
(`backend/app/services/data_provider.py`). A third implementation,
`BharatSMProvider`, is fully written but **not wired into the app** —
Tickertape (which it wraps) blocks Vercel's IP range. It's kept dormant in
case that ever lifts.

### Honest limitations

- **All market data here is delayed**, commonly by around 15 minutes for
  free Indian retail data. Paper Trading labels this explicitly rather than
  implying a live tick feed. A real-time feed would require a paid broker
  API with market-data entitlements.
- **Banks and NBFCs show more "N/A" metrics** — roughly 12 of 21 populate.
  Financial-sector filings genuinely lack inventory, gross profit and a
  current/non-current split, so those ratios aren't merely missing, they're
  inapplicable. Ordinary non-financial companies populate all 21.
- **A missing figure always renders "N/A", never a guess.** `metrics.py`
  returns `None` for any metric whose inputs are unavailable, and the cache
  round-trips nulls as nulls specifically so this behaves identically whether
  data was fetched live or served from cache.
- **Requests are rate-limited per IP** (40/minute, 600/hour — roughly 20 and
  300 company lookups respectively, since one view makes two requests). This
  protects the shared yfinance access for everyone.

## Project structure

```
backend/app/
  main.py                   FastAPI app, routes, the symbol-match guard
  config.py                 Env var loading
  models.py                 Pydantic schemas
  services/
    data_provider.py        Provider interface, errors, known-rename table
    yfinance_provider.py    PRIMARY source (no key needed)
    tapetide_provider.py    Optional bring-your-own-key source
    bharat_sm_provider.py   Dormant — not wired in (IP-blocked on Vercel)
    fundamentals_cache.py   Postgres cache: statements, price overlay, OHLC
    rate_limit.py           Per-IP fixed-window limiting (Postgres-backed)
    metrics.py              Ratio calculations — pure functions
    db.py                   Postgres connection + idempotent schema
    auth_service.py         Signup/login/sessions/activity, Google Sign-In
    gmail_service.py        Password-reset email via Gmail SMTP
    ai_prompt.py            Shared system prompt (see "AI assistant" below)
    moonshot_service.py     Active AI backend; deepseek/claude are alternates
frontend/src/
  App.tsx                   Root: theme, auth, selected company, active view
  components/               27 components across the four modules
  hooks/                    useTheme, usePortfolio, useLiveQuotes
  lib/                      API client, types, formatters, portfolio storage
  styles/                   theme.css (tokens) + app.css (layout)
api/index.py                Vercel entry point — re-exports the ASGI app
CLAUDE.md                   Detailed design notes and rationale
```

### AI assistant — backend only

`POST /api/chat` works and is wired to Moonshot (Kimi), with DeepSeek and
Anthropic implementations kept as swappable alternates. **It is not rendered
anywhere in the frontend** — the chat UI was removed to keep the site to a
single full-width metrics view. The metric explanations you see in the app
are *not* AI-generated; they're computed server-side in `metrics.py`, which
makes them reproducible, instant, free, and incapable of inventing a number.
See `CLAUDE.md` to bring the chat UI back.

## Running locally

### Prerequisites

- Python 3.12 or 3.13 (deployment pins 3.12 via `.python-version`)
- Node.js 18+ and npm
- A Postgres connection string. [Neon](https://neon.tech)'s free tier is
  permanent and needs no credit card. **This is the only required
  credential.**

### 1. Install

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cd ../frontend
npm install
```

### 2. Configure

```bash
cd backend
cp .env.example .env
```

Set `DATABASE_URL` to your Neon **pooled** connection string (the `-pooler`
hostname). The app opens a fresh connection per request, which is exactly
what the pooler exists for. Tables are created idempotently on first start.

Everything else is optional: `ENCRYPTION_KEY` (lets a signed-in user save a
Tapetide key to their account), `GOOGLE_CLIENT_ID` (Google Sign-In),
`GMAIL_ADDRESS` / `GMAIL_APP_PASSWORD` (password-reset emails),
`MOONSHOT_API_KEY` (the unrendered chat endpoint). **There is no
`TAPETIDE_TOKEN`** — Tapetide is per-user and never a server-side secret.

`.env` is git-ignored. Never commit it or hardcode a key in source.

### 3. Run

Two terminals:

```bash
# backend/ with the virtualenv active
uvicorn app.main:app --reload --port 8000

# frontend/
npm run dev
```

Open http://localhost:5173. Vite proxies `/api/*` to port 8000, so the
frontend never needs the backend's address. Health check:
http://localhost:8000/api/health · API docs: http://localhost:8000/docs

## Tests

**There is no committed test suite.** Testing throughout development has
been ad-hoc: throwaway scripts run against the real API and database to
verify a change, then discarded. Several are described in `CLAUDE.md`'s
history as though they were permanent; they were not committed.

The highest-value place to start, if adding one, is the pure functions —
`metrics.py`, `lib/portfolioHistory.ts`, `lib/marketHolidays.ts` and
`main.py`'s `_looks_like_the_query` — all of which are dependency-free and
directly testable.

## Troubleshooting

- **"Could not find '\<company\>' on NSE/BSE"** — try the exact ticker
  (`RELIANCE`, `TCS`). Company-name lookup uses a curated map plus a
  ticker probe, not a general search engine.
- **"That's a lot of requests in a short time"** — the per-IP rate limit.
  Wait for the period given in the message. Note a shared network (campus,
  office, mobile CGNAT) counts as one IP.
- **A company's data looks a few days old** — expected. Statements are
  cached for 7 days; the response carries `fundamentals_as_of`, and
  `is_stale` is set when data is served past its window because the upstream
  source was unreachable.
- **Paper Trading's price never changes** — NSE/BSE are closed. The app
  shows a notice for weekends and for holidays in its hand-maintained 2026
  calendar (`lib/marketHolidays.ts`, needs a manual refresh each December).
- **CORS errors in local dev** — check the frontend's origin matches
  `CORS_ORIGINS` in `backend/.env` (default `http://localhost:5173`).
  Production is single-origin, so this only affects local development.

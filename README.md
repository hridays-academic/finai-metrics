# FinAI Metrics

A web app for exploring financial metrics and ratios of Indian public listed
companies (NSE/BSE): a full-width dashboard of color-coded ratios, each with
a hover popover explaining what it means and whether the company's actual
number is healthy, an aggregate Financial Health Snapshot at the top, a
zoomable/pannable ~5-year weekly price history chart, a separate Share
Price Forecast chart (analyst High/Mean/Low target fan, its own card so the
~9-month fan isn't lost against 5 years of history), and a third-party
analyst consensus widget (rating breakdown + price target range) -- clearly
attributed as external opinion, not the app's own. Before any search, the
empty state suggests a handful of companies, each badged with its real
Health Snapshot verdict (computed via Bharat-SM-Data so it costs no
Tapetide quota) -- see `CLAUDE.md`'s "Homepage recommendations" section.

> The backend also includes a working AI chat assistant (`POST /api/chat`,
> three swappable LLM backends) that isn't currently rendered in the
> frontend -- it was removed from the UI to keep the site to a single
> full-width metrics view. See `CLAUDE.md` if you want to bring it back.

## Stack & why

- **Backend: Python + FastAPI.** FastAPI gives typed request/response models
  (Pydantic) and automatic docs at `/docs`, which pairs well with a strict
  data layer.
- **Frontend: React + Vite + TypeScript.** Fast dev server, no-frills
  component model for the dashboard, and TypeScript keeps the frontend's
  data shapes in sync with the backend's Pydantic models. The price chart
  uses `lightweight-charts` (TradingView's open-source charting library) for
  native zoom/pan/crosshair behavior without hand-rolling chart interaction.
- **Data source: Tapetide** (https://tapetide.com), an MCP server purpose-built
  for NSE/BSE data (quotes, financials, ratios) for ~8,200 Indian stocks. It's
  consumed here as plain JSON-RPC over HTTP (no MCP client library needed) --
  see "Data source notes" below for its coverage limitations and free-tier
  rate limit.
- **A source-switcher in the UI** lets you pick Tapetide, yfinance, or
  Bharat-SM-Data explicitly, or leave it on the default ("auto"), which tries
  Tapetide and falls back to yfinance automatically if its daily quota is
  exhausted -- see "Data source notes" below for what each one does and
  doesn't cover.

The data source is abstracted behind `FinancialDataProvider`
(`backend/app/services/data_provider.py`). `TapetideProvider` is primary;
`YFinanceProvider` is a live automatic-or-selectable fallback; and
`BharatSMProvider` (wrapping the open-source `Bharat-sm-data` package) is a
third, selectable-only source with fundamentals but no price history (see
below). Adding another provider (Alpha Vantage, Financial Modeling Prep,
etc.) means implementing the same interface and wiring it into `main.py`'s
`source` query-param handling, without touching the metrics engine or API
route shapes.

## Project structure

```
backend/
  app/
    main.py                   FastAPI app, routes
    config.py                 Env var loading
    models.py                 Pydantic schemas
    services/
      data_provider.py        Abstract data provider interface
      tapetide_provider.py     Tapetide MCP implementation (primary)
      yfinance_provider.py    yfinance implementation (automatic/selectable fallback)
      bharat_sm_provider.py   Bharat-SM-Data implementation (selectable only, no price history)
      metrics.py               Ratio calculations (pure functions)
      ai_prompt.py              Shared system prompt + context formatting
      moonshot_service.py       Moonshot (Kimi) API wrapper (default AI backend)
      deepseek_service.py       DeepSeek API wrapper (alternate, not wired in)
      claude_service.py        Anthropic API wrapper (alternate, not wired in)
  requirements.txt
  .env.example
frontend/
  src/
    App.tsx
    components/               Header, SettingsPanel, CompanySearch,
                               MetricsDashboard, MetricCard, HealthSnapshot,
                               PriceChart, AnalystConsensus
    hooks/useTheme.ts          Dark/light mode, persisted to localStorage
    lib/                       API client, TS types, formatters
    styles/                    theme.css (tokens) + app.css (layout)
  package.json
  vite.config.ts
CLAUDE.md                     Notes for future development in this repo
```

## Prerequisites

- Python 3.10+
- Node.js 18+ and npm
- A Tapetide personal token (free): https://tapetide.com/settings/tokens
- A Moonshot AI (Kimi) API key -- optional, only needed if you re-add the
  chat UI or call `/api/chat` directly: https://platform.kimi.ai

## 1. Install dependencies

**Backend:**

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

**Frontend:**

```bash
cd frontend
npm install
```

## 2. Add your API keys

```bash
cd backend
cp .env.example .env
```

There's no Tapetide key to set here -- **every user brings their own**.
The site itself asks for it: on first load it shows a full-screen guide to
generating a free key at [tapetide.com](https://tapetide.com/settings/tokens)
and a box to paste it into, and stores it in your browser (not on the
server). This is what makes the site usable by more than one person at once
-- Tapetide's free tier is 50 calls/day per key, which one shared key could
never support for multiple visitors.

`backend/.env` still has a few *optional* keys: `MOONSHOT_API_KEY` powers
the `/api/chat` endpoint, which the frontend no longer calls (see the note
at the top of this file) -- set it only if you're re-adding the chat UI or
calling that endpoint directly. `DEEPSEEK_API_KEY` / `ANTHROPIC_API_KEY` are
only used if you swap the AI backend to `deepseek_service.py` /
`claude_service.py`; `ALPHA_VANTAGE_API_KEY` and `FMP_API_KEY` are
placeholders for future data-provider swaps. None of them are required just
to run the site and search a company.

The `.env` file is git-ignored -- never commit it, and never hardcode a key
anywhere in source.

## 3. Run locally

Run each in its own terminal.

**Backend** (from `backend/`, with the virtualenv active):

```bash
uvicorn app.main:app --reload --port 8000
```

Health check: http://localhost:8000/api/health
Interactive API docs: http://localhost:8000/docs

**Frontend** (from `frontend/`):

```bash
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api/*` requests to
the backend on port 8000 (see `frontend/vite.config.ts`), so the frontend
never needs to know the backend's address directly.

## Using the app

1. Enter a company name (e.g. "Reliance", "TCS", "Infosys") or an explicit
   ticker (e.g. `RELIANCE`, `TCS`) in the search bar and press Search -- or
   click one of the suggested companies on the empty state.
2. A price history chart appears first, covering roughly the last 5 years at
   weekly resolution -- scroll/pinch to zoom, drag to pan, hover for a
   date/price readout, and use "Reset zoom" to fit the whole loaded range
   back into view. If the company has analyst coverage, a separate Share
   Price Forecast chart follows it: a dashed High/Mean/Low fan from today's
   price out to the analysts' target date, color-coded green/gray/red, with
   the expected-return percentages in the legend below the chart.
3. A Financial Health Snapshot verdict ("Strong/Mixed/Weak Fundamentals" plus
   a one-line reason) follows -- a summary of the ratio colors below it, not
   a recommendation to buy, sell, or hold.
4. An Analyst Consensus card follows, if the company has analyst coverage:
   a Buy/Hold/Sell rating breakdown (shown as percentages) and a price
   target range (low/mean/high vs. the current price), sourced from
   third-party sell-side analysts via Tapetide -- this is *their* opinion,
   reported with attribution, not FinAI Metrics' own view.
5. Financial statement highlights and grouped ratios (liquidity,
   profitability, leverage, efficiency, valuation) fill the rest of the page,
   each color-coded against a conventional healthy range where one exists.
   Hover or tap a card to see a plain-English definition of the metric and
   whether the company's actual value is healthy, and why. Liquidity ratios
   (current/quick/cash ratio, working capital) show as "N/A" -- Tapetide's
   condensed balance sheet format doesn't break out current assets/
   liabilities separately (see "Data source notes" below).
6. Use the gear icon (top right) to switch between dark and light mode; the
   choice is remembered on this device.

## Data source notes

Tapetide is free (no card required) and purpose-built for NSE/BSE data, but:

- **Free tier is rate-limited to 50 MCP tool calls/day.** Each company view
  costs ~7-8 calls (profile+ratings, P&L, balance sheet, ratios, ownership,
  analyst forecasts, 2 price-history calls, plus the initial search), so the
  free tier supports roughly 6-7 company lookups per day. If you hit the
  limit, Tapetide's own message tells you exactly when it resets (or you
  can upgrade at https://tapetide.com/pricing).
- **The price chart is weekly, not daily, resolution.** Tapetide caps each
  response at ~25,000 characters and truncates arrays that don't fit, so a
  ~5-year *daily* series isn't retrievable at all. Weekly keeps each request
  small enough to succeed, and reads more cleanly at a multi-year zoom level
  anyway. To get the full ~5 years without losing the most recent data (a
  single big request truncates by silently dropping the newest rows, not
  the oldest), the backend makes two requests and merges them -- see
  `CLAUDE.md` for the exact mechanism if you're curious.
- **The Analyst Consensus card only appears when a company has coverage.**
  Small/micro-caps often have zero sell-side analyst coverage, in which case
  the card is simply omitted rather than shown with fabricated/zeroed data.
- **Liquidity ratios are structurally unavailable.** Tapetide's condensed,
  Screener.in-style balance sheet doesn't break out current assets/current
  liabilities/cash separately, so current ratio, quick ratio, cash ratio, and
  working capital always show "N/A" for every company -- this isn't a bug,
  see `backend/app/services/tapetide_provider.py`'s docstring for the full
  explanation of what is and isn't derivable from this data source.
- **Banks/NBFCs report a structurally different P&L** (e.g. "Revenue" instead
  of "Sales", no distinct "Operating Profit" line), so some metrics may show
  "N/A" for financial-sector companies specifically.
- **`YFinanceProvider`** (free, no signup) is wired in as both the automatic
  fallback for "auto" mode and a selectable option -- but it's historically
  unreliable for Indian tickers due to Yahoo Finance's undocumented
  crumb/rate-limit gate, which is exactly why the source-switcher labels it
  "Least Reliable" rather than hiding the tradeoff.
- **`BharatSMProvider`** (free, no signup, wraps the open-source
  `Bharat-sm-data` package) gives solid fundamentals -- verified live against
  known Reliance/TCS figures, and its balance sheet actually breaks out
  current assets/liabilities separately, unlike Tapetide's condensed format.
  But it has **no price history and no analyst consensus, ever** -- a
  permanent gap, not a bug: the underlying library needs `www.nseindia.com`
  for OHLC data, and that site outright blocks automated/cloud traffic. The
  UI flags this with a "Missing Content" badge next to the source dropdown
  and an explanation in place of the (otherwise empty) price chart. Because
  of this gap it's selectable-only, never part of the "auto" fallback chain.

## Troubleshooting

- **"Could not find '<company>' on NSE or BSE via Tapetide"** -- try the
  exact ticker instead of the company name, e.g. `RELIANCE` or `TCS`.
- **"You've reached the Tapetide free tier limit for today"** -- wait for the
  reset time given in the message, or upgrade your Tapetide plan.
- **"Tapetide rejected this API key"** -- the key you entered on the
  sign-in gate is wrong or was revoked; regenerate one at
  https://tapetide.com/settings/tokens and enter it again (there's no
  `.env` file involved anymore -- see "Add your API keys" above).
- **"MOONSHOT_API_KEY is not configured" / 503 from `/api/chat`** -- only
  relevant if you're calling the chat endpoint directly or have re-added the
  chat UI (the website itself doesn't use it). Check that `MOONSHOT_API_KEY`
  is set correctly in `backend/.env` and that the backend was restarted
  after editing it (settings are cached at startup).
- **"Your Moonshot account has insufficient balance"** -- add credits at
  https://platform.kimi.ai. Moonshot's API is pay-as-you-go and isn't covered
  by any other subscription; note it reports billing suspension as an HTTP
  429, which looks like a rate limit but isn't one.
- **CORS errors in the browser console** -- make sure the frontend is running
  on the origin listed in `backend/.env`'s `CORS_ORIGINS` (default:
  `http://localhost:5173`).

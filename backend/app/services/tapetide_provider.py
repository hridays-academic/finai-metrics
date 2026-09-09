"""
Tapetide-backed data provider (NSE/BSE quotes, financials, ratios).

Tapetide is exposed as an MCP server, but "MCP over HTTP" is just JSON-RPC
2.0 over a single POST endpoint -- no MCP client library is required. Every
call here is: POST https://mcp.tapetide.com/mcp with
    {"jsonrpc": "2.0", "id": N, "method": "tools/call",
     "params": {"name": <tool>, "arguments": {...}}}
authenticated with `Authorization: Bearer <TAPETIDE_TOKEN>`. The tool's
actual JSON payload comes back as a string in result.content[0].text.

Field mappings below were verified against live responses (not guessed):

- get_financials(section="balance_sheet") follows the Screener.in convention
  where the "Total Liabilities" row is the balance-sheet TOTAL (assets ==
  liabilities+equity), not liabilities-excluding-equity. So:
    total_equity = Equity Capital + Reserves
    total_liabilities (excl. equity, matching our RawFinancials semantics)
      = Total Assets - total_equity
    total_debt = Borrowings
- This condensed balance sheet does NOT break out current assets / current
  liabilities / cash / inventory / receivables separately (a real limitation
  of the aggregator's format, not something we work around). That means
  current ratio, quick ratio, cash ratio, and working capital are NOT
  computable from Tapetide and are deliberately left as None ("N/A" in the
  UI) rather than backed into with an assumed split -- doing that would
  fabricate two numbers to make one difference come out right.
- Inventory Turnover / Receivables Turnover, by contrast, only need ONE
  figure each (inventory, receivables), and Tapetide's `ratios` section
  gives us its own vendor-computed "Inventory Days" / "Debtor Days" directly.
  We invert those (inventory = Sales x Days / 365) so that when
  metrics.py's generic Revenue/Average-Balance formula runs, it reproduces
  exactly 365/Days -- i.e. Tapetide's own turnover figure -- without any
  provider-specific branching in metrics.py. Prior-period inventory/
  receivables are deliberately left unset so the averaging in metrics.py
  falls back to the single most recent figure instead of blending two
  different periods' implied values.
- get_company_profile's `fundamentals` block frequently has null market_cap /
  book_value for large-cap names (seen live for Reliance); we recompute both
  from figures that are reliably present (current price x shares outstanding,
  where shares outstanding = company.issued_size).
- get_company_profile's response has an `include`-gated `ratings` block as a
  top-level *sibling* of `data` (i.e. `{"data": {...}, "ratings": {"data":
  {...}}}`), not nested inside `data` -- easy to miss since every other
  section lives under `data`. `_get_profile` always requests
  `include=["ratings"]` so callers get it "for free" alongside the profile
  (no evidence this costs extra quota over a plain profile call).
- `get_company_info` and `get_raw_financials` both need `get_company_profile`
  for the same symbol -- `_get_profile` caches the parsed response for a
  short TTL so calling both back-to-back (as main.py does on every company
  fetch) costs one Tapetide call instead of two. The TTL exists so a
  provider instance doesn't serve minutes/hours-stale prices to a later,
  unrelated request for the same symbol.

(2026-07) **This app is multi-user now -- every user brings their own
Tapetide API key** (see CLAUDE.md's "Bring-your-own Tapetide key"
section), entered client-side and sent as the `X-Tapetide-Token` header on
every request that needs it. `TapetideProvider` is therefore constructed
fresh, per-request, with that token -- there is no shared singleton
instance or server-side default key anymore (`main.py` used to hold one
module-level instance built from `TAPETIDE_TOKEN` in `.env`; that env var
no longer exists). The `_profile_cache` TTL above is consequently scoped to
one request's lifetime rather than the whole process -- an acceptable
tradeoff given the hybrid-sourcing rewrite already made most call sites
single-use per request anyway. Quota tracking (below) is keyed by a hash of
the token specifically so this still works correctly with many different
users' keys sharing the same `tapetide_quota` Postgres table.
"""
import calendar
import hashlib
import json as _json
import time
from datetime import date
from pathlib import Path
from typing import Any, Optional

import requests

from app.config import get_settings
from app.models import AnalystConsensus, CompanyInfo, PricePoint, RawFinancials
from app.services.data_provider import (
    CompanyNotFoundError,
    DataProviderError,
    FinancialDataProvider,
    ProviderQuotaExceededError,
)
from app.services.db import get_conn


class InvalidTapetideKeyError(DataProviderError):
    """Tapetide rejected the API key itself (HTTP 401) -- distinct from
    other DataProviderErrors (network issues, malformed responses, upstream
    5xx) so /api/tapetide/validate and the sign-in gate can tell "this key
    is wrong" apart from "something else went wrong, maybe try again."""

CRORE = 1e7  # Tapetide reports statement figures in Rs. Crore
PROFILE_CACHE_TTL_SECONDS = 60
# Free tier, as documented at https://tapetide.com/mcp/llms.txt at time of
# writing. Used only to estimate a "searches remaining today" figure for the
# UI -- we have no way to read Tapetide's own server-side counter, so this
# is a local estimate (real calls made by this process since local
# midnight), not a guaranteed-accurate mirror of Tapetide's actual quota.
TAPETIDE_DAILY_QUOTA = 50

# Persists the call counter across process restarts -- without this, every
# serverless cold start (Vercel) or dev-server reload (uvicorn --reload
# restarts the whole process on every backend .py file save) would silently
# reset "calls used today" to 0, understating real usage right up until the
# next 429 surprises you. Deliberately NOT gated behind DEV_CACHE_DIR --
# that's an opt-in, dev-only response cache; this is always-on bookkeeping
# for a number the UI shows unconditionally.
#
# Backed by Postgres now (the `tapetide_quota` table, see db.py) -- this was
# a local JSON file (.tapetide_quota_state.json) before the app moved to
# Vercel, whose serverless functions have no persistent filesystem to write
# it to (everything on local disk is wiped on the next cold start/redeploy).
#
# Keyed by a hash of the token (never the raw token itself -- unlike the old
# file, a real Postgres row isn't literally plaintext-on-disk, but there's
# still no reason to store the raw key when a hash is all quota tracking
# needs) since every user now has their own Tapetide key. A shared
# single-scalar counter (the pre-multi-user design) would otherwise mix
# every user's usage into one number, which is worse than useless once each
# person's key has its own independent 50-calls/day budget.


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()[:16]


def _load_quota_state(token_hash: str) -> dict:
    try:
        with get_conn() as conn:
            row = conn.execute(
                "SELECT quota_date, calls_today FROM tapetide_quota WHERE token_hash = %s",
                (token_hash,),
            ).fetchone()
    except Exception:  # noqa: BLE001 -- a transient DB hiccup just starts the estimate fresh
        return {}
    if not row:
        return {}
    return {"date": row["quota_date"], "calls_today": row["calls_today"]}


def _save_quota_state(token_hash: str, quota_date: str, calls_today: int) -> None:
    try:
        with get_conn() as conn:
            conn.execute(
                """
                INSERT INTO tapetide_quota (token_hash, quota_date, calls_today)
                VALUES (%s, %s, %s)
                ON CONFLICT (token_hash) DO UPDATE
                SET quota_date = EXCLUDED.quota_date, calls_today = EXCLUDED.calls_today
                """,
                (token_hash, quota_date, calls_today),
            )
    except Exception:  # noqa: BLE001
        pass  # best-effort -- the estimate just won't survive a restart if this fails


class TapetideProvider(FinancialDataProvider):
    def __init__(self, token: str) -> None:
        """`token` is the calling user's own Tapetide API key (see module
        docstring) -- required, not read from settings/.env anymore. Raises
        ValueError for an empty/whitespace-only token so a caller that
        forgets to check for one first fails immediately and locally rather
        than with a confusing 401 from Tapetide."""
        if not token or not token.strip():
            raise ValueError("A Tapetide API key is required.")
        self._token = token.strip()
        self._token_hash = _token_hash(self._token)

        settings = get_settings()
        self._url = settings.tapetide_mcp_url
        self._session = requests.Session()
        self._session.headers.update(
            {
                "Authorization": f"Bearer {self._token}",
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
            }
        )
        self._request_id = 0
        self._profile_cache: dict[str, tuple[float, Any]] = {}

        # Dev-only, opt-in on-disk cache for _call_tool responses -- set
        # DEV_CACHE_DIR in backend/.env to stop repeated local testing
        # against the same symbol from burning the free tier's 50 calls/day.
        # Shared with BharatSMProvider (same directory, see config.py) --
        # its cache files use a "bharat__" filename prefix and a different
        # (pickle, not JSON) format, so the two can't collide despite living
        # in the same folder. NEVER set this in a real deployment: it would
        # silently serve stale financial data to end users, which is
        # exactly the "fabricate/guess instead of showing unavailable"
        # mistake this codebase deliberately avoids everywhere else. Only
        # successful responses are ever written -- a quota-exceeded error is
        # raised before the write, so a temporarily-exhausted quota can
        # never "poison" the cache with a fake error result.
        self._cache_dir = Path(settings.dev_cache_dir) if settings.dev_cache_dir else None
        if self._cache_dir:
            self._cache_dir.mkdir(parents=True, exist_ok=True)

        # Local estimate of calls made today -- see TAPETIDE_DAILY_QUOTA and
        # _load_quota_state/_save_quota_state (Postgres-backed, keyed by this
        # token's hash, so a process restart/cold start doesn't reset it and
        # different users' keys don't share one counter). Skipped entirely
        # in dev-cache mode: quota tracking exists to protect the real
        # Tapetide free tier, which a fully dev-cached request never
        # touches at all -- confirmed live that this Postgres round-trip
        # (a local dev machine talking to Neon over the public internet,
        # not the pooled/nearby connection a real deployment gets) was
        # adding several real seconds to *every* request regardless of
        # whether the Tapetide data itself was cache-served, which read as
        # "caching isn't working" even though the actual, quota-relevant
        # caching was fine. Production never sets DEV_CACHE_DIR, so this
        # skip never applies there.
        if self._cache_dir:
            self._calls_date = date.today().isoformat()
            self._calls_today = 0
        else:
            entry = _load_quota_state(self._token_hash)
            self._calls_date = entry.get("date", date.today().isoformat())
            self._calls_today = entry.get("calls_today", 0)
            today = date.today().isoformat()
            if self._calls_date != today:
                self._calls_date = today
                self._calls_today = 0

    def _cache_path(self, name: str, arguments: dict[str, Any]) -> Path:
        key = _json.dumps({"name": name, "arguments": arguments}, sort_keys=True)
        digest = hashlib.sha256(key.encode()).hexdigest()[:20]
        return self._cache_dir / f"{name}__{digest}.json"

    def _get_profile(self, symbol: str) -> Any:
        cached = self._profile_cache.get(symbol)
        if cached and time.time() - cached[0] < PROFILE_CACHE_TTL_SECONDS:
            return cached[1]
        result = self._call_tool(
            "get_company_profile", {"symbol": symbol, "include": ["ratings"]}
        )
        self._profile_cache[symbol] = (time.time(), result)
        return result

    def _persist_quota(self) -> None:
        # Upsert on this key's own row (see db.py's ON CONFLICT) -- unlike
        # the old read-modify-write-the-whole-file approach, two requests for
        # *different* users' keys landing at the same instant no longer race
        # against each other at all, since each writes only its own row.
        _save_quota_state(self._token_hash, self._calls_date, self._calls_today)

    def get_quota_status(self) -> tuple[int, int]:
        """Returns (calls_used_today, calls_remaining_estimate) for THIS
        instance's token. Local estimate only -- see TAPETIDE_DAILY_QUOTA."""
        today = date.today().isoformat()
        if today != self._calls_date:
            self._calls_date = today
            self._calls_today = 0
            self._persist_quota()
        return self._calls_today, max(0, TAPETIDE_DAILY_QUOTA - self._calls_today)

    def validate_key(self) -> None:
        """Used by /api/tapetide/validate to check a freshly-entered key
        before the frontend stores it. Deliberately `use_cache=False` --
        every other method here is fine being served from DEV_CACHE_DIR's
        disk cache, but a cache hit here would validate the QUERY, not the
        key: if "RELIANCE" was ever cached by a previous (real) call, a
        garbage token would silently return "valid" without Tapetide ever
        seeing it, since a cache hit returns before the network request
        (and its auth check) happens at all. Raises InvalidTapetideKeyError/
        ProviderQuotaExceededError/DataProviderError same as any other call."""
        self._call_tool("search_stocks", {"query": "RELIANCE", "limit": 1}, use_cache=False)

    def _call_tool(self, name: str, arguments: dict[str, Any], *, use_cache: bool = True, timeout: int = 15) -> Any:
        if use_cache and self._cache_dir:
            cache_path = self._cache_path(name, arguments)
            if cache_path.exists():
                return _json.loads(cache_path.read_text())

        # Reset the local estimate at local midnight, same cadence as
        # Tapetide's own quota reset -- a dev-only cache hit above doesn't
        # reach here, so it correctly doesn't count as a "real" call.
        today = date.today().isoformat()
        if today != self._calls_date:
            self._calls_date = today
            self._calls_today = 0
        self._calls_today += 1
        self._persist_quota()

        self._request_id += 1
        payload = {
            "jsonrpc": "2.0",
            "id": self._request_id,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        }
        try:
            resp = self._session.post(self._url, json=payload, timeout=timeout)
        except requests.RequestException as exc:
            raise DataProviderError(f"Couldn't reach Tapetide: {exc}") from exc

        if resp.status_code == 401:
            raise InvalidTapetideKeyError(
                "Tapetide rejected this API key -- please double-check it or generate a new one."
            )
        if resp.status_code == 429:
            raise ProviderQuotaExceededError(
                "Tapetide's rate limit was hit. Please wait a moment and try again."
            )
        if resp.status_code != 200:
            raise DataProviderError(f"Tapetide returned HTTP {resp.status_code} for '{name}'.")

        body = resp.json()
        if "error" in body:
            raise DataProviderError(f"Tapetide error calling '{name}': {body['error']}")

        content = body.get("result", {}).get("content", [])
        text_parts = [c["text"] for c in content if c.get("type") == "text"]
        if not text_parts:
            raise DataProviderError(f"Tapetide returned an empty response for '{name}'.")

        text = text_parts[0]
        if not text.lstrip().startswith(("{", "[")):
            # Quota/limit responses come back as a plain human-readable
            # string rather than JSON (e.g. "You've reached the Tapetide
            # free tier limit for today... resets in about 17 hours.") --
            # surface it as-is since it's already a clear, actionable message.
            # This is the ONLY known case where Tapetide returns a non-JSON
            # body, so treating it as quota-exceeded (not a generic error)
            # is safe -- main.py catches this specifically to trigger the
            # yfinance fallback.
            raise ProviderQuotaExceededError(text)
        try:
            # Large payloads (e.g. mf_holdings) come back as valid JSON followed
            # by a plain-text truncation notice, e.g. "[TRUNCATED: ...]" --
            # raw_decode() parses the leading JSON object and ignores that.
            result = _json.JSONDecoder().raw_decode(text)[0]
        except _json.JSONDecodeError as exc:
            raise DataProviderError(f"Couldn't parse Tapetide's response for '{name}'.") from exc

        if self._cache_dir:
            self._cache_path(name, arguments).write_text(_json.dumps(result))
        return result

    # ---- FinancialDataProvider interface -----------------------------------

    def resolve_symbol(self, query: str) -> tuple[str, str]:
        q = query.strip()
        if not q:
            raise CompanyNotFoundError("Please enter a company name or ticker.")

        bare = q.upper()
        for suffix in (".NS", ".BO"):
            if bare.endswith(suffix):
                bare = bare[: -len(suffix)]

        result = self._call_tool("search_stocks", {"query": bare, "limit": 5})
        matches = result.get("data") or []
        if not matches:
            raise CompanyNotFoundError(
                f"Could not find '{query}' on NSE/BSE via Tapetide. Try the exact "
                "ticker, e.g. 'RELIANCE' or 'TCS'."
            )

        top = matches[0]
        symbol = top.get("nse_symbol") or top.get("bse_code")
        if not symbol:
            raise CompanyNotFoundError(f"Could not resolve a tradable symbol for '{query}'.")
        exchange = "NSE" if top.get("nse_symbol") else "BSE"
        return symbol, exchange

    def get_company_info(self, symbol: str) -> CompanyInfo:
        profile = self._get_profile(symbol)
        company = profile.get("data", {}).get("company", {})
        if not company:
            raise CompanyNotFoundError(f"No profile data available for '{symbol}'.")

        exchange = "NSE" if company.get("nse_symbol") else "BSE"
        return CompanyInfo(
            ticker=symbol,
            resolved_symbol=company.get("nse_symbol") or symbol,
            exchange=exchange,
            company_name=company.get("name") or symbol,
            sector=company.get("sector"),
            industry=company.get("industry") or company.get("basic_industry"),
        )

    def get_raw_financials(self, symbol: str) -> RawFinancials:
        profile = self._get_profile(symbol)
        profit_loss = self._call_tool(
            "get_financials", {"symbol": symbol, "section": "profit_loss"}
        )
        balance_sheet = self._call_tool(
            "get_financials", {"symbol": symbol, "section": "balance_sheet"}
        )
        ratios = self._call_tool("get_financials", {"symbol": symbol, "section": "ratios"})
        try:
            ownership = self._call_tool("get_stock_ownership", {"symbol": symbol})
        except DataProviderError:
            ownership = {}  # dividend history is a nice-to-have, not essential

        data = profile.get("data", {})
        fundamentals = data.get("fundamentals", {}) or {}
        quote = data.get("quote", {}) or {}
        valuation = data.get("valuation", {}) or {}
        company = data.get("company", {}) or {}

        pl_latest, pl_prior = _latest_two_periods(profit_loss)
        bs_latest, bs_prior = _latest_two_periods(balance_sheet)
        ratios_latest, _ = _latest_two_periods(ratios)

        # Banks/NBFCs report their top line as "Revenue" rather than "Sales"
        # in this condensed statement format -- see module docstring caveat
        # about BFSI companies having a structurally different P&L (e.g. no
        # "Operating Profit" row), which will correctly surface as N/A for
        # metrics that depend on it rather than being papered over further.
        sales = _get_any(pl_latest, "Sales", "Revenue")
        interest = _get(pl_latest, "Interest")
        pbt = _get(pl_latest, "Profit before tax")
        ebit = pbt + interest if pbt is not None and interest is not None else None

        equity_capital = _get(bs_latest, "Equity Capital")
        reserves = _get(bs_latest, "Reserves")
        total_equity = (
            equity_capital + reserves if equity_capital is not None and reserves is not None else None
        )
        total_assets = _get(bs_latest, "Total Assets")
        total_liabilities = (
            total_assets - total_equity
            if total_assets is not None and total_equity is not None
            else None
        )

        prior_equity_capital = _get(bs_prior, "Equity Capital")
        prior_reserves = _get(bs_prior, "Reserves")
        prior_total_equity = (
            prior_equity_capital + prior_reserves
            if prior_equity_capital is not None and prior_reserves is not None
            else None
        )
        prior_total_assets = _get(bs_prior, "Total Assets")

        # Invert Tapetide's own day-ratios into single-period inventory /
        # receivables figures so metrics.py's generic turnover formula
        # reproduces exactly 365/Days -- see module docstring.
        inventory_days = _get(ratios_latest, "Inventory Days")
        debtor_days = _get(ratios_latest, "Debtor Days")
        inventory = sales * inventory_days / 365 if sales is not None and inventory_days is not None else None
        receivables = sales * debtor_days / 365 if sales is not None and debtor_days is not None else None

        # ROCE's denominator (Total Assets - Current Liabilities) isn't
        # derivable without a current-liabilities breakdown, but Tapetide
        # reports ROCE % directly -- invert it against our own EBIT to get an
        # implied capital-employed figure, so metrics.py's ROCE calculation
        # (EBIT / capital_employed) reproduces Tapetide's own ROCE % exactly.
        roce_pct = _get(ratios_latest, "ROCE %")
        capital_employed = (
            ebit / (roce_pct / 100) if ebit is not None and roce_pct not in (None, 0) else None
        )

        shares_outstanding = company.get("issued_size")
        current_price = quote.get("price") or fundamentals.get("current_price")

        eps = valuation.get("ttm_eps") or fundamentals.get("eps")

        market_cap = fundamentals.get("market_cap")
        if market_cap is None and current_price is not None and shares_outstanding:
            market_cap = current_price * shares_outstanding

        book_value_per_share = fundamentals.get("book_value")
        if book_value_per_share is None and total_equity is not None and shares_outstanding:
            book_value_per_share = (total_equity * CRORE) / shares_outstanding

        dividends_per_share = _latest_dividend_per_share(ownership)

        return RawFinancials(
            currency="INR",
            revenue=_to_absolute(sales),
            gross_profit=None,  # not broken out in this condensed P&L format
            operating_income=_to_absolute(_get(pl_latest, "Operating Profit")),
            net_income=_to_absolute(_get(pl_latest, "Net Profit")),
            ebit=_to_absolute(ebit),
            interest_expense=_to_absolute(interest),
            total_assets=_to_absolute(total_assets),
            total_liabilities=_to_absolute(total_liabilities),
            total_equity=_to_absolute(total_equity),
            current_assets=None,
            current_liabilities=None,
            cash_and_equivalents=None,
            inventory=_to_absolute(inventory),
            receivables=_to_absolute(receivables),
            total_debt=_to_absolute(_get(bs_latest, "Borrowings")),
            capital_employed=_to_absolute(capital_employed),
            market_cap=market_cap,
            current_price=current_price,
            shares_outstanding=shares_outstanding,
            eps=eps,
            book_value_per_share=book_value_per_share,
            dividends_per_share=dividends_per_share,
            prior_total_assets=_to_absolute(prior_total_assets),
            prior_total_equity=_to_absolute(prior_total_equity),
            prior_inventory=None,
            prior_receivables=None,
        )

    def get_price_history(self, symbol: str) -> list[PricePoint]:
        # NOTE on this whole method: Tapetide caps each tool response at
        # ~25,000 characters and truncates arrays that don't fit -- but
        # unlike get_stock_ownership (which appends a visible
        # "[TRUNCATED...]" notice we can detect), this truncation keeps the
        # OLDEST rows and silently drops the most recent ones. A single
        # request for ~5 years of weekly data (days=1825) truncates to ~157
        # of 261 available weeks, ending in mid-2024 with no recent data at
        # all -- exactly backwards for a chart people expect to end "today".
        #
        # We exploit that same truncation behavior deliberately, in two
        # calls, to assemble ~5 years without ever losing the recent end:
        #   - "recent": days=1000/weekly, verified live (across multiple
        #     symbols, with margin) to fit under the cap untruncated, so it
        #     reliably reaches today (~2.7 years of history).
        #   - "older": days=1825/weekly, which DOES truncate, but the
        #     truncated remainder is exactly the oldest ~3 years of that
        #     5-year window (~2021 to ~2024) -- data we can't get any other
        #     way from this tool (there's no offset/pagination parameter).
        # Merging the two (recent wins on any overlapping week) yields a
        # continuous ~5-year weekly series. This doubles the Tapetide call
        # cost of price history (2 calls instead of 1) -- see CLAUDE.md.
        # Weekly (not daily) throughout is intentional, not just a
        # side-effect of the size cap: a daily-resolution 5-year chart is
        # both a much larger payload and a noisier, harder-to-read line than
        # this app's "understand the trend at a glance" goal calls for.
        # Longer timeout than _call_tool's 15s default -- confirmed live that
        # this specific call (larger weekly-history payload) sometimes needs
        # more than 15s to come back even when Tapetide is otherwise healthy,
        # producing a real, repeated "Read timed out" failure on an
        # otherwise-fine request. 20s here still fits the worst-case chain
        # (recent + older + get_recent_price_history below) inside
        # vercel.json's 60s function budget with margin to spare (20+20+15=55s).
        recent = self._call_tool(
            "get_price_history", {"symbol": symbol, "days": 1000, "interval": "weekly"}, timeout=20
        )
        older = self._call_tool(
            "get_price_history", {"symbol": symbol, "days": 1825, "interval": "weekly"}, timeout=20
        )

        by_date: dict[str, dict] = {}
        for row in (older.get("data") or []):
            if row.get("date") and row.get("close") is not None:
                by_date[row["date"]] = row
        for row in (recent.get("data") or []):
            if row.get("date") and row.get("close") is not None:
                by_date[row["date"]] = row  # recent wins on overlap

        return [_row_to_point(date, row) for date, row in sorted(by_date.items())]

    def get_recent_price_history(self, symbol: str) -> list[PricePoint]:
        # Daily resolution, for the chart's 1D/5D views where the weekly
        # series from get_price_history would only have 0-1 points in range.
        # days=200 was empirically verified (across multiple symbols, with
        # margin) to stay under Tapetide's ~25,000-char response cap and
        # reliably reach today's date -- same constraint as get_price_history,
        # just at daily instead of weekly resolution. Don't raise this value
        # without re-verifying against truncation.
        result = self._call_tool(
            "get_price_history", {"symbol": symbol, "days": 200, "interval": "daily"}
        )
        rows = result.get("data") or []
        return [
            _row_to_point(row["date"], row)
            for row in rows
            if row.get("date") and row.get("close") is not None
        ]

    def get_analyst_consensus(self, symbol: str) -> Optional[AnalystConsensus]:
        profile = self._get_profile(symbol)
        ratings = (profile.get("ratings") or {}).get("data") or {}
        total = int(ratings.get("total_ratings") or 0)
        buy = int(ratings.get("buy") or 0)
        hold = int(ratings.get("hold") or 0)
        sell = int(ratings.get("sell") or 0)

        target_low = target_mean = target_high = target_period = target_date = None
        try:
            forecasts = self._call_tool("get_forecasts", {"symbol": symbol})
            sections = forecasts.get("data") or []
            annual = next((s for s in sections if s.get("period_type") == "A"), None)
            price_estimates = ((annual or {}).get("estimates") or {}).get("price") or {}
            if price_estimates:
                # Keys are "YYYYMM" period-end strings; take the nearest future one.
                period_key = sorted(price_estimates.keys())[0]
                est = price_estimates[period_key]
                target_low = est.get("low")
                target_mean = est.get("mean")
                target_high = est.get("high")
                target_period = _format_fiscal_period(period_key)
                target_date = _period_key_to_date(period_key)
        except DataProviderError:
            pass  # price targets are a nice-to-have, not essential

        if total == 0 and target_mean is None:
            return None  # no analyst coverage at all for this company

        if total > 0:
            buy_pct = float(ratings.get("percent_buy", round(buy / total * 100, 1)))
            hold_pct = float(ratings.get("percent_hold", round(hold / total * 100, 1)))
            sell_pct = float(ratings.get("percent_sell", round(sell / total * 100, 1)))
            consensus_label = max([("Buy", buy), ("Hold", hold), ("Sell", sell)], key=lambda p: p[1])[0]
        else:
            buy_pct = hold_pct = sell_pct = 0.0
            consensus_label = "No Rating Coverage"

        return AnalystConsensus(
            buy=buy, hold=hold, sell=sell, total=total,
            buy_pct=buy_pct, hold_pct=hold_pct, sell_pct=sell_pct,
            consensus_label=consensus_label,
            target_low=target_low, target_mean=target_mean, target_high=target_high,
            target_period=target_period, target_date=target_date,
        )


def _format_fiscal_period(period_key: str) -> str:
    """"202703" -> "FY2027 (period ending Mar 2027)"."""
    month_names = {
        1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr", 5: "May", 6: "Jun",
        7: "Jul", 8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec",
    }
    try:
        year, month = int(period_key[:4]), int(period_key[4:6])
    except (ValueError, IndexError):
        return period_key
    return f"FY{year} (period ending {month_names.get(month, month)} {year})"


def _period_key_to_date(period_key: str) -> Optional[str]:
    """"202703" -> "2027-03-31" (last calendar day of that month), for charting."""
    try:
        year, month = int(period_key[:4]), int(period_key[4:6])
        last_day = calendar.monthrange(year, month)[1]
        return f"{year:04d}-{month:02d}-{last_day:02d}"
    except (ValueError, IndexError):
        return None


def _row_to_point(date: str, row: dict) -> PricePoint:
    close = row["close"]
    return PricePoint(
        date=date,
        open=row.get("open", close),
        high=row.get("high", close),
        low=row.get("low", close),
        close=close,
        volume=row.get("volume"),
    )


def _to_absolute(value_in_crore: Optional[float]) -> Optional[float]:
    return value_in_crore * CRORE if value_in_crore is not None else None


def _latest_two_periods(section_result: Any) -> tuple[dict, dict]:
    """Returns (latest_period_values, prior_period_values) as {line_item: value} dicts."""
    sections = section_result.get("data") or []
    if not sections:
        return {}, {}
    section = sections[0]
    periods: list[str] = section.get("periods") or []
    line_items: dict[str, dict[str, float]] = section.get("data") or {}

    if len(periods) < 1:
        return {}, {}
    latest_period = periods[-1]
    prior_period = periods[-2] if len(periods) >= 2 else None

    latest = {k: v.get(latest_period) for k, v in line_items.items() if v.get(latest_period) is not None}
    prior = (
        {k: v.get(prior_period) for k, v in line_items.items() if v.get(prior_period) is not None}
        if prior_period
        else {}
    )
    return latest, prior


def _get(period_values: dict, key: str) -> Optional[float]:
    value = period_values.get(key)
    return float(value) if value is not None else None


def _get_any(period_values: dict, *keys: str) -> Optional[float]:
    for key in keys:
        value = _get(period_values, key)
        if value is not None:
            return value
    return None


def _latest_dividend_per_share(ownership: Any) -> Optional[float]:
    entries = ((ownership or {}).get("dividends") or {}).get("data") or []
    if not entries:
        return None
    latest = entries[-1]  # chronologically ascending, per observed response
    value = latest.get("Div")
    return float(value) if value is not None else None

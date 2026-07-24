"""
Third data provider, backed by the open-source `Bharat-sm-data` PyPI package
(https://github.com/Sampad-Hegde/Bharat-SM-Data), which itself wraps
Tickertape's public JSON API (`api.tickertape.in`) for symbol search and
financial statements. Serves company info + raw financials for every
search (see CLAUDE.md's "Hybrid sourcing" section) -- it is never asked
for price history or analyst consensus, since it has a real, permanent
gap in both (see below).

Field mappings were verified against live responses for RELIANCE before
being trusted here (same standard as tapetide_provider.py):

- Tickertape's `get_income_data`/`get_balance_sheet_data` report every
  figure in Rs. Crore, exactly like Tapetide -- `CRORE = 1e7` converts to
  the absolute-rupee values `RawFinancials` expects everywhere else.
- Income statement field abbreviations, confirmed by cross-checking the
  arithmetic relationships between them (not guessed): `incPbt == incPbi -
  incIoi` (Profit Before Tax = Profit Before Interest, i.e. EBIT, minus
  Interest) and `incNinc == incPbt - incToi` (Net Income = PBT - Tax). So
  `incPbi` = EBIT, `incIoi` = interest expense, `incNinc` = net income.
  `incGpro`/`incOpc` (gross profit / operating profit) come back `None` for
  conglomerates like Reliance that don't report a single clean COGS line --
  left unmapped rather than guessed, same principle as Tapetide's banks/
  NBFCs "Revenue" fallback.
- Balance sheet field abbreviations, also confirmed by summation: `balTca
  == balCsti + balTrec + balTinv + balOca` (current assets = cash +
  receivables + inventory + other current assets) and `balTota == balTca +
  balNppe + balGint + balLti + balOtha` (total assets). `balTotl` (total
  liabilities) excludes minority interest (`balTcl + balTltd + balDit +
  balOthl`, verified to NOT include `balMint`), while `balTeq` (total
  equity) INCLUDES it (`balComs + balApic + balRtne + balOeq + balMint`) --
  matches Tapetide's convention of keeping `total_liabilities` +
  `total_equity` summing back to `total_assets`.
- `balTcso` (total common shares outstanding) is in Rs. Crore-of-shares too
  (e.g. `1353.22` for Reliance's real ~1,353-crore post-bonus-issue share
  count) -- gets the same `CRORE` multiplier as everything else.
- `get_key_ratios` (needs the stock's Tickertape URL slug, from the search
  hit) gives `lastPrice`/`marketCap`/`bps` (book value per share) directly
  as reported figures -- preferred over deriving them from the statements,
  since they're what Tickertape itself displays.
- The income statement's `annual` rows include a synthetic `TTM` row
  (`displayPeriod == "TTM"`) mixed in with real fiscal years -- filtered out
  before picking "latest"/"prior" periods, since its own `incOpe` value was
  observed to be wildly inconsistent with the FY rows (looks like a partial-
  sum artifact of the library's TTM calculation, not real data).

**No price history, ever -- this is a permanent gap, not a bug.** The
underlying library gets OHLC data from NSE's own charting service
(`charting.nseindia.com`), which requires first completing a handshake
against `www.nseindia.com` -- and that main site flat-out 403s automated
traffic from cloud/datacenter IP ranges (confirmed live: a fresh request
from this project's dev environment was blocked outright, not merely rate-
limited). This is well-documented, long-standing NSE anti-bot behavior, not
specific to any one network, so `get_price_history`/`get_recent_price_history`
don't even attempt the call -- they return `[]` immediately. `main.py`
never actually calls either method on this provider (Tapetide/yfinance
cover price history unconditionally instead, see CLAUDE.md) -- these exist
only to satisfy the `FinancialDataProvider` interface.

**No analyst consensus, ever -- also permanent, for a different reason.**
The library exposes Tickertape's own proprietary "fundamental score"
(Performance/Valuation/Growth/Profitability flags via `get_score_card`),
which is Tickertape's *opinion*, not third-party sell-side analyst ratings
or price targets. Mapping that to `AnalystConsensus` would be exactly the
"blend our own view with third-party opinion" mistake CLAUDE.md warns
against for `HealthSnapshot` vs `AnalystConsensus` -- so this always returns
`None`, same as when a provider genuinely has no analyst coverage.
"""
import hashlib
import json
import pickle
import time
from pathlib import Path
from typing import Any, Callable, Optional

from Fundamentals.TickerTape import Tickertape

from app.config import get_settings
from app.models import AnalystConsensus, CompanyInfo, PricePoint, RawFinancials
from app.services.data_provider import (
    CompanyNotFoundError,
    DataProviderError,
    FinancialDataProvider,
)

CRORE = 1e7  # Tickertape reports statement figures in Rs. Crore, like Tapetide
SEARCH_CACHE_TTL_SECONDS = 60


class BharatSMProvider(FinancialDataProvider):
    def __init__(self) -> None:
        self._tt = Tickertape()
        # Caches the matched search-hit dict per symbol (sid), so
        # get_company_info/get_raw_financials don't each re-run the search
        # that resolve_symbol already did -- same pattern as
        # TapetideProvider._profile_cache.
        self._hit_cache: dict[str, tuple[float, dict]] = {}

        # Dev-only, opt-in on-disk cache for the real Tickertape calls below
        # (search/get_income_data/get_balance_sheet_data/get_key_ratios) --
        # set DEV_CACHE_DIR in backend/.env, same variable TapetideProvider
        # reads (see config.py), so one directory covers both providers.
        # Filenames are prefixed "bharat__" so they can't collide with
        # Tapetide's own cache files living in the same folder, and are
        # pickled rather than JSON-encoded like Tapetide's, since these
        # calls return pandas DataFrames, not plain JSON-shaped dicts.
        # NEVER set this in a real deployment -- see tapetide_provider.py's
        # docstring for why. Only successful responses are ever written.
        settings = get_settings()
        self._cache_dir = Path(settings.dev_cache_dir) if settings.dev_cache_dir else None
        if self._cache_dir:
            self._cache_dir.mkdir(parents=True, exist_ok=True)

    def _cache_path(self, name: str, arguments: dict[str, Any]) -> Path:
        key = json.dumps({"name": name, "arguments": arguments}, sort_keys=True, default=str)
        digest = hashlib.sha256(key.encode()).hexdigest()[:20]
        return self._cache_dir / f"bharat__{name}__{digest}.pkl"

    def _cached(self, name: str, arguments: dict[str, Any], fetch: Callable[[], Any]) -> Any:
        if self._cache_dir:
            path = self._cache_path(name, arguments)
            if path.exists():
                return pickle.loads(path.read_bytes())
        result = fetch()
        if self._cache_dir:
            self._cache_path(name, arguments).write_bytes(pickle.dumps(result))
        return result

    def _search(self, query: str) -> list[dict]:
        def fetch() -> list[dict]:
            try:
                _, raw = self._tt.get_ticker(query, search_place="stock")
            except Exception as exc:  # noqa: BLE001 -- library swallows most errors internally and returns {}
                raise DataProviderError(f"Couldn't reach Bharat-SM-Data (Tickertape) for '{query}': {exc}") from exc
            return raw or []

        return self._cached("search", {"query": query}, fetch)

    def _get_hit(self, symbol: str) -> dict:
        cached = self._hit_cache.get(symbol)
        if cached and time.time() - cached[0] < SEARCH_CACHE_TTL_SECONDS:
            return cached[1]
        hits = self._search(symbol)
        match = next((h for h in hits if h.get("sid") == symbol), None) or (hits[0] if hits else None)
        if not match:
            raise CompanyNotFoundError(f"Could not resolve '{symbol}' via Bharat-SM-Data.")
        self._hit_cache[symbol] = (time.time(), match)
        return match

    # ---- FinancialDataProvider interface -----------------------------------

    def resolve_symbol(self, query: str) -> tuple[str, str]:
        q = query.strip()
        if not q:
            raise CompanyNotFoundError("Please enter a company name or ticker.")

        hits = self._search(q)
        if not hits:
            raise CompanyNotFoundError(
                f"Could not find '{query}' via Bharat-SM-Data. Try the exact ticker, e.g. 'RELIANCE'."
            )
        top = hits[0]
        sid = top.get("sid")
        if not sid:
            raise CompanyNotFoundError(f"Could not resolve a tradable symbol for '{query}'.")
        exchange = top.get("exchanges") or "NSE"
        self._hit_cache[sid] = (time.time(), top)
        return sid, exchange

    def get_company_info(self, symbol: str) -> CompanyInfo:
        hit = self._get_hit(symbol)
        # resolved_symbol is the plain ticker (e.g. "RELIANCE"), not
        # Tickertape's internal sid (e.g. "RELI") that `symbol` holds here --
        # main.py chains this straight into Tapetide/yfinance calls for
        # price history and analyst consensus (see CLAUDE.md's "Hybrid
        # sourcing" section), and those providers expect the plain ticker.
        return CompanyInfo(
            ticker=hit.get("ticker", symbol),
            resolved_symbol=hit.get("ticker", symbol),
            exchange=hit.get("exchanges") or "NSE",
            company_name=hit.get("name", symbol),
            sector=hit.get("sector"),
            industry=None,  # not broken out separately from sector by this source
        )

    def get_raw_financials(self, symbol: str) -> RawFinancials:
        hit = self._get_hit(symbol)
        slug = (hit.get("slug") or "").lstrip("/")

        income = self._cached(
            "get_income_data",
            {"symbol": symbol, "time_horizon": "annual", "num_time_periods": 3},
            lambda: self._tt.get_income_data(symbol, time_horizon="annual", num_time_periods=3),
        )
        balance = self._cached(
            "get_balance_sheet_data",
            {"symbol": symbol, "num_time_periods": 3},
            lambda: self._tt.get_balance_sheet_data(symbol, num_time_periods=3),
        )
        if income.empty or balance.empty:
            raise DataProviderError(f"Bharat-SM-Data returned no financial statements for '{symbol}'.")

        income = income[income["displayPeriod"] != "TTM"].sort_values("endDate")
        balance = balance.sort_values("endDate")
        inc_latest, inc_prior = _latest_two_rows(income)
        bal_latest, bal_prior = _latest_two_rows(balance)

        key_ratios: dict[str, Any] = {}
        if slug:
            try:
                kr_slug = f"stocks/{slug}" if not slug.startswith("stocks/") else slug
                kr_df = self._cached("get_key_ratios", {"slug": kr_slug}, lambda: self._tt.get_key_ratios(kr_slug))
                if not kr_df.empty:
                    key_ratios = kr_df[0].to_dict()
            except Exception:  # noqa: BLE001 -- key ratios are a nice-to-have, not core
                key_ratios = {}

        current_price = _num(key_ratios.get("lastPrice")) or _num((hit.get("quote") or {}).get("price"))
        market_cap = _to_absolute(_num(key_ratios.get("marketCap")) or _num(hit.get("marketCap")))
        book_value_per_share = _num(key_ratios.get("bps"))

        return RawFinancials(
            currency="INR",
            revenue=_to_absolute(_get(inc_latest, "incTrev")),
            gross_profit=_to_absolute(_get(inc_latest, "incGpro")),
            operating_income=_to_absolute(_get(inc_latest, "incOpc")),
            net_income=_to_absolute(_get(inc_latest, "incNinc")),
            ebit=_to_absolute(_get(inc_latest, "incPbi")),
            interest_expense=_to_absolute(_get(inc_latest, "incIoi")),
            total_assets=_to_absolute(_get(bal_latest, "balTota")),
            total_liabilities=_to_absolute(_get(bal_latest, "balTotl")),
            total_equity=_to_absolute(_get(bal_latest, "balTeq")),
            current_assets=_to_absolute(_get(bal_latest, "balTca")),
            current_liabilities=_to_absolute(_get(bal_latest, "balTcl")),
            cash_and_equivalents=_to_absolute(_get(bal_latest, "balCsti")),
            inventory=_to_absolute(_get(bal_latest, "balTinv")),
            receivables=_to_absolute(_get(bal_latest, "balTrec")),
            total_debt=_to_absolute(_get(bal_latest, "balTdeb")),
            market_cap=market_cap,
            current_price=current_price,
            shares_outstanding=_to_absolute(_get(bal_latest, "balTcso")),
            eps=_get(inc_latest, "incEps"),
            book_value_per_share=book_value_per_share,
            dividends_per_share=_get(inc_latest, "incDps"),
            prior_total_assets=_to_absolute(_get(bal_prior, "balTota")),
            prior_total_equity=_to_absolute(_get(bal_prior, "balTeq")),
            prior_inventory=_to_absolute(_get(bal_prior, "balTinv")),
            prior_receivables=_to_absolute(_get(bal_prior, "balTrec")),
        )

    def get_price_history(self, symbol: str) -> list[PricePoint]:
        # See module docstring -- NSE's charting handshake is blocked for
        # automated/cloud traffic, so this is a deliberate, permanent no-op
        # rather than a doomed network call on every request.
        return []

    def get_recent_price_history(self, symbol: str) -> list[PricePoint]:
        return []

    def get_analyst_consensus(self, symbol: str) -> Optional[AnalystConsensus]:
        # See module docstring -- this source has no third-party sell-side
        # analyst data available, only Tickertape's own proprietary score,
        # which must not be relabeled as third-party consensus.
        return None


def _latest_two_rows(df) -> tuple[dict, dict]:
    latest = df.iloc[-1].to_dict() if len(df) >= 1 else {}
    prior = df.iloc[-2].to_dict() if len(df) >= 2 else {}
    return latest, prior


def _get(row: dict, key: str) -> Optional[float]:
    return _num(row.get(key))


def _num(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return None if f != f else f  # filter NaN (f != f is true only for NaN)


def _to_absolute(value_in_crore: Optional[float]) -> Optional[float]:
    return value_in_crore * CRORE if value_in_crore is not None else None

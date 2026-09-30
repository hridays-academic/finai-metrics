// Mirrors backend/app/models.py -- keep in sync if those schemas change.

export type MetricStatus = "good" | "warning" | "bad" | "neutral";

// Which provider served a response. yfinance is the only data provider.
export type DataSourceName = "yfinance";

export interface Metric {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  status: MetricStatus;
  benchmark_note: string;
  formula: string;
  definition: string;
  assessment: string;
}

export interface MetricGroup {
  key: string;
  label: string;
  metrics: Metric[];
}

export interface HealthSnapshot {
  verdict: string;
  explanation: string;
  good_count: number;
  warning_count: number;
  bad_count: number;
  total_count: number;
}

export interface RawFinancials {
  currency: string;
  revenue: number | null;
  gross_profit: number | null;
  operating_income: number | null;
  net_income: number | null;
  ebit: number | null;
  interest_expense: number | null;
  total_assets: number | null;
  total_liabilities: number | null;
  total_equity: number | null;
  current_assets: number | null;
  current_liabilities: number | null;
  cash_and_equivalents: number | null;
  inventory: number | null;
  receivables: number | null;
  total_debt: number | null;
  market_cap: number | null;
  current_price: number | null;
  shares_outstanding: number | null;
  eps: number | null;
  book_value_per_share: number | null;
  dividends_per_share: number | null;
}

export interface CompanyInfo {
  ticker: string;
  resolved_symbol: string;
  exchange: string;
  company_name: string;
  sector: string | null;
  industry: string | null;
}

export interface AnalystConsensus {
  buy: number;
  hold: number;
  sell: number;
  total: number;
  buy_pct: number;
  hold_pct: number;
  sell_pct: number;
  consensus_label: string;
  target_low: number | null;
  target_mean: number | null;
  target_high: number | null;
  target_period: string | null;
  target_date: string | null; // "YYYY-MM-DD"
}

export interface CompanyFinancialsResponse {
  info: CompanyInfo;
  raw: RawFinancials;
  metric_groups: MetricGroup[];
  health_snapshot: HealthSnapshot;
  analyst_consensus: AnalystConsensus | null;
  // Which source served analyst_consensus -- null if unavailable.
  consensus_source: DataSourceName | null;
}

export interface PricePoint {
  date: string; // "YYYY-MM-DD"
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface PriceHistoryResponse {
  symbol: string;
  currency: string;
  points: PricePoint[]; // ~5yr weekly
  recent_points: PricePoint[]; // ~6-7mo daily
  active_source: DataSourceName;
}

export interface UserPublic {
  id: number;
  email: string;
  name: string;
  created_at: string;
  // False for a Google-only account (see api.ts's loginWithGoogle).
  has_password: boolean;
  // Results League identity -- null until set on the first league action.
  handle: string | null;
  age_band: "under_18" | "18_plus" | null;
  guardian_consent_status: "not_required" | "pending" | "granted" | null;
  school_name: string | null;
  is_admin: boolean;
}

export interface AuthResponse {
  token: string;
  user: UserPublic;
}

// ---------- Paper Trading ----------
// All three of these are served by yfinance. `is_delayed`/`source` are read by
// the UI to render the "Delayed" badge -- always true/"yfinance" today,
// but a future real-time provider swap on the backend would flip these
// with no frontend change needed.

export interface LiveQuote {
  symbol: string;
  price: number;
  previous_close: number | null;
  change: number | null;
  change_pct: number | null;
  currency: string;
  is_delayed: boolean;
  source: string;
  as_of: string; // ISO 8601
}

export type TradingRange = "1D" | "1W" | "1M" | "3M" | "1Y" | "5Y";

export interface IntradayHistoryResponse {
  symbol: string;
  range: TradingRange;
  currency: string;
  points: PricePoint[];
  is_delayed: boolean;
  source: string;
}

export interface TradingSymbolInfo {
  ticker: string;
  resolved_symbol: string;
  exchange: string;
  company_name: string;
  currency: string;
}

export interface ActivityEntry {
  action: string; // "signed_up" | "logged_in" | "searched"
  detail: string | null; // e.g. the company name, for "searched"
  created_at: string;
}

export interface ActivityResponse {
  entries: ActivityEntry[];
}

// ---------- Results League (mirrors backend/app/league_models.py) ----------

export interface LeagueMetric {
  key: "revenue_growth_yoy" | "operating_margin" | "sector_kpi";
  definition_key: string;
  label: string;
  unit: string;
  definition: string;
  min_value: number;
  max_value: number;
}

export interface LeagueConfig {
  market: string;
  timezone: string;
  confidence: number;
  core_metrics: LeagueMetric[];
  kpi_templates: { sector: string; metric: LeagueMetric; source_hint: string }[];
  reason_tags: { key: string; label: string }[];
  excluded_sectors: string[];
  note_max_chars: number;
}

export interface LeagueCompany {
  id: number;
  market_code: string;
  exchange: string;
  ticker: string;
  name: string;
  sector: string;
  currency: string;
  provider_symbol: string | null;
}

export type EventStatus = "draft" | "open" | "locked" | "scored";

export interface EventSummary {
  id: number;
  company: LeagueCompany;
  fiscal_year_label: string;
  fiscal_quarter: number;
  period_end_date: string;
  season_label: string;
  results_date: string;
  lock_at: string; // ISO, UTC
  status: EventStatus;
  submitted: boolean;
}

export interface EventDetail extends EventSummary {
  metrics: LeagueMetric[];
  research_notes: string | null;
  server_now: string; // the database clock when the response was built
}

export interface ForecastValue {
  metric_key: string;
  low: number;
  high: number;
}

export interface Forecast {
  event_id: number;
  submitted_at: string;
  updated_at: string;
  reason_tags: string[];
  note: string | null;
  values: (ForecastValue & { confidence: number })[];
  locked: boolean;
}

export interface QuarterRow {
  period_end_date: string;
  revenue: number | null;
  operating_margin_pct: number | null;
}

export interface ActualRow {
  period_id: number;
  fiscal_year_label: string;
  fiscal_quarter: number;
  period_end_date: string;
  metric_key: string;
  definition_key: string;
  value: number;
  source_url: string;
  entered_at: string;
}

export interface ResearchHistory {
  provider_rows: QuarterRow[];
  provider_source: string;
  provider_definition: string;
  provider_as_of: string | null;
  actuals: ActualRow[];
}

export interface AdminEventRow {
  id: number;
  status: EventStatus;
  lock_at: string;
  results_date: string;
  season_label: string;
  period_id: number;
  fiscal_year_label: string;
  fiscal_quarter: number;
  company_id: number;
  company_name: string;
  ticker: string;
  sector: string;
  lock_passed: boolean;
  forecasts: number;
}

export interface AdminUser {
  id: number;
  email: string;
  name: string;
  handle: string | null;
  age_band: string | null;
  guardian_consent_status: string | null;
  school_name: string | null;
}

export interface AuditEntry {
  id: number;
  at: string;
  actor_user_id: number | null;
  action: string;
  entity: string;
  entity_id: string;
  details: Record<string, unknown> | null;
}


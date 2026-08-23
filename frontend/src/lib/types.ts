// Mirrors backend/app/models.py -- keep in sync if those schemas change.

export type MetricStatus = "good" | "warning" | "bad" | "neutral";

// Which provider served the price/analyst-consensus portion of a response.
// Fundamentals always come from Bharat-SM-Data now (see CLAUDE.md's "Hybrid
// sourcing" section) -- not a per-response variable worth reporting, so this
// only covers the two providers with a fallback relationship: Tapetide
// (primary) and yfinance (fallback on Tapetide quota exhaustion).
export type DataSourceName = "tapetide" | "yfinance";

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
  // Which source served analyst_consensus -- null if it was never
  // attempted/unavailable. info/raw are NOT reported here since they always
  // come from Bharat-SM-Data now.
  consensus_source: DataSourceName | null;
  tapetide_reset_at: string | null; // ISO 8601, set only when we just saw Tapetide's quota message
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
  tapetide_reset_at: string | null;
}

export interface QuotaStatus {
  tapetide_calls_used_today: number;
  tapetide_calls_remaining_estimate: number;
  tapetide_calls_per_search: number;
  tapetide_searches_remaining_estimate: number;
  tapetide_reset_at: string; // next local midnight IST
}

export interface UserPublic {
  id: number;
  email: string;
  name: string;
  created_at: string;
  // False for a Google-only account (see api.ts's loginWithGoogle) --
  // SettingsPanel.tsx uses this to skip the password-verification step
  // before reconfiguring a saved Tapetide key, since that check would
  // otherwise always fail for an account with no password to verify.
  has_password: boolean;
  // The account's saved Tapetide key, decrypted and ready to use -- null if
  // this account never saved one. See TapetideKeyGate.tsx.
  tapetide_key: string | null;
}

export interface AuthResponse {
  token: string;
  user: UserPublic;
}

export interface ActivityEntry {
  action: string; // "signed_up" | "logged_in" | "searched"
  detail: string | null; // e.g. the company name, for "searched"
  created_at: string;
}

export interface ActivityResponse {
  entries: ActivityEntry[];
}

import type {
  Video,
  PeerSummary,
  PracticeAttempt,
  PracticeCard,
  PracticeCase,
  PracticePrices,
  CompanyNews,
  MacroSeries,
  NewsList,
  NewsView,
  WorldEvent,
  WorldEventIn,
  AdminBoardRow,
  OlderCompany,
  ResultProposal,
  AdminUser,
  AuditEntry,
  EventDetail,
  EventResult,
  EventOutcome,
  RecentResult,
  EventSummary,
  Forecast,
  ForecastValue,
  LeagueConfig,
  ResearchHistory,
  Season,
  ActivityResponse,
  AuthResponse,
  CompanyFinancialsResponse,
  IntradayHistoryResponse,
  LiveQuote,
  PriceHistoryResponse,
  TradingRange,
  TradingSymbolInfo,
  UserPublic,
  Workspace,
  WorkspaceState,
  WorksheetData,
} from "./types";
import { getAuthToken } from "./auth";

// Vite's dev server proxies /api to the FastAPI backend (see vite.config.ts),
// and in production this should be served behind the same origin/reverse
// proxy as the backend -- so a bare relative path is intentional here.
const BASE_URL = "/api";

// Attached whenever a token is present in localStorage -- every endpoint
// that reads it (see main.py's _current_user) treats it as optional, so
// this is safe to send unconditionally rather than threading "is the user
// signed in" through every call site.
function authHeaders(): HeadersInit {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export class ApiError extends Error {
  // `code` is set by the Results League endpoints (e.g. "forecast_locked",
  // "profile_required") so the UI can react to a specific rule.
  constructor(message: string, public status: number, public code: string | null = null) {
    super(message);
  }
}

async function parseErrorDetail(res: Response): Promise<{ message: string; code: string | null }> {
  try {
    const body = await res.json();
    if (typeof body.detail === "string") return { message: body.detail, code: null };
    if (body.detail && typeof body.detail.message === "string") {
      return { message: body.detail.message, code: body.detail.code ?? null };
    }
    // FastAPI validation errors: a list of {loc, msg}
    if (Array.isArray(body.detail) && body.detail[0]?.msg) {
      return { message: String(body.detail[0].msg).replace(/^Value error, /, ""), code: "validation" };
    }
  } catch {
    // response wasn't JSON -- fall through to generic message
  }
  return { message: "Something went wrong. Please try again.", code: null };
}

export async function fetchCompany(query: string): Promise<CompanyFinancialsResponse> {
  const res = await fetch(`${BASE_URL}/company/${encodeURIComponent(query)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    const { message } = await parseErrorDetail(res);
    throw new ApiError(message, res.status);
  }
  return res.json();
}

// Dedupes concurrent requests for the same symbol into one real fetch --
// this is the one call fired from a useEffect (PriceChart.tsx) rather than
// an event handler, so React StrictMode's dev-mode mount->cleanup->remount
// double-invokes it on every mount. AbortController looked like the fix
// but isn't reliable here: on a fast/local connection, the first (soon-to-
// be-discarded) request can already be fully sent to -- and started
// processing on -- the server before the abort signal has any chance to
// stop it, since the two invocations happen synchronously, back-to-back,
// while a real network round-trip takes at least a few ms, and each request
// that does get through costs an upstream fetch on a cache miss. Deduping by
// symbol is deterministic instead: the
// second caller just awaits the first's already-in-flight promise, so
// exactly one real request goes out no matter how many times this fires
// for the same symbol in quick succession.
const _inFlightPriceHistory = new Map<string, Promise<PriceHistoryResponse>>();

export async function fetchPriceHistory(symbol: string): Promise<PriceHistoryResponse> {
  const existing = _inFlightPriceHistory.get(symbol);
  if (existing) return existing;

  const promise = (async () => {
    const res = await fetch(`${BASE_URL}/price-history/${encodeURIComponent(symbol)}`);
    if (!res.ok) {
      const { message } = await parseErrorDetail(res);
      throw new ApiError(message, res.status);
    }
    return res.json();
  })();

  _inFlightPriceHistory.set(symbol, promise);
  try {
    return await promise;
  } finally {
    _inFlightPriceHistory.delete(symbol);
  }
}

// ---------- Paper Trading ----------
// No authHeaders() on any of these -- see CLAUDE.md's "Paper Trading"
// section: these three endpoints are entirely yfinance-backed and don't need
// a signed-in session (portfolio state itself never touches the backend at
// all, see lib/portfolio.ts).

export async function searchTradingSymbol(query: string): Promise<TradingSymbolInfo> {
  const res = await fetch(`${BASE_URL}/trading/search/${encodeURIComponent(query)}`);
  if (!res.ok) {
    const { message } = await parseErrorDetail(res);
    throw new ApiError(message, res.status);
  }
  return res.json();
}

export async function fetchLiveQuote(symbol: string): Promise<LiveQuote> {
  const res = await fetch(`${BASE_URL}/trading/quote/${encodeURIComponent(symbol)}`);
  if (!res.ok) {
    const { message } = await parseErrorDetail(res);
    throw new ApiError(message, res.status);
  }
  return res.json();
}

export async function fetchTradingHistory(
  symbol: string,
  range: TradingRange
): Promise<IntradayHistoryResponse> {
  const res = await fetch(
    `${BASE_URL}/trading/history/${encodeURIComponent(symbol)}?range=${range}`
  );
  if (!res.ok) {
    const { message } = await parseErrorDetail(res);
    throw new ApiError(message, res.status);
  }
  return res.json();
}

export async function signUp(
  email: string,
  name: string,
  password: string,
  acceptTerms: boolean
): Promise<AuthResponse> {
  const res = await fetch(`${BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, name, password, accept_terms: acceptTerms }),
  });
  if (!res.ok) {
    const { message } = await parseErrorDetail(res);
    throw new ApiError(message, res.status);
  }
  return res.json();
}

export async function logIn(email: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const { message } = await parseErrorDetail(res);
    throw new ApiError(message, res.status);
  }
  return res.json();
}

// Always resolves (never throws for "no such account") -- the backend
// deliberately returns the same generic response regardless of whether the
// email has an account, to avoid leaking which addresses are registered.
export async function forgotPassword(email: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const { message } = await parseErrorDetail(res);
    throw new ApiError(message, res.status);
  }
}

// Called from ResetPasswordPanel.tsx with the token from the
// "?reset_token=" URL param a reset email links to.
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, new_password: newPassword }),
  });
  if (!res.ok) {
    const { message } = await parseErrorDetail(res);
    throw new ApiError(message, res.status);
  }
}

// Called with the raw ID token JWT from Google Identity Services'
// credential callback (see lib/googleAuth.ts) -- main.py's /api/auth/google
// verifies it server-side before ever trusting it. Same response shape as
// signUp/logIn, so callers treat all three interchangeably.
// A brand-new Google account needs acceptTerms (the sign-up checkbox);
// without it the backend creates nothing and answers code "terms_required".
export async function loginWithGoogle(credential: string, acceptTerms: boolean): Promise<AuthResponse> {
  const res = await fetch(`${BASE_URL}/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential, accept_terms: acceptTerms }),
  });
  if (!res.ok) {
    const { message, code } = await parseErrorDetail(res);
    throw new ApiError(message, res.status, code);
  }
  return res.json();
}

export async function acceptTerms(): Promise<UserPublic> {
  const res = await fetch(`${BASE_URL}/auth/accept-terms`, { method: "POST", headers: authHeaders() });
  if (!res.ok) {
    const { message } = await parseErrorDetail(res);
    throw new ApiError(message, res.status);
  }
  return res.json();
}

// The first-visit spotlight was opened or skipped: remember it on the account.
export async function markGuideSeen(): Promise<UserPublic> {
  const res = await fetch(`${BASE_URL}/league/me/guide-seen`, { method: "POST", headers: authHeaders() });
  if (!res.ok) {
    const { message } = await parseErrorDetail(res);
    throw new ApiError(message, res.status);
  }
  return res.json();
}

// Settings -> Delete my account. `confirm` must be the typed word "DELETE".
export async function deleteAccount(confirm: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/auth/delete-account`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ confirm }),
  });
  if (!res.ok) {
    const { message } = await parseErrorDetail(res);
    throw new ApiError(message, res.status);
  }
}

export async function logOut(): Promise<void> {
  await fetch(`${BASE_URL}/auth/logout`, { method: "POST", headers: authHeaders() });
}

export async function fetchMe(): Promise<UserPublic | null> {
  const res = await fetch(`${BASE_URL}/auth/me`, { headers: authHeaders() });
  if (!res.ok) return null;
  return res.json();
}

export async function fetchActivity(): Promise<ActivityResponse> {
  const res = await fetch(`${BASE_URL}/activity`, { headers: authHeaders() });
  if (!res.ok) {
    const { message } = await parseErrorDetail(res);
    throw new ApiError(message, res.status);
  }
  return res.json();
}

// ---------- First-party visit counter (replaces Google Analytics) ----------
// Sends only a fixed page name -- never the URL, query string or anything
// about the visitor. See backend/app/services/visits.py.
export type VisitPage =
  | "home"
  | "play"
  | "daily"
  | "me"
  | "boards"
  | "schools"
  | "classes"
  | "live"
  | "consent"
  | "consentform"
  | "search"
  | "trading"
  | "reset_password"
  | "admin"
  | "league"
  | "learn"
  | "practice"
  | "workspace"
  | "event"
  | "results"
  | "privacy"
  | "terms";

export function recordVisit(page: VisitPage): void {
  fetch(`${BASE_URL}/visit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ page }),
    keepalive: true,
  }).catch(() => {
    // Counting is best-effort; never surface an error for it.
  });
}

export interface DailyVisits {
  day: string; // YYYY-MM-DD, India time
  page: string;
  count: number;
}

export async function fetchAdminVisits(days: number): Promise<{ days: number; rows: DailyVisits[] }> {
  const res = await fetch(`${BASE_URL}/admin/visits?days=${days}`, { headers: authHeaders() });
  if (!res.ok) {
    const { message } = await parseErrorDetail(res);
    throw new ApiError(message, res.status);
  }
  return res.json();
}

// ---------- Results League ----------

async function leagueRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  // S2: signed-in GETs never share an edge-cache entry with anonymous ones.
  if (method === "GET" && getAuthToken()) path += `${path.includes("?") ? "&" : "?"}a=1`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...authHeaders() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const { message, code } = await parseErrorDetail(res);
    throw new ApiError(message, res.status, code);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const fetchLeagueConfig = () => leagueRequest<LeagueConfig>("GET", "/league/config");
export const fetchLeagueEvents = (scope: "upcoming" | "scored") =>
  leagueRequest<EventSummary[]>("GET", `/league/events?scope=${scope}`);
export const fetchLeagueEvent = (id: number) => leagueRequest<EventDetail>("GET", `/league/events/${id}`);
export const fetchMyForecast = (id: number) => leagueRequest<Forecast | null>("GET", `/league/events/${id}/my-forecast`);
export const saveForecast = (id: number, body: { values: ForecastValue[]; reason_tags: string[]; note: string | null }) =>
  leagueRequest<Forecast>("PUT", `/league/events/${id}/forecast`, body);
export const fetchMyResult = (id: number) => leagueRequest<EventResult>("GET", `/league/events/${id}/my-result`);
// Public once a company is scored: actual numbers for everyone, forecast or not.
export const fetchOutcome = (id: number) => leagueRequest<EventOutcome>("GET", `/league/events/${id}/outcome`);
export const fetchRecentResults = () => leagueRequest<RecentResult[]>("GET", "/league/recent-results");
export const fetchMySeason = () => leagueRequest<Season>("GET", "/league/me/season");

// ---------- Practice (2026-11-18) ----------
const mysteryQuery = (mystery: boolean) => `mystery=${mystery ? "true" : "false"}`;
export const fetchPracticeCases = (mystery: boolean) =>
  leagueRequest<PracticeCard[]>("GET", `/practice/cases?${mysteryQuery(mystery)}`);
export const fetchPracticeCase = (code: string, mystery: boolean) =>
  leagueRequest<PracticeCase>("GET", `/practice/cases/${code}?${mysteryQuery(mystery)}`);
export const fetchPracticePrices = (code: string, mystery: boolean) =>
  leagueRequest<PracticePrices>("GET", `/practice/cases/${code}/prices?${mysteryQuery(mystery)}`);
export const submitPracticeAttempt = (code: string, ranges: ForecastValue[], mystery: boolean) =>
  leagueRequest<PracticeAttempt>("POST", `/practice/cases/${code}/attempt`, { ranges, mystery });
export const fetchResearchHistory = (companyId: number) =>
  leagueRequest<ResearchHistory>("GET", `/league/companies/${companyId}/history`);
// Research workspace: steps for anyone, saved notes/ticks/worksheet for the student.
export const fetchWorkspace = (eventId: number) => leagueRequest<Workspace>("GET", `/workspace/${eventId}`);
export const saveWorkspace = (
  eventId: number,
  body: { notes?: Record<string, string>; done?: string[]; worksheet?: WorksheetData | null },
) => leagueRequest<WorkspaceState>("PUT", `/workspace/${eventId}`, body);
export const clearWorkspace = (eventId: number) => leagueRequest<void>("DELETE", `/workspace/${eventId}`);
export const updateLeagueProfile = (body: { handle: string; age_band: string; school_name: string | null }) =>
  leagueRequest<UserPublic>("PATCH", "/league/me", body);

// Admin (ADMIN_EMAILS only)
export const adminListEvents = () => leagueRequest<AdminBoardRow[]>("GET", "/admin/events");
export const adminQuickEvent = (body: Record<string, unknown>) => leagueRequest<{ id: number }>("POST", "/admin/events/quick", body);
export const adminPatchEvent = (id: number, body: Record<string, unknown>) =>
  leagueRequest<void>("PATCH", `/admin/events/${id}`, body);
export type ActualInput = { metric_key: string; definition_key: string; value: number; source_url: string };
export const adminPutLastYear = (eventId: number, items: ActualInput[]) =>
  leagueRequest<{ opened: boolean }>("PUT", `/admin/events/${eventId}/last-year`, items);
export const adminScoreEvent = (eventId: number) =>
  leagueRequest<{ scored: number }>("POST", `/admin/events/${eventId}/score`);
// fromProposal: approving a committed proposal. Same endpoint and checks; the
// backend also logs each saved value against the proposed one.
export const adminPutResults = (eventId: number, items: ActualInput[], fromProposal = false) =>
  leagueRequest<void>("PUT", `/admin/events/${eventId}/results${fromProposal ? "?from_proposal=true" : ""}`, items);
export const adminGetProposal = (eventId: number) =>
  leagueRequest<ResultProposal>("GET", `/admin/events/${eventId}/proposal`);
export const adminListOlderResults = () => leagueRequest<OlderCompany[]>("GET", "/admin/older-results");
export type OlderApproveInput = {
  quarters: { fiscal_year_label: string; fiscal_quarter: number; metrics: { metric_key: string; definition_key: string; value: number }[] }[];
};
export const adminApproveOlderResults = (ticker: string, body: OlderApproveInput) =>
  leagueRequest<{ quarters_saved: number; archive_events_created: number }>(
    "POST",
    `/admin/older-results/${encodeURIComponent(ticker)}/approve`,
    body
  );
export const adminFindUsers = (q: string) => leagueRequest<AdminUser[]>("GET", `/admin/users?q=${encodeURIComponent(q)}`);
export interface ConsentDetails {
  parent_name: string;
  method: "signed_form" | "parent_email";
  consent_date: string; // YYYY-MM-DD
}
export const adminSetConsent = (userId: number, status: "pending" | "granted", details?: ConsentDetails) =>
  leagueRequest<void>("PUT", `/admin/users/${userId}/guardian-consent`, { status, ...details });
export const adminAudit = (limit = 100) => leagueRequest<AuditEntry[]>("GET", `/admin/audit?limit=${limit}`);

// ---------- News, world events and macro context ----------

export const fetchNews = (view: NewsView, offset = 0, limit = 20) =>
  leagueRequest<NewsList>("GET", `/news?view=${view}&offset=${offset}&limit=${limit}`);
export const fetchWorldEvents = () => leagueRequest<WorldEvent[]>("GET", "/world-events");
export const fetchMacro = () => leagueRequest<MacroSeries[]>("GET", "/macro");
export const fetchCompanyNews = (symbol: string) =>
  leagueRequest<CompanyNews>("GET", `/news/company/${encodeURIComponent(symbol)}`);
export const adminListWorldEvents = () => leagueRequest<WorldEvent[]>("GET", "/admin/world-events");
export const adminCreateWorldEvent = (body: WorldEventIn) => leagueRequest<WorldEvent>("POST", "/admin/world-events", body);
export const adminUpdateWorldEvent = (id: number, body: WorldEventIn) =>
  leagueRequest<WorldEvent>("PUT", `/admin/world-events/${id}`, body);
export const adminDeleteWorldEvent = (id: number) => leagueRequest<void>("DELETE", `/admin/world-events/${id}`);
export interface JobRun {
  job: string;
  last_run_at: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  last_items: number | null;
  stored: number;
}
export const adminJobs = () => leagueRequest<JobRun[]>("GET", "/admin/jobs");

// Phase 2: weekly numbers, error reports and feedback (admin only).
export interface WeekNumbers {
  week: string;
  visits: number;
  guide_started: number;
  guide_completion_pct: number | null;
  rounds_submitted: number;
  rounds_per_visit: number | null;
  results_viewed: number;
  signups: number;
  returning_students: number;
  forecasts_submitted: number;
  students_improved: number;
}
export interface ErrorReport { created_at: string; source: string; page: string; build: string; message: string }
export interface FeedbackItem { created_at: string; page: string; message: string; email: string | null }
export const adminNumbers = () => leagueRequest<WeekNumbers[]>("GET", "/admin/numbers");
export const adminErrors = () => leagueRequest<ErrorReport[]>("GET", "/admin/errors");
export const adminFeedback = () => leagueRequest<FeedbackItem[]>("GET", "/admin/feedback");

export const fetchPeer = (symbol: string) => leagueRequest<PeerSummary>("GET", `/peer/${encodeURIComponent(symbol)}`);
export const fetchVideos = (view: NewsView) => leagueRequest<Video[]>("GET", `/videos?view=${view}`);

// Quick rounds (master plan phase 5).
export interface PlayCard {
  id: string;
  sector: string;
  sector_name: string;
  difficulty: "easy" | "medium" | "hard" | null;
  name: string | null;
  mystery_line: string | null;
  quarter: string | null;
  metric_key: string;
  label: string;
  unit: string;
  last_year: number | null;
  last_quarter: number | null;
  min_value: number;
  max_value: number;
}
export interface PlayReveal {
  actual: number;
  hit: boolean;
  points: number;
  beat_lazy: boolean | null;
  missed_by: number;
  lazy: number | null;
  note: string | null;
  name: string;
  quarter: string;
}
export const fetchPlayCards = (mystery: boolean) => leagueRequest<PlayCard[]>("GET", `/play/cards?mystery=${mystery ? "true" : "false"}`);
export const revealPlayCard = (id: string, low: number, high: number) =>
  leagueRequest<PlayReveal>("POST", `/play/cards/${encodeURIComponent(id)}/reveal`, { low, high });

// Phase 6: whole rounds are re-scored and saved on the server; the daily
// challenge; progress; boards (services/play.py, progress.py, boards.py).
export interface RoundResult {
  score: number;
  hits: number;
  cards: number;
  saved: boolean;
  not_saved_reason: string | null;
  xp_gained: number;
  xp: number | null;
  level: number | null;
  best: number | null;
  new_badges: string[];
}
export const submitRound = (body: {
  kind: "quick" | "daily";
  answers: { card_id: string; low: number; high: number }[];
  gold_index?: number | null;
}) => leagueRequest<RoundResult>("POST", "/play/rounds", body);
export interface DailyChallenge {
  day: string;
  cards: PlayCard[];
  played: boolean;
  my_score: number | null;
  average: number | null;
}
export const fetchDaily = (mystery: boolean) =>
  leagueRequest<DailyChallenge>("GET", `/play/daily?mystery=${mystery ? "true" : "false"}`);

export interface Progress {
  saving: boolean;
  not_saved_reason: string | null;
  xp: number;
  level: number;
  level_start: number;
  next_level: number;
  xp_today_capped: number;
  daily_cap: number;
  days_played_this_term: number;
  ranges: number;
  ranges_inside: number;
  weeks: { week_start: string; cards: number; hits: number }[];
  badges: { key: string; name: string; description: string; earned_at: string | null }[];
  bests: { quick_round: number | null; daily_challenge: number | null; league: number | null; practice: number | null };
  unlocks: { level: number; key: string; name: string; unlocked: boolean }[];
  forecasts: { event_id: number; company: string; season_label: string; status: string; score: number | null; results_date: string }[];
}
export const fetchProgress = () => leagueRequest<Progress>("GET", "/me/progress");
export const setLeaderboardHidden = (hidden: boolean) => leagueRequest<void>("PUT", "/me/leaderboard", { hidden });

export type BoardKind = "week" | "season" | "improved";
export interface BoardRow {
  rank: number;
  handle: string;
  value: number;
  count: number;
  you: boolean;
}
export interface Board {
  board: BoardKind;
  title: string;
  season_label: string | null;
  minimum: number;
  rows: BoardRow[];
  you: BoardRow | null;
  your_status: string | null;
}
export const fetchBoard = (kind: BoardKind) => leagueRequest<Board>("GET", `/boards/${kind}`);
export const adminHandlesForReview = () =>
  leagueRequest<{ user_id: number; handle: string; handle_status: string }[]>("GET", "/admin/handles");
export const adminSetHandleStatus = (userId: number, status: "ok" | "review" | "blocked") =>
  leagueRequest<void>("PUT", `/admin/users/${userId}/handle-status`, { status });

// RW1 (phase 7): league and practice companies for Research's tiles.
export interface ResearchCompany {
  id: number;
  name: string;
  ticker: string;
  symbol: string;
  sector: string;
  sector_name: string;
}
export const fetchResearchCompanies = () => leagueRequest<ResearchCompany[]>("GET", "/league/companies");

// Phase 8: schools (services/schools.py).
export interface ClassInfo {
  id: number;
  code: string;
  name: string;
  teaching: boolean;
  members: number;
  show_names: boolean;
}
export interface ClassStudent {
  user_id: number;
  display: string;
  started: boolean;
  rounds: number;
  cards: number;
  average: number | null;
  caught: number | null;
  forecasts: number;
  companies: string[];
  consent: "not_needed" | "granted" | "pending" | "paper_received";
}
export interface ClassSession {
  id: number;
  class_id: number;
  index: number;
  total: number;
  card: PlayCard | null;
  revealed: boolean;
  answered: number;
  members: number;
  class_range: [number, number] | null;
  actual: number | null;
  class_hit: boolean | null;
  my_range: [number, number] | null;
  my_hit: boolean | null;
  ended: boolean;
  teaching: boolean;
}
export const fetchClasses = () => leagueRequest<ClassInfo[]>("GET", "/classes");
export const createClass = (name: string) => leagueRequest<ClassInfo>("POST", "/classes", { name });
export const joinClass = (code: string) => leagueRequest<ClassInfo>("POST", "/classes/join", { code });
export const leaveClass = (id: number) => leagueRequest<void>("DELETE", `/classes/${id}/membership`);
export const fetchClassStudents = (id: number) =>
  leagueRequest<{ class: ClassInfo; students: ClassStudent[] }>("GET", `/classes/${id}/students`);
export const markPaperForm = (classId: number, studentId: number) =>
  leagueRequest<void>("PUT", `/classes/${classId}/students/${studentId}/paper-form`);
export const fetchClassBoard = (classId: number, kind: BoardKind) => leagueRequest<Board>("GET", `/classes/${classId}/boards/${kind}`);
export const startSession = (classId: number) => leagueRequest<ClassSession>("POST", `/classes/${classId}/sessions`);
export const fetchCurrentSession = (classId: number) =>
  leagueRequest<{ session_id: number | null }>("GET", `/classes/${classId}/sessions/current`);
export const fetchSession = (id: number) => leagueRequest<ClassSession>("GET", `/sessions/${id}`);
export const answerSession = (id: number, low: number, high: number) =>
  leagueRequest<ClassSession>("POST", `/sessions/${id}/answer`, { low, high });
export const stepSession = (id: number, action: "reveal" | "next" | "end") =>
  leagueRequest<ClassSession>("POST", `/sessions/${id}/step`, { action });
export const requestConsent = (parentEmail: string) =>
  leagueRequest<void>("POST", "/me/consent-request", { parent_email: parentEmail });
export const fetchConsentPage = (token: string) =>
  leagueRequest<{ handle: string; expires_at: string }>("GET", `/consent/${encodeURIComponent(token)}`);
export const answerConsent = (token: string, approve: boolean, parentName: string) =>
  leagueRequest<void>("POST", `/consent/${encodeURIComponent(token)}`, { approve, parent_name: parentName });
export const adminSetRole = (userId: number, role: "student" | "teacher") =>
  leagueRequest<void>("PUT", `/admin/users/${userId}/role`, { role });
export const adminPaperForms = () =>
  leagueRequest<{ user_id: number; handle: string | null; class_name: string; received_at: string }[]>("GET", "/admin/paper-forms");
export const fetchConsentOptions = () => leagueRequest<{ email: boolean }>("GET", "/consent-options");

import type {
  ActivityResponse,
  AuthResponse,
  CompanyFinancialsResponse,
  IntradayHistoryResponse,
  LiveQuote,
  PriceHistoryResponse,
  TradingRange,
  TradingSymbolInfo,
  UserPublic,
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
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function parseErrorDetail(res: Response): Promise<{ message: string }> {
  try {
    const body = await res.json();
    if (typeof body.detail === "string") return { message: body.detail };
    if (body.detail && typeof body.detail.message === "string") return { message: body.detail.message };
  } catch {
    // response wasn't JSON -- fall through to generic message
  }
  return { message: "Something went wrong. Please try again." };
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

export async function signUp(email: string, name: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, name, password }),
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
export async function loginWithGoogle(credential: string): Promise<AuthResponse> {
  const res = await fetch(`${BASE_URL}/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  });
  if (!res.ok) {
    const { message } = await parseErrorDetail(res);
    throw new ApiError(message, res.status);
  }
  return res.json();
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

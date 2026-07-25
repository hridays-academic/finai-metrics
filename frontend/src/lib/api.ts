import type {
  ActivityResponse,
  AuthResponse,
  CompanyFinancialsResponse,
  PriceHistoryResponse,
  QuotaStatus,
  RecommendationsResponse,
  UserPublic,
} from "./types";
import { getAuthToken } from "./auth";
import { getTapetideKey } from "./tapetideKey";

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

// The user's own Tapetide API key (see CLAUDE.md's "Bring-your-own Tapetide
// key" section) -- every endpoint that touches Tapetide reads this header.
// TapetideKeyGate.tsx blocks the whole app until one is stored, so in
// practice this is never missing by the time these calls fire.
function tapetideHeaders(): HeadersInit {
  const key = getTapetideKey();
  return key ? { "X-Tapetide-Token": key } : {};
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public tapetideResetAt: string | null = null) {
    super(message);
  }
}

async function parseErrorDetail(res: Response): Promise<{ message: string; resetAt: string | null }> {
  try {
    const body = await res.json();
    if (typeof body.detail === "string") return { message: body.detail, resetAt: null };
    if (body.detail && typeof body.detail.message === "string") {
      return { message: body.detail.message, resetAt: body.detail.reset_at ?? null };
    }
  } catch {
    // response wasn't JSON -- fall through to generic message
  }
  return { message: "Something went wrong. Please try again.", resetAt: null };
}

export async function fetchCompany(query: string): Promise<CompanyFinancialsResponse> {
  const res = await fetch(`${BASE_URL}/company/${encodeURIComponent(query)}`, {
    headers: { ...authHeaders(), ...tapetideHeaders() },
  });
  if (!res.ok) {
    const { message, resetAt } = await parseErrorDetail(res);
    throw new ApiError(message, res.status, resetAt);
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
// while a real network round-trip takes at least a few ms. For an endpoint
// that spends real, metered, per-user Tapetide quota per call, that raciness
// isn't good enough -- deduping by symbol is deterministic instead: the
// second caller just awaits the first's already-in-flight promise, so
// exactly one real request goes out no matter how many times this fires
// for the same symbol in quick succession.
const _inFlightPriceHistory = new Map<string, Promise<PriceHistoryResponse>>();

export async function fetchPriceHistory(symbol: string): Promise<PriceHistoryResponse> {
  const existing = _inFlightPriceHistory.get(symbol);
  if (existing) return existing;

  const promise = (async () => {
    const res = await fetch(`${BASE_URL}/price-history/${encodeURIComponent(symbol)}`, {
      headers: tapetideHeaders(),
    });
    if (!res.ok) {
      const { message, resetAt } = await parseErrorDetail(res);
      throw new ApiError(message, res.status, resetAt);
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

export async function fetchRecommendations(): Promise<RecommendationsResponse> {
  const res = await fetch(`${BASE_URL}/recommendations`);
  if (!res.ok) {
    const { message, resetAt } = await parseErrorDetail(res);
    throw new ApiError(message, res.status, resetAt);
  }
  return res.json();
}

export async function fetchQuota(): Promise<QuotaStatus> {
  const res = await fetch(`${BASE_URL}/quota`, { headers: tapetideHeaders() });
  if (!res.ok) {
    const { message, resetAt } = await parseErrorDetail(res);
    throw new ApiError(message, res.status, resetAt);
  }
  return res.json();
}

// Called from TapetideKeyGate.tsx with a NOT-yet-stored key (the user just
// typed it in) -- explicit param rather than reading localStorage, since
// the whole point is verifying it before it's saved anywhere.
export async function validateTapetideKey(key: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/tapetide/validate`, { headers: { "X-Tapetide-Token": key } });
  if (!res.ok) {
    const { message } = await parseErrorDetail(res);
    throw new ApiError(message, res.status);
  }
}

// Called from TapetideKeyGate.tsx's key-entry step when the visitor is
// signed in -- validates the key (same check as validateTapetideKey above)
// AND persists it to their account so a future sign-in skips this step.
// Requires auth; the anonymous ("continue without an account") path uses
// validateTapetideKey instead, which never saves anything.
export async function saveTapetideKeyToAccount(key: string): Promise<UserPublic> {
  const res = await fetch(`${BASE_URL}/auth/tapetide-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ key }),
  });
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

// Called with the raw ID token JWT from Google Identity Services'
// credential callback (see lib/googleAuth.ts) -- main.py's /api/auth/google
// verifies it server-side before ever trusting it. Same response shape as
// signUp/logIn, so callers (AuthPanel.tsx, TapetideKeyGate.tsx) treat all
// three interchangeably.
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

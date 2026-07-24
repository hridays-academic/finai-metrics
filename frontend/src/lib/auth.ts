// Pure token storage -- no network calls here (those live in api.ts,
// alongside every other backend call) to avoid a circular import between
// the two (api.ts needs the token to attach Authorization headers; this
// file just needs to read/write it).
const TOKEN_KEY = "finai_auth_token";

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuthToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

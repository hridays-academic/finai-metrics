// Pure token storage -- no network calls here (those live in api.ts,
// alongside every other backend call) to avoid a circular import between
// the two (api.ts needs the token to attach Authorization headers; this
// file just needs to read/write it).
const TOKEN_KEY = "stackly_auth_token";
// Z2 (master plan): the old key's token moves over once, so nobody is signed out.
const OLD_TOKEN_KEY = "finai_auth_token";

export function getAuthToken(): string | null {
  try {
    const old = localStorage.getItem(OLD_TOKEN_KEY);
    if (old !== null) {
      if (localStorage.getItem(TOKEN_KEY) === null) localStorage.setItem(TOKEN_KEY, old);
      localStorage.removeItem(OLD_TOKEN_KEY);
    }
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // storage blocked: the session lasts this page only
  }
}

export function clearAuthToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(OLD_TOKEN_KEY);
  } catch {
    // nothing stored
  }
}

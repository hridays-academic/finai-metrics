// The first-visit spotlight (SpotlightIntro.tsx) shows once per browser and
// once per account. This is the browser half; the account half is
// users.guide_seen_at (POST /api/league/me/guide-seen).

const KEY = "stackly_guide_seen";

// Storage that can't be read counts as seen, so a private window never gets
// the spotlight on every visit.
export function guideSeenHere(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return true;
  }
}

// Only a real "seen" in this browser (not unreadable storage), used to copy
// it onto an account someone signs in to later.
export function guideFlagStored(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function markGuideSeenHere(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // storage unavailable: nothing to remember
  }
}

// Where this page load started. A visit that begins on a shared company,
// results or workspace link never gets the spotlight, even on Home later.
const START_HASH = typeof window === "undefined" ? "" : window.location.hash;

export function startedOnHome(hash: string = START_HASH): boolean {
  const path = hash.replace(/^#/, "").replace(/\/+$/, "");
  return path === "" || path === "/league";
}

export interface SpotlightInputs {
  startedOnHome: boolean;
  seenHere: boolean;
  resetToken: boolean;
  user: { guide_seen?: boolean; needs_terms: boolean } | null;
}

// "show": draw it. "remember": the account already saw it, so this browser
// should remember too. "no": leave things as they are.
export function spotlightDecision(i: SpotlightInputs): "show" | "remember" | "no" {
  if (!i.startedOnHome || i.resetToken || i.user?.needs_terms) return "no";
  if (i.user?.guide_seen) return "remember";
  return i.seenHere ? "no" : "show";
}

// Pure localStorage storage for the user's own Tapetide API key -- same
// pattern as lib/auth.ts's token storage, and for the same reason (avoid a
// circular import with api.ts, which reads this to attach the
// X-Tapetide-Token header to every request that needs it). Every visitor
// brings their own key now (see CLAUDE.md's "Bring-your-own Tapetide key"
// section) -- there's no server-side default anymore, so this is never
// empty for long if the app is to be usable at all, which is what
// TapetideKeyGate.tsx enforces.
const KEY_STORAGE_KEY = "finai_tapetide_key";

export function getTapetideKey(): string | null {
  return localStorage.getItem(KEY_STORAGE_KEY);
}

export function setTapetideKey(key: string): void {
  localStorage.setItem(KEY_STORAGE_KEY, key);
}

export function clearTapetideKey(): void {
  localStorage.removeItem(KEY_STORAGE_KEY);
}

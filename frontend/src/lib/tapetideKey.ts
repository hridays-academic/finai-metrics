// Pure localStorage storage for the user's own Tapetide API key -- same
// pattern as lib/auth.ts's token storage, and for the same reason (avoid a
// circular import with api.ts, which reads this to attach the
// X-Tapetide-Token header to every request that needs it).
//
// (2026-09) A key here is entirely OPTIONAL now. yfinance is the primary
// data source and needs no key at all (see CLAUDE.md's "Sourcing"
// section), so the common case is that this returns null forever and the
// app works completely normally. The blocking TapetideKeyGate that used to
// guarantee a value here is gone; SettingsPanel.tsx is where a key gets
// added or replaced now, for visitors who want Tapetide's richer
// analyst-target data.
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

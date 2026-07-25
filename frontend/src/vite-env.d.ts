/// <reference types="vite/client" />

// VITE_GOOGLE_CLIENT_ID is the only env var this app reads client-side --
// a public OAuth Client ID (see lib/googleAuth.ts), not a secret. Every
// other credential (Tapetide keys, Moonshot, etc.) stays server-only,
// consistent with CLAUDE.md's "the frontend never sees API keys" rule.
interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

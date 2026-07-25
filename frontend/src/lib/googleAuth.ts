// Thin wrapper around Google Identity Services (GSI, loaded via the
// <script> tag in index.html). VITE_GOOGLE_CLIENT_ID is a public OAuth
// Client ID -- safe to ship in frontend bundle code, unlike a client
// secret, which this ID-token flow never uses at all. This file only
// renders Google's button and forwards the raw ID token JWT it returns;
// main.py's /api/auth/google does the actual verification server-side.

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

export function isGoogleSignInConfigured(): boolean {
  return Boolean(CLIENT_ID);
}

// No-op if the Client ID isn't configured, or the GSI script hasn't
// finished loading yet (it's loaded async -- a render attempt a moment too
// early just does nothing rather than throwing, since GoogleSignInButton.tsx
// already gates on isGoogleSignInConfigured() and re-renders on mount).
export function renderGoogleButton(container: HTMLElement, onCredential: (credential: string) => void): void {
  if (!CLIENT_ID || !window.google) return;
  window.google.accounts.id.initialize({
    client_id: CLIENT_ID,
    callback: (response) => onCredential(response.credential),
  });
  window.google.accounts.id.renderButton(container, {
    type: "standard",
    theme: "outline",
    size: "large",
    width: 280,
    text: "continue_with",
  });
}

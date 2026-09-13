import { useEffect, useRef } from "react";
import { renderGoogleButton, isGoogleSignInConfigured } from "../lib/googleAuth";

interface GoogleSignInButtonProps {
  onCredential: (credential: string) => void;
}

// Renders nothing if VITE_GOOGLE_CLIENT_ID isn't set -- lets AuthPanel.tsx/
// TapetideKeyGate.tsx include this unconditionally without an extra check
// at each call site.
//
// Polls briefly for `window.google` to become available rather than
// checking once on mount -- confirmed live (2026-09) that a single
// one-shot check was a real bug, not just a theoretical race: the GSI
// <script> in index.html loads async/defer, and if it hadn't finished by
// the moment this effect first ran, renderGoogleButton's own no-op guard
// (`if (!window.google) return`) meant the button silently never
// appeared for the rest of that mount -- not even after the script
// finished loading moments later. This is very likely what "Google
// sign-in isn't working" actually was: no error, no visible button, just
// a permanently empty container depending on how fast the script happened
// to load relative to when the panel was opened.
export default function GoogleSignInButton({ onCredential }: GoogleSignInButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    let rendered = false;

    function tryRender() {
      if (rendered || !window.google) return;
      renderGoogleButton(container, onCredential);
      rendered = true;
    }

    tryRender();
    if (rendered) return;

    const interval = setInterval(() => {
      tryRender();
      if (rendered) clearInterval(interval);
    }, 100);
    // Give up after 10s -- if the script hasn't loaded by then, something
    // else is genuinely wrong (network block, ad blocker, etc.), and
    // polling forever would just be silently wasted work.
    const timeout = setTimeout(() => clearInterval(interval), 10_000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isGoogleSignInConfigured()) return null;
  return <div className="google-signin-button" ref={containerRef} />;
}

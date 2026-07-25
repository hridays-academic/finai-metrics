import { useEffect, useRef } from "react";
import { renderGoogleButton, isGoogleSignInConfigured } from "../lib/googleAuth";

interface GoogleSignInButtonProps {
  onCredential: (credential: string) => void;
}

// Renders nothing if VITE_GOOGLE_CLIENT_ID isn't set -- lets AuthPanel.tsx/
// TapetideKeyGate.tsx include this unconditionally without an extra check
// at each call site. Re-runs on every mount (the GSI script loads async,
// so a container that mounted before it finished loading would otherwise
// stay permanently empty).
export default function GoogleSignInButton({ onCredential }: GoogleSignInButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) renderGoogleButton(containerRef.current, onCredential);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isGoogleSignInConfigured()) return null;
  return <div className="google-signin-button" ref={containerRef} />;
}

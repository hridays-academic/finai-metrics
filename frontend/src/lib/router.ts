import { useEffect, useState } from "react";

// Minimal hash routing, no dependency. Hash URLs (#/event/12) are shareable
// and survive reloads without any server-side routing config. Anything that
// isn't a known route falls back to the original sidebar views (route null).
export type Route =
  | { name: "league" }
  | { name: "event"; id: number }
  | { name: "admin" }
  | null;

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, "").replace(/\/+$/, "");
  if (path === "/league") return { name: "league" };
  if (path === "/admin") return { name: "admin" };
  const event = /^\/event\/(\d+)$/.exec(path);
  if (event) return { name: "event", id: Number(event[1]) };
  return null;
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function navigate(hash: string): void {
  window.location.hash = hash;
}

// Clears the hash (back to the sidebar views) without adding a history entry.
export function clearRoute(): void {
  if (window.location.hash) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
}

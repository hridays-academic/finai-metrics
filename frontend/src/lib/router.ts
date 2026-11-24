import { useEffect, useState } from "react";

// Minimal hash routing, no dependency. Hash URLs (#/event/12) are shareable
// and survive reloads without any server-side routing config. Anything that
// isn't a known route falls back to the original sidebar views (route null).
export type Route =
  | { name: "league" }
  | { name: "event"; id: number }
  | { name: "results"; id: number }
  | { name: "workspace"; id: number }
  | { name: "admin" }
  | { name: "learn" }
  | { name: "practice"; code?: string }
  | { name: "privacy" }
  | { name: "terms" }
  | { name: "research" }
  // T16: an address that isn't a page gets "page not found", never Home.
  | { name: "notfound" }
  | null;

export function parseHash(hash: string): Route {
  // A query after the route (#/practice?surprise=1) is the page's own business.
  const path = hash.replace(/^#/, "").split("?")[0].replace(/\/+$/, "");
  // No hash, "#" or "#/": Home (and the hidden extra tools' views).
  if (path === "") return null;
  if (path === "/research") return { name: "research" };
  if (path === "/league") return { name: "league" };
  if (path === "/admin") return { name: "admin" };
  if (path === "/learn") return { name: "learn" };
  if (path === "/practice") return { name: "practice" };
  if (path === "/privacy") return { name: "privacy" };
  if (path === "/terms") return { name: "terms" };
  const event = /^\/event\/(\d+)$/.exec(path);
  if (event) return { name: "event", id: Number(event[1]) };
  const results = /^\/results\/(\d+)$/.exec(path);
  if (results) return { name: "results", id: Number(results[1]) };
  const practiceCase = /^\/practice\/([0-9a-z]{6})$/.exec(path);
  if (practiceCase) return { name: "practice", code: practiceCase[1] };
  const workspace = /^\/workspace\/(\d+)$/.exec(path);
  if (workspace) return { name: "workspace", id: Number(workspace[1]) };
  return { name: "notfound" };
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

// Leaves the current route for the sidebar views as a new history entry, so
// the browser's Back button returns to the page you came from.
export function leaveRoute(): void {
  if (window.location.hash) {
    window.history.pushState(null, "", window.location.pathname + window.location.search);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
}

// Switches route without adding a history entry (a tab switch, like clearRoute).
export function replaceRoute(hash: string): void {
  window.history.replaceState(null, "", window.location.pathname + window.location.search + hash);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

// Clears the hash (back to the sidebar views) without adding a history entry.
export function clearRoute(): void {
  if (window.location.hash) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
}

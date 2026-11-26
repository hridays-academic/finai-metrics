// B5/U3 (master plan): each page's browser title, "<page> · Stackly"
// (wording approved 2026-11-24, decisions 2.12). Company and results pages set
// their own once the company's name has loaded.
import type { Route } from "./router";

export function setPageTitle(page: string | null): void {
  document.title = page ? `${page} · Stackly` : "Stackly";
}

export function titleForRoute(route: Route): string | null | undefined {
  if (route === null) return null;
  switch (route.name) {
    case "league":
      return null;
    case "practice":
      return route.code ? "Practice round" : "Practice";
    case "learn":
      return "How to play";
    case "research":
      return "Research";
    case "play":
      return "Quick round";
    case "daily":
      return "Daily challenge";
    case "me":
      return "Me";
    case "boards":
      return "Leaderboards";
    case "schools":
      return "For schools";
    case "classes":
      return "Classes";
    case "live":
      return "Class round";
    case "consent":
    case "consentform":
      return "Parent approval";
    case "notfound":
      return "Page not found";
    case "privacy":
      return "Privacy Policy";
    case "terms":
      return "Terms of Use";
    case "admin":
      return "Admin";
    case "workspace":
      return "Research workspace";
    default:
      return undefined; // event, results: the page sets it with the company's name
  }
}

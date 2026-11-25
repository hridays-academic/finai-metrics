// Phase 2 (master plan; analytics option a): first-party, cookie-free.
// - recordUsage: one step happened (a daily total on the server; nothing
//   about the visitor). Each step counts at most once per page load.
// - error reports: message, page and build only, at most 5 per page load.
// - sendFeedback: "Something wrong? Tell us".

const BASE = "/api";
const counted = new Set<string>();

export type UsageEvent =
  | "guide_started"
  | "guide_finished"
  | "round_started"
  | "round_submitted"
  | "results_viewed"
  | "signup_done";

function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  });
}

export function recordUsage(event: UsageEvent, page = ""): void {
  if (counted.has(event)) return;
  counted.add(event);
  post("/usage", { event, page }).catch(() => {});
}

function build(): string {
  const src = document.querySelector<HTMLScriptElement>('script[src*="/assets/index-"]')?.src ?? "";
  return /index-([A-Za-z0-9_-]+)\.js/.exec(src)?.[1] ?? "dev";
}

let sent = 0;
export function reportError(message: string): void {
  if (sent >= 5 || !message) return;
  sent += 1;
  // The address without any query (a reset token must never be sent).
  const page = window.location.hash.split("?")[0] || "#/";
  post("/client-error", { message: message.slice(0, 2000), page, build: build() }).catch(() => {});
}

export function installErrorReporting(): void {
  window.addEventListener("error", (e) => reportError(`${e.message} @ ${e.filename?.split("/").pop() ?? ""}:${e.lineno ?? ""}`));
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    reportError(r instanceof Error ? `${r.name}: ${r.message}` : String(r));
  });
}

export async function sendFeedback(message: string, email: string): Promise<void> {
  const page = window.location.hash.split("?")[0] || "#/";
  const res = await post("/feedback", { message, email: email.trim() || null, page });
  if (!res.ok) throw new Error(res.status === 429 ? "Too many messages. Please try again later." : "Couldn't send. Please try again.");
}

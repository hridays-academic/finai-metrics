// Deploy-day smoke test: step 6 of "Deploy plan (Stop 3)" as one command.
//
//   cd frontend && node scripts/smoke.mjs <url> <expected database label> [--allow-reveal]
//   e.g. node scripts/smoke.mjs https://stackslymetrics.com production
//
// Uses the frontend's own Playwright (npm install; `npx playwright install
// chromium` once if the browser is missing). Reads only: it never signs in.
//
// 1. /api/health must report the expected database label.
// 2. In a browser that blocks every non-GET request (answered with an empty
//    204 so the block itself logs nothing; each one is listed), at 1440 and
//    390: Home, Quick round (plays one card), Practice, Research, the
//    Sign-in sheet, Me, Leaderboards, Classes, For schools. Any console
//    error or page error fails. An /api GET answering 5xx also fails.
// 3. /api/play/cards, /api/play/daily, /api/boards/week and
//    /api/league/companies must return 200.
//
// Playing a card needs POST /api/play/cards/{id}/reveal. It is blocked like
// every other write and answered with a stub, so the card's screen is tested
// but the server's scoring isn't. The reveal route only reads (no rate-limit
// row, nothing saved); --allow-reveal lets that one request through.
// Exit code 0 = pass, 1 = fail. Full report: stackly-smoke-report.json in the
// system temp folder (never inside the repo).
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [rawUrl, label, ...flags] = process.argv.slice(2);
if (!rawUrl || !label) {
  console.error("Usage: node scripts/smoke.mjs <url> <expected database label> [--allow-reveal]");
  process.exit(2);
}
const base = rawUrl.replace(/\/+$/, "");
const allowReveal = flags.includes("--allow-reveal");
// The same browser the visual tests use (playwright.config.ts): the cached
// Chrome for Testing build when it's there, else Playwright's own.
const cached = `${os.homedir()}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const launchOptions = fs.existsSync(cached) ? { executablePath: cached } : {};
const STUB_REVEAL = { actual: 10, hit: true, points: 50, beat_lazy: null, missed_by: 0, lazy: null, note: null,
  name: "(stub: reveal blocked)", quarter: "(stub)" };

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

// 1. Health.
try {
  const r = await fetch(`${base}/api/health`, { cache: "no-store" });
  const body = await r.json();
  check("health: database label", r.status === 200 && body.database === label,
    `status ${r.status}, database "${body.database}", expected "${label}"`);
} catch (e) {
  check("health: database label", false, String(e).slice(0, 160));
}

// 3. The four GET endpoints (run before the browser so a dead API fails fast).
for (const path of ["/api/play/cards", "/api/play/daily", "/api/boards/week", "/api/league/companies"]) {
  try {
    const r = await fetch(base + path, { cache: "no-store" });
    let size = "";
    try {
      const j = await r.json();
      size = Array.isArray(j) ? `${j.length} items` : Array.isArray(j?.cards) ? `${j.cards.length} cards` : Array.isArray(j?.rows) ? `${j.rows.length} rows` : "";
    } catch { size = "not JSON"; }
    check(`GET ${path}`, r.status === 200, `status ${r.status}${size ? `, ${size}` : ""}`);
  } catch (e) {
    check(`GET ${path}`, false, String(e).slice(0, 160));
  }
}

// 2. Pages.
async function playOneCard(page) {
  await page.getByText(/^Card 1 of \d+$/).waitFor({ timeout: 20000 });
  for (const [side, value] of [["Low", "0"], ["High", "20"]]) {
    await page.locator(`button[aria-label^="${side}:"]`).first().click();
    const input = page.locator(`input[aria-label="${side} (type a number)"]`);
    await input.fill(value);
    await input.press("Enter");
  }
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await page.locator(".quick-reveal").waitFor({ timeout: 20000 });
}
async function openSignIn(page) {
  await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
  await page.getByRole("dialog").first().waitFor({ state: "visible", timeout: 10000 });
}
const PAGES = [
  ["Home", "#/"],
  ["Quick round (one card)", "#/play", playOneCard],
  ["Practice", "#/practice"],
  ["Research", "#/research"],
  ["Sign-in sheet", "#/", openSignIn],
  ["Me", "#/me"],
  ["Leaderboards", "#/boards"],
  ["Classes", "#/classes"],
  ["For schools", "#/schools"],
];

const blocked = [];
const browser = await chromium.launch(launchOptions);
try {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    for (const [name, hash, act] of PAGES) {
      const phone = w < 641;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: phone, hasTouch: phone });
      await ctx.addInitScript(() => { try { localStorage.setItem("stackly_guide_seen", "1"); } catch {} });
      await ctx.route("**/*", async (route) => {
        const req = route.request();
        const method = req.method();
        if (method === "GET" || method === "HEAD") return route.continue();
        const path = new URL(req.url()).pathname;
        const isReveal = /^\/api\/play\/cards\/[^/]+\/reveal$/.test(path);
        if (isReveal && allowReveal) return route.continue();
        blocked.push(`${w} ${name}: ${method} ${path}${isReveal ? " (stubbed)" : ""}`);
        if (isReveal) return route.fulfill({ status: 200, json: STUB_REVEAL });
        return route.fulfill({ status: 204, body: "" });
      });
      const page = await ctx.newPage();
      const problems = [];
      page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 200)}`); });
      page.on("pageerror", (e) => problems.push(`page error: ${String(e).slice(0, 200)}`));
      page.on("response", (r) => {
        const u = new URL(r.url());
        if (u.pathname.startsWith("/api/") && r.request().method() === "GET" && r.status() >= 500)
          problems.push(`api ${r.status()}: GET ${u.pathname}`);
      });
      let note = "";
      try {
        // A load that never goes quiet is retried once (a cold start), and the
        // retry is reported; console and page errors are never retried.
        try {
          await page.goto(`${base}/${hash}`, { waitUntil: "networkidle", timeout: 45000 });
        } catch (e) {
          if (!String(e).includes("Timeout")) throw e;
          note = "load timed out once, passed on retry";
          await page.goto(`${base}/${hash}`, { waitUntil: "networkidle", timeout: 45000 });
        }
        await page.waitForTimeout(1000);
        if (act) await act(page);
        await page.waitForTimeout(500);
      } catch (e) {
        problems.push(`step failed: ${String(e).split("\n")[0].slice(0, 200)}`);
      }
      check(`${name} at ${w}`, problems.length === 0, [note, ...problems].filter(Boolean).join(" | "));
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
const reportPath = path.join(os.tmpdir(), "stackly-smoke-report.json");
fs.writeFileSync(reportPath, JSON.stringify({ url: base, label, allowReveal, at: new Date().toISOString(), results, blocked }, null, 1));
console.log(`Report: ${reportPath}`);
console.log(`\nBlocked writes: ${blocked.length}${blocked.length ? "\n  " + [...new Set(blocked)].join("\n  ") : ""}`);
console.log(`\n${failed.length ? `FAIL: ${failed.length} of ${results.length} checks failed` : `PASS: all ${results.length} checks`}`);
process.exit(failed.length ? 1 : 0);

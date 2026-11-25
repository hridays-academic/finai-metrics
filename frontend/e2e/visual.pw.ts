import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const fixture = (name: string) => readFileSync(new URL(`./fixture-${name}.json`, import.meta.url), "utf8");

async function mockApi(page: Page) {
  await page.route("**/api/**", (route) => {
    const req = route.request();
    if (req.method() !== "GET") return route.fulfill({ status: 204, body: "" });
    const path = new URL(req.url()).pathname;
    if (path === "/api/auth/me") return route.fulfill({ status: 401, json: { detail: "no" } });
    if (path === "/api/practice/cases") return route.fulfill({ contentType: "application/json", body: fixture("practice") });
    if (path === "/api/league/config") return route.fulfill({ contentType: "application/json", body: fixture("config") });
    return route.fulfill({ json: [] });
  });
  await page.addInitScript(() => {
    try {
      localStorage.setItem("stackly_guide_seen", "1");
      // Same three practice tiles every time.
      Math.random = () => 0.42;
    } catch {}
  });
}

const PAGES: [string, string][] = [
  ["home", "#/"],
  ["practice", "#/practice"],
  ["learn", "#/learn"],
  ["research", "#/research"],
  ["notfound", "#/nope"],
];

for (const [w, h] of [
  [1440, 900],
  [390, 844],
]) {
  for (const [name, hash] of PAGES) {
    test(`${name} at ${w}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await mockApi(page);
      await page.goto(`/${hash}`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(800);
      await expect(page).toHaveScreenshot(`${name}-${w}.png`);
    });
  }
}

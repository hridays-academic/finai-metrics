// Z4 (master plan): drives one practice round in a real browser and prints
// the score the page shows. Run by backend/tests/test_e2e_core_loop.py.
// Usage: node e2e/core-loop.mjs <siteUrl> <practiceCode> <low,high,low,high,low,high>
import { chromium } from "playwright";
import fs from "node:fs";

const [site, code, rangesArg] = process.argv.slice(2);
const ranges = rangesArg.split(",");
const cached = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch(fs.existsSync(cached) ? { executablePath: cached } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const failed = [];
page.on("response", (r) => {
  if (r.url().includes("/api/") && r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`);
});
await page.addInitScript(() => {
  try {
    localStorage.setItem("stackly_guide_seen", "1");
  } catch {}
});
await page.goto(`${site}/#/practice/${code}`, { waitUntil: "networkidle" });
// Each metric's range control: its Low and High numbers can be typed.
const fields = page.locator("form.league-form fieldset:has(.range-slab)");
try {
  await fields.first().waitFor({ timeout: 20000 });
} catch (e) {
  const text = (await page.evaluate(() => document.body.innerText)).slice(0, 600);
  console.error(JSON.stringify({ failed, errors, text }));
  throw e;
}
const count = (await fields.count()) * 2;
for (let i = 0; i < count; i++) {
  const field = fields.nth(Math.floor(i / 2));
  const side = i % 2 === 0 ? "Low" : "High";
  await field.getByRole("button", { name: new RegExp(`^${side}:`) }).click();
  const input = field.getByLabel(`${side} (type a number)`);
  await input.fill(ranges[i]);
  await input.press("Enter");
}
await page.getByRole("button", { name: "Submit and see my score" }).click();
const score = page.locator(".results-score-value");
await score.waitFor({ timeout: 20000 });
console.log(JSON.stringify({ inputs: count, score: (await score.textContent()).trim(), errors }));
await browser.close();

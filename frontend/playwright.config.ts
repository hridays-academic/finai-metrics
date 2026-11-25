// Z5 (master plan): saved baseline screenshots of the main pages, run on
// demand (not on every build): `npm run test:visual`; after an intended
// change, `npm run test:visual -- --update-snapshots`. Data is mocked from
// e2e/fixture-*.json so the pictures only change when the site does.
import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const cached = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

export default defineConfig({
  testDir: "e2e",
  testMatch: /visual\.pw\.ts/,
  workers: 1,
  timeout: 60_000,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" } },
  use: {
    baseURL: "http://127.0.0.1:4179",
    colorScheme: "dark",
    launchOptions: existsSync(cached) ? { executablePath: cached } : {},
  },
  webServer: {
    command: "npx vite build && npx vite preview --port 4179 --strictPort",
    url: "http://127.0.0.1:4179",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});

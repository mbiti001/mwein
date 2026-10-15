import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const localChrome = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].find(path => existsSync(path));

const appPort = process.env.E2E_APP_PORT || "3210";
const dbPort = process.env.E2E_DB_PORT || "3211";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${appPort}`,
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    ...(localChrome ? { launchOptions: { executablePath: localChrome } } : {}),
  },
  webServer: {
    command: "node node_modules/next/dist/bin/next build && node scripts/e2e-outpatient.mjs",
    env: { E2E_PRODUCTION: "1", E2E_HOLD: "1", E2E_KEEP_TEMPORARY_PASSWORD: "1", E2E_APP_PORT: appPort, E2E_DB_PORT: dbPort },
    // Health becomes available before fixture assertions and account resets finish.
    wait: { stdout: new RegExp(`Browser fixture ready at http://127\\.0\\.0\\.1:${appPort}`) },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

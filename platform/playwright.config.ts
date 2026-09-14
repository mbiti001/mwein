import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const localChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3210",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    ...(existsSync(localChrome) ? { launchOptions: { executablePath: localChrome } } : {}),
  },
  webServer: {
    command: "npm run build && E2E_PRODUCTION=1 E2E_HOLD=1 E2E_KEEP_TEMPORARY_PASSWORD=1 E2E_APP_PORT=3210 E2E_DB_PORT=3211 npm run test:e2e",
    url: "http://127.0.0.1:3210/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

import { defineConfig, devices } from "@playwright/test";

/**
 * E2E_MODE=demo       → production build, in-memory fictional demo data (default)
 * E2E_MODE=connected  → production build against the LOCAL Supabase stack (see README)
 * Both run `next start` on a loopback address; nothing is ever mailed.
 */
const mode = process.env.E2E_MODE === "connected" ? "connected" : "demo";
const port = mode === "demo" ? 3100 : 3200;
const baseURL = `http://127.0.0.1:${port}`;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

const serverEnv: Record<string, string> =
  mode === "demo"
    ? { DATA_MODE: "demo", MAIL_MODE: "mock", LIVE_MAILING_ENABLED: "false", DEMO_ALLOW_PRODUCTION_BUILD: "true" }
    : {
        DATA_MODE: "supabase",
        MAIL_MODE: "mock",
        LIVE_MAILING_ENABLED: "false",
        SUPABASE_URL: process.env.SUPABASE_TEST_URL ?? "",
        SUPABASE_ANON_KEY: process.env.SUPABASE_TEST_ANON_KEY ?? "",
        OWNER_EMAIL: process.env.E2E_OWNER_EMAIL ?? "",
      };

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: mode === "demo" ? /demo\..*spec\.ts/ : /connected\..*spec\.ts/,
  globalSetup: mode === "connected" ? "./tests/e2e/connected.setup.ts" : undefined,
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } }, grepInvert: /@mobile/ },
    { name: "iphone", use: { ...devices["iPhone 13"], browserName: "chromium" }, grep: /@mobile/ },
  ],
  webServer: {
    command: `npx next start -H 127.0.0.1 -p ${port}`,
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...serverEnv, PORT: String(port) },
  },
});

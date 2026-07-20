import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.E2E_PORT || 4173;
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // In this container point at the pre-installed Chromium via PW_CHROMIUM; in CI
    // (where `playwright install` provides the browser) leave it unset.
    ...(process.env.PW_CHROMIUM ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } } : {}),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node tests/e2e/static-server.mjs",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 20000,
  },
});

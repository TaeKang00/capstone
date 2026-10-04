const { defineConfig } = require("@playwright/test");
const fs = require("node:fs");
const port = Number(process.env.ERP_E2E_PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('ERP_E2E_PORT must be a valid TCP port.');
const baseURL = `http://127.0.0.1:${port}`;

const chromiumPath =
  process.env.CHROMIUM_PATH ||
  (fs.existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
module.exports = defineConfig({
  testDir: "./tests",
  testMatch: "**/erp.spec.cjs",
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
  },
  webServer: {
    command: "node scripts/e2e-server.cjs",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30000,
  },
});

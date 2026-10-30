import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  use: {
    baseURL: process.env.NARADA_E2E_BASE_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
  },
  webServer: process.env.NARADA_E2E_BASE_URL
    ? undefined
    : {
        command: "pnpm dev",
        url: "http://localhost:5173",
        reuseExistingServer: true,
        timeout: 120000,
      },
});

import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const repoRoot = __dirname;
const databaseUrl = `file:${path.join(repoRoot, "prisma", "e2e.db")}`;
const port = 3100;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      SKIP_CLOUDFLARE_DEV_CONTEXT: "1",
      FORCE_NODE_PRISMA: "1",
    },
  },
  globalSetup: path.join(repoRoot, "e2e", "global-setup.ts"),
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
});

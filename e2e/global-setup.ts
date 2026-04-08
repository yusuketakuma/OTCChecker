import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { seedDatabase } from "./seed";

async function globalSetup() {
  const repoRoot = path.resolve(__dirname, "..");
  const dbPath = path.join(repoRoot, "prisma", "e2e.db");
  const databaseUrl = `file:${dbPath}`;

  for (const suffix of ["", "-shm", "-wal"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }

  execFileSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["prisma", "db", "push", "--skip-generate"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
      },
      stdio: "inherit",
    },
  );

  await seedDatabase(databaseUrl);
}

export default globalSetup;

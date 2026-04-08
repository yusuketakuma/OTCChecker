import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8"));

function readGitSha() {
  try {
    return execSync("git rev-parse --short=12 HEAD", {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_VERSION: packageJson.version,
    NEXT_PUBLIC_BUILD_SHA: readGitSha(),
    NEXT_PUBLIC_BUILD_AT: new Date().toISOString(),
    NEXT_PUBLIC_DEPLOY_URL: "https://otcchecker.phcs.workers.dev/",
  },
};

export default nextConfig;

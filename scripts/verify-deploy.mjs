import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const packageJsonPath = path.join(root, "package.json");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const deployUrl = process.env.DEPLOY_URL ?? "https://otcchecker.phcs.workers.dev/";
const workerName = process.env.WORKER_NAME ?? "otc-checker";
const gateToken = process.env.APP_GATE_TOKEN ?? "";
const timeoutMs = Number(process.env.DEPLOY_VERIFY_TIMEOUT_MS ?? 10 * 60 * 1000);
const intervalMs = Number(process.env.DEPLOY_VERIFY_INTERVAL_MS ?? 15 * 1000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runWranglerDeployments() {
  const output = execFileSync(
    "npx",
    ["wrangler", "deployments", "list", "--json", "--name", workerName],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("No deployments were returned by Wrangler.");
  }

  return parsed;
}

function readHeadSha() {
  return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: gateToken
      ? {
          "x-app-gate-token": gateToken,
        }
      : undefined,
  });

  const text = await response.text();
  let payload = null;

  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }

  return { response, payload };
}

async function main() {
  const expectedGitSha = readHeadSha();
  const expectedVersion = packageJson.version;
  const startedAt = Date.now();
  let latestDeployment = null;
  let lastVersionError = null;
  let lastHealthError = null;
  let attempts = 0;

  while (Date.now() - startedAt <= timeoutMs) {
    attempts += 1;
    const deployments = runWranglerDeployments();
    latestDeployment = deployments[0] ?? null;

    const versionResult = await fetchJson(`${deployUrl.replace(/\/$/, "")}/api/version`);
    if (!versionResult.response.ok) {
      lastVersionError = `Version endpoint failed: ${versionResult.response.status}`;
      await sleep(intervalMs);
      continue;
    }

    const versionData = versionResult.payload?.data;
    if (!versionData) {
      lastVersionError = "Version endpoint returned no data payload.";
      await sleep(intervalMs);
      continue;
    }

    if (versionData.gitSha !== expectedGitSha) {
      lastVersionError = `Deployed git SHA mismatch: expected ${expectedGitSha}, got ${versionData.gitSha}`;
      await sleep(intervalMs);
      continue;
    }

    if (versionData.appVersion !== expectedVersion) {
      lastVersionError = `Deployed version mismatch: expected ${expectedVersion}, got ${versionData.appVersion}`;
      await sleep(intervalMs);
      continue;
    }

    const healthResult = await fetchJson(`${deployUrl.replace(/\/$/, "")}/api/health`);
    if (!healthResult.response.ok) {
      lastHealthError = `Health endpoint failed: ${healthResult.response.status}`;
      await sleep(intervalMs);
      continue;
    }

    const healthData = healthResult.payload?.data;
    if (!healthData || healthData.status !== "ok") {
      lastHealthError = "Health endpoint did not report ok status.";
      await sleep(intervalMs);
      continue;
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          attempts,
          deployUrl,
          workerName,
          expectedVersion,
          expectedGitSha,
          latestDeployment: latestDeployment
            ? {
                id: latestDeployment.id,
                created_on: latestDeployment.created_on,
                source: latestDeployment.source,
                version_id: latestDeployment.versions?.[0]?.version_id ?? null,
              }
            : null,
          version: versionData,
          health: healthData,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    JSON.stringify(
      {
        ok: false,
        attempts,
        deployUrl,
        workerName,
        expectedVersion,
        expectedGitSha,
        latestDeployment: latestDeployment
          ? {
              id: latestDeployment.id,
              created_on: latestDeployment.created_on,
              source: latestDeployment.source,
              version_id: latestDeployment.versions?.[0]?.version_id ?? null,
            }
          : null,
        error: lastHealthError ?? lastVersionError ?? "Deployment verification timed out.",
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        deployUrl,
        workerName,
        expectedVersion,
        expectedGitSha: readHeadSha(),
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});

export type BuildInfo = {
  appName: string;
  appVersion: string;
  gitSha: string;
  builtAt: string;
  deployUrl: string;
};

export function getBuildInfo(): BuildInfo {
  return {
    appName: process.env.NEXT_PUBLIC_APP_NAME ?? "OTCChecker",
    appVersion: process.env.NEXT_PUBLIC_BUILD_VERSION ?? "0.0.0",
    gitSha: process.env.NEXT_PUBLIC_BUILD_SHA ?? "unknown",
    builtAt: process.env.NEXT_PUBLIC_BUILD_AT ?? "",
    deployUrl: process.env.NEXT_PUBLIC_DEPLOY_URL ?? "https://otcchecker.phcs.workers.dev/",
  };
}

export const env = {
  appGateToken: process.env.APP_GATE_TOKEN,
  appGatePaths: process.env.APP_GATE_PATHS ?? "/",
  cronSecret: process.env.CRON_SECRET,
  lineChannelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  lineChannelSecret: process.env.LINE_CHANNEL_SECRET,
  nextPublicAppName: process.env.NEXT_PUBLIC_APP_NAME ?? "OTCChecker",
};

export function hasLineCredentials() {
  return Boolean(env.lineChannelAccessToken && env.lineChannelSecret);
}

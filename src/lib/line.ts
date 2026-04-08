import { createHmac, timingSafeEqual } from "node:crypto";

import { LineTargetType } from "@prisma/client";

import { env, hasLineCredentials } from "@/lib/env";

const pushEndpoint = "https://api.line.me/v2/bot/message/push";

export async function sendLineMessage(params: { to: string; text: string }) {
  if (!hasLineCredentials()) {
    throw new Error("LINE_CREDENTIALS_MISSING");
  }

  const response = await fetch(pushEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.lineChannelAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: params.to,
      messages: [{ type: "text", text: params.text }],
    }),
  });

  if (!response.ok) {
    throw new Error(`LINE_PUSH_FAILED:${response.status}`);
  }
}

export function verifyLineSignature(body: string, signature: string | null) {
  if (!env.lineChannelSecret || !signature) {
    return false;
  }

  const digest = createHmac("sha256", env.lineChannelSecret).update(body).digest("base64");

  const digestBuffer = Buffer.from(digest);
  const signatureBuffer = Buffer.from(signature);

  if (digestBuffer.length !== signatureBuffer.length) {
    return false;
  }

  return timingSafeEqual(digestBuffer, signatureBuffer);
}

export function normalizeLineTargetType(value?: string | null) {
  if (value === LineTargetType.GROUP || value === LineTargetType.ROOM) {
    return value;
  }

  if (value === LineTargetType.USER) {
    return value;
  }

  return LineTargetType.NONE;
}

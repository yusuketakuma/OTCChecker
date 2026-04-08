import { fail, ok } from "@/lib/api";
import { normalizeLineTargetType, verifyLineSignature } from "@/lib/line";
import { prisma } from "@/lib/prisma";

type LineWebhookPayload = {
  events?: Array<{
    source?: {
      type?: string;
      userId?: string;
      groupId?: string;
      roomId?: string;
    };
  }>;
};

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature");

  if (!verifyLineSignature(rawBody, signature)) {
    return fail(401, "INVALID_LINE_SIGNATURE", "LINE 署名検証に失敗しました");
  }

  try {
    const body = JSON.parse(rawBody) as LineWebhookPayload;
    const source = body.events?.[0]?.source;

    if (!source) {
      return ok({ captured: false });
    }

    const lineTargetType = normalizeLineTargetType(source.type);
    const lineTargetId = source.userId ?? source.groupId ?? source.roomId ?? null;

    if (lineTargetType === "NONE" || !lineTargetId) {
      return ok({ captured: false });
    }

    await prisma.appSettings.upsert({
      where: { id: "singleton" },
      create: {
        id: "singleton",
        defaultAlertDays: [30, 7, 0],
        timezone: "Asia/Tokyo",
        lineEnabled: true,
        lineTargetType,
        lineTargetId,
      },
      update: {
        lineEnabled: true,
        lineTargetType,
        lineTargetId,
      },
    });

    return ok({ captured: true, lineTargetType, lineTargetId });
  } catch (error) {
    return fail(500, "LINE_WEBHOOK_FAILED", "LINE Webhook の処理に失敗しました", error);
  }
}

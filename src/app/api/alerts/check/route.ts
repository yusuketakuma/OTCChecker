import { AlertKind, NotificationDeliveryStatus, Prisma } from "@prisma/client";

import { fail, ok } from "@/lib/api";
import { diffDaysFromToday, formatDateLabel, parseDateOnly, todayJstKey } from "@/lib/date";
import { env, hasLineCredentials } from "@/lib/env";
import { sendLineMessage } from "@/lib/line";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";

export async function POST(request: Request) {
  try {
    const secret = request.headers.get("x-cron-secret");

    if (env.cronSecret && secret !== env.cronSecret) {
      return fail(401, "INVALID_CRON_SECRET", "Cron secret が一致しません");
    }

    const businessDate = todayJstKey();
    const businessDateValue = parseDateOnly(businessDate);
    const settings = await getSettings();
    const lots = await prisma.inventoryLot.findMany({
      where: {
        status: "ACTIVE",
        quantity: { gt: 0 },
      },
      include: { product: true },
      orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });

    const targetLots: typeof lots = [];
    const logsToCreate: Array<{
      lotId: string;
      alertKind: AlertKind;
      thresholdDays?: number;
      businessDate?: Date;
    }> = [];

    for (const lot of lots) {
      const diffDays = diffDaysFromToday(lot.expiryDate);

      if (diffDays < 0) {
        const existing = await prisma.alertLog.findFirst({
          where: {
            lotId: lot.id,
            alertKind: AlertKind.EXPIRED,
            businessDate: businessDateValue,
          },
        });

        if (!existing) {
          targetLots.push(lot);
          logsToCreate.push({
            lotId: lot.id,
            alertKind: AlertKind.EXPIRED,
            businessDate: businessDateValue,
          });
        }

        continue;
      }

      if (!lot.product.alertDays.includes(diffDays)) {
        continue;
      }

      const existing = await prisma.alertLog.findFirst({
        where: {
          lotId: lot.id,
          alertKind: AlertKind.THRESHOLD,
          thresholdDays: diffDays,
        },
      });

      if (!existing) {
        targetLots.push(lot);
        logsToCreate.push({
          lotId: lot.id,
          alertKind: AlertKind.THRESHOLD,
          thresholdDays: diffDays,
        });
      }
    }

    if (logsToCreate.length === 0) {
      return ok({ sent: 0, message: "対象なし" });
    }

    const deliveryPayload = {
      lots: targetLots.map((lot) => ({
        lotId: lot.id,
        productId: lot.productId,
        janCode: lot.product.janCode,
        productName: lot.product.name,
        spec: lot.product.spec,
        expiryDate: formatDateLabel(lot.expiryDate),
        quantity: lot.quantity,
      })),
    } satisfies Prisma.InputJsonValue;

    async function recordDelivery(status: NotificationDeliveryStatus, reason: string) {
      await prisma.notificationDeliveryLog.create({
        data: {
          businessDate: businessDateValue,
          status,
          reason,
          targetId: settings.lineTargetId,
          lotCount: targetLots.length,
          payload: deliveryPayload,
        },
      });
    }

    if (!settings.lineEnabled) {
      await recordDelivery(NotificationDeliveryStatus.SKIPPED, "LINE_DISABLED");
      return ok({
        sent: 0,
        notified: false,
        skippedReason: "LINE_DISABLED",
      });
    }

    if (!settings.lineTargetId) {
      await recordDelivery(NotificationDeliveryStatus.SKIPPED, "LINE_TARGET_MISSING");
      return ok({
        sent: 0,
        notified: false,
        skippedReason: "LINE_TARGET_MISSING",
      });
    }

    if (!hasLineCredentials()) {
      await recordDelivery(NotificationDeliveryStatus.SKIPPED, "LINE_CREDENTIALS_MISSING");
      return ok({
        sent: 0,
        notified: false,
        skippedReason: "LINE_CREDENTIALS_MISSING",
      });
    }

    const expired = targetLots
      .filter((lot) => diffDaysFromToday(lot.expiryDate) < 0)
      .map(
        (lot) =>
          `・${lot.product.name} ${lot.product.spec}｜期限: ${formatDateLabel(lot.expiryDate)}｜残: ${lot.quantity}個`,
      );
    const within7 = targetLots
      .filter((lot) => {
        const diffDays = diffDaysFromToday(lot.expiryDate);
        return diffDays >= 0 && diffDays <= 7;
      })
      .map(
        (lot) =>
          `・${lot.product.name} ${lot.product.spec}｜期限: ${formatDateLabel(lot.expiryDate)}｜残: ${lot.quantity}個`,
      );
    const within30 = targetLots
      .filter((lot) => {
        const diffDays = diffDaysFromToday(lot.expiryDate);
        return diffDays > 7 && diffDays <= 30;
      })
      .map(
        (lot) =>
          `・${lot.product.name} ${lot.product.spec}｜期限: ${formatDateLabel(lot.expiryDate)}｜残: ${lot.quantity}個`,
      );

    const sections = [
      "【賞味期限アラート】",
      expired.length ? `\n🔴 期限切れ\n${expired.join("\n")}` : "",
      within7.length ? `\n🟡 7日以内\n${within7.join("\n")}` : "",
      within30.length ? `\n🔵 30日以内\n${within30.join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    await sendLineMessage({
      to: settings.lineTargetId,
      text: sections,
    });

    await prisma.alertLog.createMany({
      data: logsToCreate,
    });

    await recordDelivery(NotificationDeliveryStatus.SENT, "LINE_PUSH_SENT");

    return ok({
      sent: logsToCreate.length,
      notified: true,
    });
  } catch (error) {
    const businessDate = todayJstKey();
    const businessDateValue = parseDateOnly(businessDate);

    try {
      await prisma.notificationDeliveryLog.create({
        data: {
          businessDate: businessDateValue,
          status: NotificationDeliveryStatus.FAILED,
          reason: error instanceof Error ? error.message : "UNKNOWN_ERROR",
          lotCount: 0,
          payload: Prisma.JsonNull,
        },
      });
    } catch {
      // Prefer returning the primary alert error even if failure logging also breaks.
    }

    return fail(500, "ALERT_CHECK_FAILED", "アラート実行に失敗しました", error);
  }
}

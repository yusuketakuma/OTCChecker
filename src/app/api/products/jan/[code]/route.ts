import { InventoryLotStatus, Prisma } from "@prisma/client";

import { fail, ok } from "@/lib/api";
import { normalizeJanCode } from "@/lib/csv";
import { formatDateLabel, getExpiryBucket, normalizeAlertDays, diffDaysFromToday } from "@/lib/date";
import { getPrisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;

  try {
    const prisma = await getPrisma();
    const janCode = normalizeJanCode(code);

    if (!/^\d{8,14}$/.test(janCode)) {
      return fail(400, "INVALID_JAN_CODE", "JANコードは数字のみ8〜14桁で入力してください");
    }

    const product = await prisma.product.findUnique({
      where: { janCode },
      select: {
        id: true,
        name: true,
        spec: true,
        janCode: true,
        alertDays: true,
        lots: {
          where: { status: InventoryLotStatus.ACTIVE },
          orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            expiryDate: true,
            quantity: true,
          },
        },
      },
    });

    if (!product) {
      return ok(null);
    }

    const alertDays = Array.isArray(product.alertDays)
      ? normalizeAlertDays(
          product.alertDays
            .map((item) => (typeof item === "number" ? item : Number(item)))
            .filter((item): item is number => Number.isInteger(item) && item >= 0),
        )
      : [30, 7, 0];

    const earliestLot = product.lots[0] ?? null;
    const totalQuantity = product.lots.reduce((sum, lot) => sum + lot.quantity, 0);

    return ok({
      id: product.id,
      name: product.name,
      spec: product.spec,
      janCode: product.janCode,
      alertDays: alertDays as Prisma.JsonValue,
      inventorySummary: {
        totalQuantity,
        activeLotCount: product.lots.length,
        earliestExpiry: earliestLot ? formatDateLabel(earliestLot.expiryDate) : null,
        earliestLotId: earliestLot?.id ?? null,
        bucket: earliestLot ? getExpiryBucket(diffDaysFromToday(earliestLot.expiryDate)) : null,
      },
    });
  } catch (error) {
    return fail(500, "PRODUCT_LOOKUP_FAILED", "JAN照会に失敗しました", error);
  }
}

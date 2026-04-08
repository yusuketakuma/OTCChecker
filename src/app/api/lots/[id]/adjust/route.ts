import { fail, ok } from "@/lib/api";
import { lotAdjustSchema } from "@/lib/validators";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const parsed = lotAdjustSchema.safeParse(await request.json());

    if (!parsed.success) {
      return fail(400, "INVALID_ADJUSTMENT", "在庫調整入力が不正です", parsed.error.flatten());
    }

    const lot = await prisma.inventoryLot.findUnique({ where: { id } });

    if (!lot) {
      return fail(404, "LOT_NOT_FOUND", "ロットが見つかりません");
    }

    if (lot.status === "DELETED") {
      return fail(409, "LOT_DELETED", "削除済みロットは調整できません");
    }

    if (lot.version !== parsed.data.version) {
      return fail(409, "STALE_VERSION", "最新のロット情報ではありません");
    }

    const afterQty = lot.quantity + parsed.data.delta;

    if (afterQty < 0) {
      return fail(422, "NEGATIVE_STOCK", "在庫数を負数にはできません");
    }

    const status = afterQty === 0 ? "ARCHIVED" : "ACTIVE";
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.inventoryLot.update({
        where: { id },
        data: {
          quantity: afterQty,
          status,
          archivedAt: status === "ARCHIVED" ? new Date() : null,
          version: { increment: 1 },
        },
      });

      await tx.adjustmentRecord.create({
        data: {
          lotId: id,
          beforeQty: lot.quantity,
          afterQty,
          delta: parsed.data.delta,
          reason: parsed.data.reason,
        },
      });

      return result;
    });

    return ok(updated);
  } catch (error) {
    return fail(500, "ADJUSTMENT_FAILED", "在庫調整に失敗しました", error);
  }
}

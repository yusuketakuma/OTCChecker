import { fail, ok } from "@/lib/api";
import { disposeSchema } from "@/lib/validators";
import { getPrisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const prisma = getPrisma();
    const parsed = disposeSchema.safeParse(await request.json());

    if (!parsed.success) {
      return fail(400, "INVALID_DISPOSAL", "廃棄入力が不正です", parsed.error.flatten());
    }

    const lot = await prisma.inventoryLot.findUnique({ where: { id } });

    if (!lot) {
      return fail(404, "LOT_NOT_FOUND", "ロットが見つかりません");
    }

    if (lot.status === "DELETED") {
      return fail(409, "LOT_DELETED", "削除済みロットは廃棄できません");
    }

    if (lot.version !== parsed.data.version) {
      return fail(409, "STALE_VERSION", "最新のロット情報ではありません");
    }

    if (lot.quantity < parsed.data.quantity) {
      return fail(422, "INSUFFICIENT_STOCK", "廃棄数が在庫を超えています");
    }

    const nextQuantity = lot.quantity - parsed.data.quantity;
    const status = nextQuantity === 0 ? "ARCHIVED" : "ACTIVE";

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.inventoryLot.update({
        where: { id },
        data: {
          quantity: nextQuantity,
          status,
          archivedAt: status === "ARCHIVED" ? new Date() : null,
          version: { increment: 1 },
        },
      });

      await tx.disposalRecord.create({
        data: {
          lotId: id,
          quantity: parsed.data.quantity,
          reason: parsed.data.reason,
        },
      });

      return result;
    });

    return ok(updated);
  } catch (error) {
    return fail(500, "DISPOSAL_FAILED", "廃棄登録に失敗しました", error);
  }
}

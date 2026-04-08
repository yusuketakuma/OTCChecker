import { fail, ok } from "@/lib/api";
import { ensureLotDeletable } from "@/lib/inventory";
import { lotQuantitySchema } from "@/lib/validators";
import { getPrisma } from "@/lib/prisma";

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const prisma = await getPrisma();
    const parsed = lotQuantitySchema.safeParse(await request.json());

    if (!parsed.success) {
      return fail(400, "INVALID_LOT_UPDATE", "数量修正の入力が不正です", parsed.error.flatten());
    }

    const lot = await prisma.inventoryLot.findUnique({ where: { id } });

    if (!lot) {
      return fail(404, "LOT_NOT_FOUND", "ロットが見つかりません");
    }

    if (lot.status === "DELETED") {
      return fail(409, "LOT_DELETED", "削除済みロットは更新できません");
    }

    if (lot.version !== parsed.data.version) {
      return fail(409, "STALE_VERSION", "最新のロット情報ではありません");
    }

    const nextStatus = parsed.data.quantity === 0 ? "ARCHIVED" : "ACTIVE";
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.inventoryLot.update({
        where: { id },
        data: {
          quantity: parsed.data.quantity,
          status: nextStatus,
          archivedAt: nextStatus === "ARCHIVED" ? new Date() : null,
          version: { increment: 1 },
        },
      });

      if (lot.quantity !== parsed.data.quantity) {
        await tx.adjustmentRecord.create({
          data: {
            lotId: id,
            beforeQty: lot.quantity,
            afterQty: parsed.data.quantity,
            delta: parsed.data.quantity - lot.quantity,
            reason: parsed.data.reason,
          },
        });
      }

      return result;
    });

    return ok(updated);
  } catch (error) {
    return fail(500, "LOT_UPDATE_FAILED", "数量修正に失敗しました", error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const prisma = await getPrisma();
    const lot = await prisma.inventoryLot.findUnique({ where: { id } });

    if (!lot) {
      return fail(404, "LOT_NOT_FOUND", "ロットが見つかりません");
    }

    if (lot.status === "DELETED") {
      return fail(409, "LOT_ALREADY_DELETED", "このロットはすでに削除済みです");
    }

    const deletable = await ensureLotDeletable(id);

    if (!deletable) {
      return fail(409, "LOT_DELETE_BLOCKED", "履歴があるロットは削除できません");
    }

    const deleted = await prisma.inventoryLot.update({
      where: { id },
      data: {
        status: "DELETED",
        deletedAt: new Date(),
        version: { increment: 1 },
      },
    });

    return ok(deleted);
  } catch (error) {
    return fail(500, "LOT_DELETE_FAILED", "ロット削除に失敗しました", error);
  }
}

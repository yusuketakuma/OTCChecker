import { Prisma } from "@prisma/client";
import { z } from "zod";

import { fail, ok } from "@/lib/api";
import { normalizeAlertDays } from "@/lib/date";
import { getPrisma } from "@/lib/prisma";

function readAlertDays(value: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(value)) {
    return [30, 7, 0];
  }

  return normalizeAlertDays(
    value
      .map((item) => (typeof item === "number" ? item : Number(item)))
      .filter((item) => Number.isInteger(item) && item >= 0),
  );
}

const productUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  spec: z.string().trim().min(1).max(120),
  alertDays: z.array(z.number().int().min(0).max(365)).min(1).max(10),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const prisma = await getPrisma();
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        lots: {
          where: {
            status: {
              not: "DELETED",
            },
          },
          orderBy: [{ status: "asc" }, { expiryDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          include: {
            salesRecords: {
              orderBy: { createdAt: "desc" },
            },
            disposalRecords: {
              orderBy: { createdAt: "desc" },
            },
            adjustmentRecords: {
              orderBy: { createdAt: "desc" },
            },
            receiptRecords: {
              orderBy: { createdAt: "desc" },
            },
          },
        },
      },
    });

    if (!product) {
      return fail(404, "PRODUCT_NOT_FOUND", "商品が見つかりません");
    }

    return ok({
      ...product,
      alertDays: readAlertDays(product.alertDays),
    });
  } catch (error) {
    return fail(500, "PRODUCT_FETCH_FAILED", "商品詳細の取得に失敗しました", error);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const prisma = await getPrisma();
    const parsed = productUpdateSchema.safeParse(await request.json());

    if (!parsed.success) {
      return fail(400, "INVALID_PRODUCT", "商品入力が不正です", parsed.error.flatten());
    }

    const updated = await prisma.product.update({
      where: { id },
      data: {
        name: parsed.data.name,
        spec: parsed.data.spec,
        alertDays: normalizeAlertDays(parsed.data.alertDays) as Prisma.InputJsonValue,
      },
    });

    return ok(updated);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return fail(404, "PRODUCT_NOT_FOUND", "商品が見つかりません");
    }

    return fail(500, "PRODUCT_UPDATE_FAILED", "商品更新に失敗しました", error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const prisma = await getPrisma();
    const [product, lotCount] = await Promise.all([
      prisma.product.findUnique({
        where: { id },
        select: { id: true },
      }),
      prisma.inventoryLot.count({
        where: { productId: id },
      }),
    ]);

    if (!product) {
      return fail(404, "PRODUCT_NOT_FOUND", "商品が見つかりません");
    }

    if (lotCount > 0) {
      return fail(409, "PRODUCT_DELETE_BLOCKED", "ロットが存在する商品は削除できません");
    }

    const deleted = await prisma.product.delete({
      where: { id },
    });

    return ok(deleted);
  } catch (error) {
    return fail(500, "PRODUCT_DELETE_FAILED", "商品削除に失敗しました", error);
  }
}

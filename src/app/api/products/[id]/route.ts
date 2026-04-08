import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { z } from "zod";

import { fail, ok } from "@/lib/api";
import { normalizeAlertDays } from "@/lib/date";
import { getPrisma } from "@/lib/prisma";

const productUpdateSchema = z.object({
  name: z.string().min(1).max(120),
  spec: z.string().min(1).max(120),
  alertDays: z.array(z.number().int().min(0).max(365)).min(1).max(10),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const prisma = getPrisma();
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        lots: {
          where: {
            status: {
              not: "DELETED",
            },
          },
          orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
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

    return ok(product);
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
    const prisma = getPrisma();
    const parsed = productUpdateSchema.safeParse(await request.json());

    if (!parsed.success) {
      return fail(400, "INVALID_PRODUCT", "商品入力が不正です", parsed.error.flatten());
    }

    const updated = await prisma.product.update({
      where: { id },
      data: {
        name: parsed.data.name,
        spec: parsed.data.spec,
        alertDays: normalizeAlertDays(parsed.data.alertDays),
      },
    });

    return ok(updated);
  } catch (error) {
    if (error instanceof PrismaClientKnownRequestError && error.code === "P2025") {
      return fail(404, "PRODUCT_NOT_FOUND", "商品が見つかりません");
    }

    return fail(500, "PRODUCT_UPDATE_FAILED", "商品更新に失敗しました", error);
  }
}

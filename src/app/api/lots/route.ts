import { fail, ok } from "@/lib/api";
import { parseDateOnly } from "@/lib/date";
import { lotCreateSchema } from "@/lib/validators";
import { getPrisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const prisma = await getPrisma();
    const { searchParams } = new URL(request.url);
    const productId = searchParams.get("productId");

    if (!productId) {
      return fail(400, "PRODUCT_ID_REQUIRED", "productId は必須です");
    }

    const lots = await prisma.inventoryLot.findMany({
      where: { productId },
      orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });

    return ok(lots);
  } catch (error) {
    return fail(500, "LOTS_FETCH_FAILED", "ロット一覧の取得に失敗しました", error);
  }
}

export async function POST(request: Request) {
  try {
    const prisma = await getPrisma();
    const parsed = lotCreateSchema.safeParse(await request.json());

    if (!parsed.success) {
      return fail(400, "INVALID_LOT", "ロット入力が不正です", parsed.error.flatten());
    }

    const expiryDate = parseDateOnly(parsed.data.expiryDate);
    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: parsed.data.productId },
        select: { id: true },
      });

      if (!product) {
        throw new Error("PRODUCT_NOT_FOUND");
      }

      const existing = await tx.inventoryLot.findFirst({
        where: {
          productId: parsed.data.productId,
          expiryDate,
          status: "ACTIVE",
        },
      });

      const quantity = parsed.data.quantity;

      if (existing) {
        const lot = await tx.inventoryLot.update({
          where: { id: existing.id },
          data: {
            quantity: existing.quantity + quantity,
            initialQuantity: existing.initialQuantity + quantity,
            version: { increment: 1 },
          },
        });

        await tx.receiptRecord.create({
          data: {
            lotId: existing.id,
            quantity,
          },
        });

        return lot;
      }

      const lot = await tx.inventoryLot.create({
        data: {
          productId: parsed.data.productId,
          expiryDate,
          quantity,
          initialQuantity: parsed.data.initialQuantity ?? quantity,
        },
      });

      await tx.receiptRecord.create({
        data: {
          lotId: lot.id,
          quantity,
        },
      });

      return lot;
    });

    return ok(result);
  } catch (error) {
    if (error instanceof Error && error.message === "PRODUCT_NOT_FOUND") {
      return fail(404, "PRODUCT_NOT_FOUND", "商品が見つかりません");
    }

    return fail(500, "LOT_CREATE_FAILED", "ロット登録に失敗しました", error);
  }
}

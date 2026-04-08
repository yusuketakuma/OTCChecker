import { fail, ok } from "@/lib/api";
import { executeManualSale } from "@/lib/inventory";
import { manualSaleSchema } from "@/lib/validators";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const parsed = manualSaleSchema.safeParse(await request.json());

    if (!parsed.success) {
      return fail(400, "INVALID_MANUAL_SALE", "手動売上の入力が不正です", parsed.error.flatten());
    }

    const result = await executeManualSale({
      productId: id,
      quantity: parsed.data.quantity,
      transactionDate: parsed.data.transactionDate,
    });

    return ok(result);
  } catch (error) {
    if (error instanceof Error && error.message === "PRODUCT_NOT_FOUND") {
      return fail(404, "PRODUCT_NOT_FOUND", "商品が見つかりません");
    }

    if (error instanceof Error && error.message === "INSUFFICIENT_STOCK") {
      return fail(422, "INSUFFICIENT_STOCK", "在庫が不足しているため売上を登録できません");
    }

    return fail(500, "MANUAL_SALE_FAILED", "手動売上の登録に失敗しました", error);
  }
}

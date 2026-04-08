import { fail, ok } from "@/lib/api";
import { resolveUnmatchedSale } from "@/lib/inventory";
import { getSettings } from "@/lib/settings";
import { unmatchedResolveSchema } from "@/lib/validators";

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const parsed = unmatchedResolveSchema.safeParse(await request.json());

    if (!parsed.success) {
      return fail(400, "INVALID_RESOLUTION", "解決内容が不正です", parsed.error.flatten());
    }

    const settings =
      parsed.data.action === "RECEIVE_AND_APPLY" ? await getSettings() : null;
    const updated = await resolveUnmatchedSale({
      unmatchedId: id,
      action: parsed.data.action,
      resolutionNote: parsed.data.resolutionNote,
      expiryDate: parsed.data.action === "RECEIVE_AND_APPLY" ? parsed.data.expiryDate : undefined,
      receiptQuantity:
        parsed.data.action === "RECEIVE_AND_APPLY" ? parsed.data.receiptQuantity : undefined,
      productName:
        parsed.data.action === "RECEIVE_AND_APPLY" ? parsed.data.productName : undefined,
      spec: parsed.data.action === "RECEIVE_AND_APPLY" ? parsed.data.spec : undefined,
      defaultAlertDays: settings?.defaultAlertDays,
    });

    return ok(updated);
  } catch (error) {
    if (error instanceof Error && error.message === "UNMATCHED_NOT_FOUND") {
      return fail(404, "UNMATCHED_NOT_FOUND", "未割当データが見つかりません");
    }

    if (error instanceof Error && error.message === "UNMATCHED_ALREADY_RESOLVED") {
      return fail(409, "UNMATCHED_ALREADY_RESOLVED", "この未割当データはすでに解決済みです");
    }

    if (error instanceof Error && error.message === "RECEIPT_INPUT_REQUIRED") {
      return fail(400, "RECEIPT_INPUT_REQUIRED", "入荷期限日と入荷数量が必要です");
    }

    if (error instanceof Error && error.message === "JAN_CODE_REQUIRED") {
      return fail(422, "JAN_CODE_REQUIRED", "JANコードがないため商品照合できません");
    }

    if (error instanceof Error && error.message === "PRODUCT_INPUT_REQUIRED") {
      return fail(400, "PRODUCT_INPUT_REQUIRED", "商品作成には商品名と規格が必要です");
    }

    if (error instanceof Error && error.message === "INSUFFICIENT_STOCK") {
      return fail(422, "INSUFFICIENT_STOCK", "売上反映に必要な在庫がまだ不足しています");
    }

    return fail(500, "UNMATCHED_RESOLVE_FAILED", "未割当の解決に失敗しました", error);
  }
}

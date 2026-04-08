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
      return fail(400, "INVALID_UNMATCHED_RESOLVE", "未割当解決の入力が不正です", parsed.error.flatten());
    }

    const settings = await getSettings();
    const result = await resolveUnmatchedSale({
      unmatchedId: id,
      defaultAlertDays: settings.defaultAlertDays,
      ...parsed.data,
    });

    return ok(result);
  } catch (error) {
    if (error instanceof Error && error.message === "UNMATCHED_NOT_FOUND") {
      return fail(404, "UNMATCHED_NOT_FOUND", "未割当データが見つかりません");
    }

    if (error instanceof Error && error.message === "UNMATCHED_ALREADY_RESOLVED") {
      return fail(409, "UNMATCHED_ALREADY_RESOLVED", "この未割当はすでに解決済みです");
    }

    if (error instanceof Error && error.message === "RECEIPT_INPUT_REQUIRED") {
      return fail(400, "RECEIPT_INPUT_REQUIRED", "入荷反映には期限日と入荷数量が必要です");
    }

    if (error instanceof Error && error.message === "JAN_CODE_REQUIRED") {
      return fail(422, "JAN_CODE_REQUIRED", "未割当データに有効なJANコードがありません");
    }

    if (error instanceof Error && error.message === "PRODUCT_INPUT_REQUIRED") {
      return fail(400, "PRODUCT_INPUT_REQUIRED", "商品作成には商品名と規格が必要です");
    }

    if (error instanceof Error && error.message === "INSUFFICIENT_STOCK") {
      return fail(422, "INSUFFICIENT_STOCK", "入荷後も売上反映に必要な在庫が不足しています");
    }

    return fail(500, "UNMATCHED_RESOLVE_FAILED", "未割当の解決に失敗しました", error);
  }
}

import { fail } from "@/lib/api";

export function mapUnmatchedResolveError(error: unknown) {
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

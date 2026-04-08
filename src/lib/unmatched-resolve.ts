import { fail } from "@/lib/api";

const unmatchedResolveErrorMap = {
  UNMATCHED_NOT_FOUND: {
    status: 404,
    code: "UNMATCHED_NOT_FOUND",
    message: "未割当データが見つかりません",
  },
  UNMATCHED_ALREADY_RESOLVED: {
    status: 409,
    code: "UNMATCHED_ALREADY_RESOLVED",
    message: "この未割当はすでに解決済みです",
  },
  RECEIPT_INPUT_REQUIRED: {
    status: 400,
    code: "RECEIPT_INPUT_REQUIRED",
    message: "入荷反映には期限日と入荷数量が必要です",
  },
  JAN_CODE_REQUIRED: {
    status: 422,
    code: "JAN_CODE_REQUIRED",
    message: "未割当データに有効なJANコードがありません",
  },
  PRODUCT_INPUT_REQUIRED: {
    status: 400,
    code: "PRODUCT_INPUT_REQUIRED",
    message: "商品作成には商品名と規格が必要です",
  },
  INSUFFICIENT_STOCK: {
    status: 422,
    code: "INSUFFICIENT_STOCK",
    message: "入荷後も売上反映に必要な在庫が不足しています",
  },
} as const;

export function getUnmatchedResolveErrorInfo(error: unknown) {
  if (!(error instanceof Error)) {
    return null;
  }

  return unmatchedResolveErrorMap[error.message as keyof typeof unmatchedResolveErrorMap] ?? null;
}

export function getUnmatchedResolveErrorMessage(error: unknown) {
  return getUnmatchedResolveErrorInfo(error)?.message ?? "未割当の解決に失敗しました";
}

export function mapUnmatchedResolveError(error: unknown) {
  const mapped = getUnmatchedResolveErrorInfo(error);

  if (mapped) {
    return fail(mapped.status, mapped.code, mapped.message);
  }

  return fail(500, "UNMATCHED_RESOLVE_FAILED", "未割当の解決に失敗しました", error);
}

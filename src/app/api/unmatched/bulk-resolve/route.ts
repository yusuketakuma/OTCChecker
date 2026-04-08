import { fail, ok } from "@/lib/api";
import { resolveUnmatchedSale } from "@/lib/inventory";
import { getSettings } from "@/lib/settings";
import {
  getUnmatchedResolveErrorMessage,
  mapUnmatchedResolveError,
} from "@/lib/unmatched-resolve";
import { unmatchedBulkResolveSchema } from "@/lib/validators";

export async function POST(request: Request) {
  try {
    const parsed = unmatchedBulkResolveSchema.safeParse(await request.json());

    if (!parsed.success) {
      return fail(400, "INVALID_UNMATCHED_BULK_RESOLVE", "未割当一括解決の入力が不正です", parsed.error.flatten());
    }

    const settings = await getSettings();
    const results: Array<{ unmatchedId: string; status: "resolved" | "failed"; error?: string }> = [];

    for (const entry of parsed.data.entries) {
      try {
        await resolveUnmatchedSale({
          unmatchedId: entry.unmatchedId,
          defaultAlertDays: settings.defaultAlertDays,
          ...entry.payload,
        });
        results.push({ unmatchedId: entry.unmatchedId, status: "resolved" });
      } catch (error) {
        results.push({
          unmatchedId: entry.unmatchedId,
          status: "failed",
          error: getUnmatchedResolveErrorMessage(error),
        });
      }
    }

    const completedCount = results.filter((result) => result.status === "resolved").length;
    const failedCount = results.length - completedCount;

    return ok({
      results,
      completedCount,
      failedCount,
    });
  } catch (error) {
    return mapUnmatchedResolveError(error);
  }
}

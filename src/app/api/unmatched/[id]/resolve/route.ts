import { fail, ok } from "@/lib/api";
import { resolveUnmatchedSale } from "@/lib/inventory";
import { getSettings } from "@/lib/settings";
import { mapUnmatchedResolveError } from "@/lib/unmatched-resolve";
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
    return mapUnmatchedResolveError(error);
  }
}

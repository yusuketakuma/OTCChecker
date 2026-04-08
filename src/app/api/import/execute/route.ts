import { fail, ok } from "@/lib/api";
import { executeImportBatch, mapErrorToStatus } from "@/lib/inventory";
import { csvExecuteSchema } from "@/lib/validators";

export async function POST(request: Request) {
  try {
    const parsed = csvExecuteSchema.safeParse(await request.json());

    if (!parsed.success) {
      return fail(400, "INVALID_EXECUTE_REQUEST", "previewId が不正です", parsed.error.flatten());
    }

    const result = await executeImportBatch(parsed.data.previewId);
    return ok(result);
  } catch (error) {
    const mapped = mapErrorToStatus(error);
    return fail(mapped.status, mapped.code, mapped.message, error);
  }
}

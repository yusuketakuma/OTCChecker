import { fail, ok } from "@/lib/api";
import { normalizeJanCode } from "@/lib/csv";
import { getPrisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;

  try {
    const prisma = await getPrisma();
    const product = await prisma.product.findUnique({
      where: { janCode: normalizeJanCode(code) },
    });

    return ok(product);
  } catch (error) {
    return fail(500, "JAN_LOOKUP_FAILED", "JANコード検索に失敗しました", error);
  }
}

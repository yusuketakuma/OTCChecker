import { fail, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const rows = await prisma.unmatchedSale.findMany({
      orderBy: { importedAt: "desc" },
      where: { resolved: false },
    });

    return ok(rows);
  } catch (error) {
    return fail(500, "UNMATCHED_FETCH_FAILED", "未割当一覧の取得に失敗しました", error);
  }
}

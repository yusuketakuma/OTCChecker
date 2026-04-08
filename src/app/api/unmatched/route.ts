import { fail, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const rows = await prisma.unmatchedSale.findMany({
      include: {
        importBatch: {
          select: {
            id: true,
          },
        },
      },
      orderBy: { importedAt: "desc" },
      where: { resolved: false },
    });

    const janCodes = Array.from(
      new Set(rows.map((row) => row.janCode).filter((value): value is string => Boolean(value))),
    );
    const products = janCodes.length
      ? await prisma.product.findMany({
          where: { janCode: { in: janCodes } },
          select: {
            id: true,
            name: true,
            spec: true,
            janCode: true,
          },
        })
      : [];
    const productByJan = new Map(products.map((product) => [product.janCode, product]));

    return ok(
      rows.map((row) => ({
        ...row,
        matchedProduct: row.janCode ? productByJan.get(row.janCode) ?? null : null,
      })),
    );
  } catch (error) {
    return fail(500, "UNMATCHED_FETCH_FAILED", "未割当一覧の取得に失敗しました", error);
  }
}

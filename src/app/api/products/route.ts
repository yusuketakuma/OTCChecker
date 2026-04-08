import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";

import { fail, ok } from "@/lib/api";
import { listProductMasters, listProductSummaries } from "@/lib/inventory";
import { getPrisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { productSchema } from "@/lib/validators";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("mode") ?? "inventory";
    const data =
      mode === "master"
        ? await listProductMasters({
            search: searchParams.get("q") ?? "",
          })
        : await listProductSummaries({
            search: searchParams.get("q") ?? "",
            bucket: searchParams.get("bucket") ?? "all",
          });

    return ok(data);
  } catch (error) {
    return fail(500, "PRODUCTS_FETCH_FAILED", "商品一覧の取得に失敗しました", error);
  }
}

export async function POST(request: Request) {
  try {
    const prisma = getPrisma();
    const parsed = productSchema.safeParse(await request.json());

    if (!parsed.success) {
      return fail(400, "INVALID_PRODUCT", "商品入力が不正です", parsed.error.flatten());
    }

    const settings = await getSettings();
    const product = await prisma.product.create({
      data: {
        name: parsed.data.name,
        spec: parsed.data.spec,
        janCode: parsed.data.janCode,
        alertDays: parsed.data.alertDays ?? settings.defaultAlertDays,
      },
    });

    return ok(product);
  } catch (error) {
    if (error instanceof PrismaClientKnownRequestError && error.code === "P2002") {
      return fail(409, "PRODUCT_ALREADY_EXISTS", "同じ JAN コードの商品がすでに存在します");
    }

    return fail(500, "PRODUCT_CREATE_FAILED", "商品登録に失敗しました", error);
  }
}

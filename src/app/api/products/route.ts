import { Prisma } from "@prisma/client";

import { fail, ok } from "@/lib/api";
import { listInventoryProducts, listProductMasters, receiveStockInTx } from "@/lib/inventory";
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
            filter: searchParams.get("filter") ?? "all",
          })
        : await listInventoryProducts({
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
    const prisma = await getPrisma();
    const parsed = productSchema.safeParse(await request.json());

    if (!parsed.success) {
      return fail(400, "INVALID_PRODUCT", "商品入力が不正です", parsed.error.flatten());
    }

    const settings = await getSettings();
    const existing = await prisma.product.findUnique({
      where: { janCode: parsed.data.janCode },
    });

    if (existing) {
      if (parsed.data.initialLot) {
        await receiveStockInTx(prisma, {
          productId: existing.id,
          expiryDate: parsed.data.initialLot.expiryDate,
          quantity: parsed.data.initialLot.quantity,
        });
      }

      return ok({
        ...existing,
        action: parsed.data.initialLot ? "received-on-existing" : "existing",
      });
    }

    if (!parsed.data.name || !parsed.data.spec) {
      return fail(400, "INVALID_PRODUCT", "新規商品は商品名と規格が必須です");
    }

    let created;

    try {
      created = await prisma.product.create({
        data: {
          name: parsed.data.name,
          spec: parsed.data.spec,
          janCode: parsed.data.janCode,
          alertDays: (parsed.data.alertDays ?? settings.defaultAlertDays) as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const conflicted = await prisma.product.findUnique({
          where: { janCode: parsed.data.janCode },
        });

        if (conflicted) {
          if (parsed.data.initialLot) {
            await receiveStockInTx(prisma, {
              productId: conflicted.id,
              expiryDate: parsed.data.initialLot.expiryDate,
              quantity: parsed.data.initialLot.quantity,
            });
          }

          return ok({
            ...conflicted,
            action: parsed.data.initialLot ? "received-on-existing" : "existing",
          });
        }
      }

      throw error;
    }

    if (parsed.data.initialLot) {
      await receiveStockInTx(prisma, {
        productId: created.id,
        expiryDate: parsed.data.initialLot.expiryDate,
        quantity: parsed.data.initialLot.quantity,
      });
    }

    return ok({
      ...created,
      action: parsed.data.initialLot ? "created-with-lot" : "created",
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return fail(409, "PRODUCT_ALREADY_EXISTS", "同じ JAN コードの商品がすでに存在します");
    }

    return fail(500, "PRODUCT_CREATE_FAILED", "商品登録に失敗しました", error);
  }
}

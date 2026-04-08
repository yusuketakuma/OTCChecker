import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient, Prisma } from "@prisma/client";

function dateKeyInTokyo(offsetDays: number) {
  const base = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatter.format(base);
}

function parseTokyoDate(dateKey: string) {
  return new Date(`${dateKey}T00:00:00+09:00`);
}

function lotDate(offsetDays: number) {
  return parseTokyoDate(dateKeyInTokyo(offsetDays));
}

async function createProductWithLot(
  prisma: PrismaClient,
  params: {
    name: string;
    spec: string;
    janCode: string;
    alertDays?: number[];
    expiryDate?: Date;
    quantity?: number;
  },
) {
  const product = await prisma.product.create({
    data: {
      name: params.name,
      spec: params.spec,
      janCode: params.janCode,
      alertDays: (params.alertDays ?? [30, 7, 0]) as Prisma.InputJsonValue,
    },
  });

  if (params.expiryDate && params.quantity) {
    const lot = await prisma.inventoryLot.create({
      data: {
        productId: product.id,
        expiryDate: params.expiryDate,
        quantity: params.quantity,
        initialQuantity: params.quantity,
      },
    });

    await prisma.receiptRecord.create({
      data: {
        lotId: lot.id,
        quantity: params.quantity,
      },
    });
  }

  return product;
}

export async function seedDatabase(databaseUrl: string) {
  const prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: databaseUrl }),
  });

  try {
    await prisma.appSettings.upsert({
      where: { id: "singleton" },
      update: {
        defaultAlertDays: [30, 7, 0] as Prisma.InputJsonValue,
      },
      create: {
        id: "singleton",
        defaultAlertDays: [30, 7, 0] as Prisma.InputJsonValue,
        timezone: "Asia/Tokyo",
      },
    });

    await createProductWithLot(prisma, {
      name: "期限切れE2E商品",
      spec: "10錠",
      janCode: "4900000000001",
      expiryDate: lotDate(-2),
      quantity: 5,
    });
    await createProductWithLot(prisma, {
      name: "本日E2E商品",
      spec: "15錠",
      janCode: "4900000000009",
      expiryDate: lotDate(0),
      quantity: 2,
    });
    await createProductWithLot(prisma, {
      name: "7日以内E2E商品",
      spec: "20錠",
      janCode: "4900000000002",
      expiryDate: lotDate(3),
      quantity: 4,
    });
    await createProductWithLot(prisma, {
      name: "30日以内E2E商品",
      spec: "30錠",
      janCode: "4900000000003",
      expiryDate: lotDate(20),
      quantity: 6,
    });
    await createProductWithLot(prisma, {
      name: "安全在庫E2E商品",
      spec: "40錠",
      janCode: "4900000000004",
      expiryDate: lotDate(60),
      quantity: 9,
    });
    await createProductWithLot(prisma, {
      name: "在庫操作E2E商品",
      spec: "100錠",
      janCode: "4900000000005",
      expiryDate: parseTokyoDate("2030-01-15"),
      quantity: 10,
    });
    await createProductWithLot(prisma, {
      name: "既存スキャンE2E商品",
      spec: "20錠",
      janCode: "4900000000006",
      expiryDate: parseTokyoDate("2030-02-20"),
      quantity: 7,
    });
    await createProductWithLot(prisma, {
      name: "CSV既存E2E商品",
      spec: "14包",
      janCode: "4900000000007",
      expiryDate: parseTokyoDate("2030-03-20"),
      quantity: 3,
    });
    await createProductWithLot(prisma, {
      name: "在庫なしE2E商品",
      spec: "5枚",
      janCode: "4900000000008",
    });
  } finally {
    await prisma.$disconnect();
  }
}

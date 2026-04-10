import {
  ImportBatchStatus,
  InventoryLotStatus,
  Prisma,
  type Product,
  UnmatchedReason,
} from "@prisma/client";

import { diffDaysFromToday, formatDateLabel, getExpiryBucket, parseDateOnly } from "@/lib/date";
import { readAlertDays } from "@/lib/alert-days";
import { type ImportRow, type PreviewRow, normalizeJanCode } from "@/lib/csv";
import { getPrisma } from "@/lib/prisma";

export type InventoryProductSummary = {
  productId: string;
  name: string;
  spec: string;
  janCode: string;
  earliestLotId: string | null;
  earliestExpiry: string | null;
  totalQuantity: number;
  activeLotCount: number;
  bucket: "expired" | "today" | "within7" | "within30" | "safe" | "outOfStock";
};

export type ProductMasterSummary = {
  productId: string;
  name: string;
  spec: string;
  janCode: string;
  alertDays: number[];
  earliestExpiry: string | null;
  totalQuantity: number;
  activeLotCount: number;
  primaryLotId: string | null;
  canDelete: boolean;
  bucket: "expired" | "today" | "within7" | "within30" | "safe" | "outOfStock";
};

type ProductSummaryBucket = ProductMasterSummary["bucket"];
type ActiveInventoryBucket = InventoryProductSummary["bucket"];
type ProductMasterFilter = "all" | "attention" | "stocked" | "outOfStock";
type ActiveLotSeed = {
  id: string;
  productId: string;
  expiryDate: Date;
  quantity: number;
};

function getSummaryBucket(expiryDate: Date | string): ActiveInventoryBucket {
  const diffDays = diffDaysFromToday(expiryDate);
  const expiryBucket = getExpiryBucket(diffDays);

  if (expiryBucket === "expired") {
    return "expired";
  }

  if (expiryBucket === "today") {
    return "today";
  }

  if (expiryBucket === "within7") {
    return "within7";
  }

  if (expiryBucket === "within30") {
    return "within30";
  }

  return "safe";
}

function summarizeActiveLots(lots: ActiveLotSeed[]) {
  const earliestLot = lots[0];

  if (!earliestLot) {
    return {
      primaryLotId: null,
      earliestExpiry: null,
      totalQuantity: 0,
      activeLotCount: 0,
      bucket: "outOfStock" as ProductSummaryBucket,
    };
  }

  return {
    primaryLotId: earliestLot.id,
    earliestExpiry: formatDateLabel(earliestLot.expiryDate),
    totalQuantity: lots.reduce((sum, lot) => sum + lot.quantity, 0),
    activeLotCount: lots.length,
    bucket: getSummaryBucket(earliestLot.expiryDate) as ProductSummaryBucket,
  };
}

function groupLotsByProductId<T extends { productId: string }>(lots: T[]) {
  return lots.reduce<Map<string, T[]>>((map, lot) => {
    const current = map.get(lot.productId) ?? [];
    current.push(lot);
    map.set(lot.productId, current);
    return map;
  }, new Map());
}

function matchesInventoryBucket(bucket: ActiveInventoryBucket | "outOfStock", filter = "all") {
  if (filter === "all") {
    return true;
  }

  if (bucket === "outOfStock") {
    return false;
  }

  if (filter === "expired") {
    return bucket === "expired";
  }

  if (filter === "today") {
    return bucket === "today";
  }

  if (filter === "7d") {
    return bucket === "today" || bucket === "within7";
  }

  if (filter === "30d") {
    return bucket === "within30";
  }

  return true;
}

function matchesProductMasterFilter(
  bucket: ProductSummaryBucket,
  filter: ProductMasterFilter | string = "all",
) {
  if (filter === "all") {
    return true;
  }

  if (filter === "attention") {
    return bucket === "expired" || bucket === "today" || bucket === "within7" || bucket === "within30";
  }

  if (filter === "stocked") {
    return bucket !== "outOfStock";
  }

  if (filter === "outOfStock") {
    return bucket === "outOfStock";
  }

  return true;
}

function buildProductSearchWhere(search?: string) {
  const trimmed = search?.trim();

  if (!trimmed) {
    return undefined;
  }

  const normalizedJanSearch = normalizeJanCode(trimmed);
  const orConditions: Prisma.ProductWhereInput[] = [
    { name: { contains: trimmed } },
    { spec: { contains: trimmed } },
    { janCode: { contains: trimmed } },
  ];

  if (normalizedJanSearch && normalizedJanSearch !== trimmed) {
    orConditions.push({ janCode: { contains: normalizedJanSearch } });
  }

  return { OR: orConditions } satisfies Prisma.ProductWhereInput;
}

export async function listInventoryProducts(params: {
  search?: string;
  bucket?: string;
}) {
  const prisma = await getPrisma();
  const productSearchWhere = buildProductSearchWhere(params.search);

  // Fetch ACTIVE lots for stocked products
  const [activeLots, products] = await Promise.all([
    prisma.inventoryLot.findMany({
      where: {
        status: InventoryLotStatus.ACTIVE,
        product: productSearchWhere,
      },
      include: {
        product: true,
      },
      orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.product.findMany({
      where: productSearchWhere,
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        spec: true,
        janCode: true,
        lots: {
          where: { status: InventoryLotStatus.ACTIVE },
          select: { id: true, quantity: true },
        },
      },
    }),
  ]);

  const lotsByProductId = groupLotsByProductId(activeLots);

  const summaries = products
    .map<InventoryProductSummary>((p) => {
      const productLots = lotsByProductId.get(p.id) ?? [];
      const firstLot = productLots[0];
      const totalQuantity = productLots.reduce((sum, l) => sum + l.quantity, 0);

      if (totalQuantity === 0) {
        return {
          productId: p.id,
          name: p.name,
          spec: p.spec,
          janCode: p.janCode,
          earliestLotId: null,
          earliestExpiry: null,
          totalQuantity: 0,
          activeLotCount: 0,
          bucket: "outOfStock" as const,
        };
      }

      const summary = summarizeActiveLots(productLots);

      return {
        productId: p.id,
        name: p.name,
        spec: p.spec,
        janCode: p.janCode,
        earliestLotId: firstLot?.id ?? null,
        earliestExpiry: summary.earliestExpiry,
        totalQuantity: summary.totalQuantity,
        activeLotCount: summary.activeLotCount,
        bucket: summary.bucket,
      };
    })
    .filter((item) => matchesInventoryBucket(item.bucket, params.bucket));

  summaries.sort((left, right) => {
    // Out-of-stock items sort to the end
    if (left.bucket === "outOfStock" && right.bucket !== "outOfStock") return 1;
    if (right.bucket === "outOfStock" && left.bucket !== "outOfStock") return -1;

    const dateCompare = (left.earliestExpiry ?? "").localeCompare(right.earliestExpiry ?? "");

    if (dateCompare !== 0) {
      return dateCompare;
    }

    return left.name.localeCompare(right.name, "ja");
  });

  return summaries;
}

export async function listProductMasters(params: {
  search?: string;
  filter?: ProductMasterFilter | string;
}) {
  const prisma = await getPrisma();
  const productSearchWhere = buildProductSearchWhere(params.search);
  const [products, activeLots, allLots] = await Promise.all([
    prisma.product.findMany({
      where: productSearchWhere,
      orderBy: [{ name: "asc" }, { createdAt: "desc" }],
    }),
    prisma.inventoryLot.findMany({
      where: {
        status: InventoryLotStatus.ACTIVE,
        product: productSearchWhere,
      },
      orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.inventoryLot.findMany({
      where: {
        product: productSearchWhere,
      },
      select: {
        id: true,
        productId: true,
      },
    }),
  ]);

  const lotsByProductId = groupLotsByProductId(activeLots);
  const allLotCountByProductId = allLots.reduce<Map<string, number>>((map, lot) => {
    map.set(lot.productId, (map.get(lot.productId) ?? 0) + 1);
    return map;
  }, new Map());

  return products
    .map<ProductMasterSummary>((product) => {
      const lots = lotsByProductId.get(product.id) ?? [];
      const summary = summarizeActiveLots(lots);

      return {
        productId: product.id,
        name: product.name,
        spec: product.spec,
        janCode: product.janCode,
        alertDays: readAlertDays(product.alertDays),
        primaryLotId: summary.primaryLotId,
        earliestExpiry: summary.earliestExpiry,
        totalQuantity: summary.totalQuantity,
        activeLotCount: summary.activeLotCount,
        canDelete: (allLotCountByProductId.get(product.id) ?? 0) === 0,
        bucket: summary.bucket,
      };
    })
    .filter((product) => matchesProductMasterFilter(product.bucket, params.filter));
}

export async function getDashboardSummary() {
  const prisma = await getPrisma();
  const lots = await prisma.inventoryLot.findMany({
    where: { status: InventoryLotStatus.ACTIVE },
    include: { product: true },
    orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  const unmatchedCount = await prisma.unmatchedSale.count({
    where: { resolved: false },
  });

  const productIds = new Set<string>();
  let totalQuantity = 0;

  const summary = {
    expiredCount: 0,
    within7Count: 0,
    within30Count: 0,
    outOfStockCount: 0,
    unmatchedCount,
    totalSkus: 0,
    totalQuantity: 0,
    alertLots: [] as Array<{
      lotId: string;
      productId: string;
      productName: string;
      spec: string;
      expiryDate: string;
      quantity: number;
      bucket: string;
      janCode: string;
    }>,
  };

  for (const lot of lots) {
    const diffDays = diffDaysFromToday(lot.expiryDate);
    const bucket = getExpiryBucket(diffDays);

    productIds.add(lot.productId);
    totalQuantity += lot.quantity;

    if (bucket === "expired") {
      summary.expiredCount += 1;
    } else if (bucket === "today") {
      summary.within7Count += 1;
    } else if (bucket === "within7") {
      summary.within7Count += 1;
    } else if (bucket === "within30") {
      summary.within30Count += 1;
    }

    if (bucket !== "safe") {
      summary.alertLots.push({
        lotId: lot.id,
        productId: lot.productId,
        productName: lot.product.name,
        spec: lot.product.spec,
        expiryDate: formatDateLabel(lot.expiryDate),
        quantity: lot.quantity,
        bucket,
        janCode: lot.product.janCode,
      });
    }
  }

  summary.totalSkus = productIds.size;
  summary.totalQuantity = totalQuantity;

  // Out-of-stock: products that have lots (non-DELETED) but no active stock.
  // We already have all ACTIVE lots. Products with ACTIVE lots that have quantity > 0
  // are stocked. Products with only archived lots are out-of-stock.
  const productsWithStock = new Set<string>();
  for (const lot of lots) {
    if (lot.quantity > 0) {
      productsWithStock.add(lot.productId);
    }
  }
  const totalProductsWithLots = await prisma.inventoryLot.findMany({
    where: { status: { not: InventoryLotStatus.DELETED } },
    select: { productId: true },
    distinct: ["productId"],
  });
  summary.outOfStockCount = totalProductsWithLots.filter(
    (r) => !productsWithStock.has(r.productId),
  ).length;

  summary.alertLots = summary.alertLots.slice(0, 10);
  return summary;
}

export function allocateLots(
  lots: Array<{ id: string; quantity: number }>,
  requested: number,
) {
  let remaining = requested;
  const allocations: Array<{ lotId: string; quantity: number }> = [];

  for (const lot of lots) {
    if (remaining <= 0) {
      break;
    }

    if (lot.quantity <= 0) {
      continue;
    }

    const applied = Math.min(lot.quantity, remaining);
    allocations.push({ lotId: lot.id, quantity: applied });
    remaining -= applied;
  }

  return {
    allocations,
    appliedQuantity: requested - remaining,
    remainingQuantity: remaining,
  };
}

export function buildSourceRowKey(row: ImportRow) {
  return [row.transactionId, row.transactionDate, row.janCode, row.quantity, row.rowNo].join(
    ":",
  );
}

export async function buildImportPreview(rows: ImportRow[]) {
  const prisma = await getPrisma();
  const janCodes = Array.from(
    new Set(rows.map((row) => normalizeJanCode(row.janCode)).filter(Boolean)),
  );

  const [products, activeLots, existingRows] = await Promise.all([
    prisma.product.findMany({
      where: { janCode: { in: janCodes } },
    }),
    prisma.inventoryLot.findMany({
      where: {
        status: InventoryLotStatus.ACTIVE,
        product: { janCode: { in: janCodes } },
      },
      include: { product: true },
      orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.salesRecord.findMany({
      where: {
        sourceRowKey: {
          in: rows.map((row) => buildSourceRowKey(row)),
        },
      },
      select: { sourceRowKey: true },
    }),
  ]);

  const productByJan = new Map(products.map((item) => [item.janCode, item]));
  const rowKeySet = new Set(existingRows.map((item) => item.sourceRowKey).filter(Boolean));

  const lotsByProduct = activeLots.reduce<Map<string, Array<{ id: string; quantity: number }>>>(
    (map, lot) => {
      const current = map.get(lot.productId) ?? [];
      current.push({ id: lot.id, quantity: lot.quantity });
      map.set(lot.productId, current);
      return map;
    },
    new Map(),
  );

  const previewRows: PreviewRow[] = rows.map((row) => {
    const sourceRowKey = buildSourceRowKey(row);

    if (rowKeySet.has(sourceRowKey)) {
      return {
        ...row,
        status: "DUPLICATE",
        reason: "同じ取込行がすでに実行済みです",
        appliedQuantity: 0,
        remainingQuantity: row.quantity,
      };
    }

    const normalizedJanCode = normalizeJanCode(row.janCode);
    const product = productByJan.get(normalizedJanCode);

    if (!product) {
      return {
        ...row,
        janCode: normalizedJanCode,
        status: "UNMATCHED",
        reason: "JANコードに一致する商品がありません",
        appliedQuantity: 0,
        remainingQuantity: row.quantity,
      };
    }

    const lots = lotsByProduct.get(product.id) ?? [];
    const allocation = allocateLots(lots, row.quantity);

    for (const item of allocation.allocations) {
      const lot = lots.find((entry) => entry.id === item.lotId);

      if (lot) {
        lot.quantity -= item.quantity;
      }
    }

    if (allocation.remainingQuantity > 0) {
      return {
        ...row,
        janCode: normalizedJanCode,
        status: "INSUFFICIENT_STOCK",
        reason: "在庫が不足しています",
        appliedQuantity: allocation.appliedQuantity,
        remainingQuantity: allocation.remainingQuantity,
        productId: product.id,
        matchedProductName: product.name,
      };
    }

    return {
      ...row,
      janCode: normalizedJanCode,
      status: "MATCHED",
      appliedQuantity: allocation.appliedQuantity,
      remainingQuantity: 0,
      productId: product.id,
      matchedProductName: product.name,
    };
  });

  return {
    rows: previewRows,
    meta: {
      rowCount: previewRows.length,
      matchedCount: previewRows.filter((row) => row.status === "MATCHED").length,
      unmatchedCount: previewRows.filter(
        (row) => row.status === "UNMATCHED" || row.status === "INSUFFICIENT_STOCK",
      ).length,
      duplicateCount: previewRows.filter((row) => row.status === "DUPLICATE").length,
    },
  };
}

export async function executeImportBatch(previewId: string) {
  const prisma = await getPrisma();
  try {
    return await prisma.$transaction(async (tx) => {
      const batch = await tx.importBatch.findUnique({
        where: { id: previewId },
      });

      if (!batch) {
        throw new Error("PREVIEW_NOT_FOUND");
      }

      if (batch.status === ImportBatchStatus.EXECUTED) {
        throw new Error("PREVIEW_ALREADY_EXECUTED");
      }

      const payload = batch.previewPayload as
        | { rows: PreviewRow[]; meta: Record<string, number> }
        | null;

      if (!payload) {
        throw new Error("PREVIEW_PAYLOAD_MISSING");
      }

      for (const row of payload.rows) {
        if (!row.productId) {
          await tx.unmatchedSale.create({
            data: {
              rawProductName: row.productName,
              janCode: row.janCode || null,
              quantity: row.quantity,
              requestedQuantity: row.quantity,
              appliedQuantity: 0,
              remainingQuantity: row.quantity,
              reason:
                row.status === "DUPLICATE"
                  ? UnmatchedReason.DUPLICATE_ROW
                  : UnmatchedReason.NO_PRODUCT,
              transactionDate: row.transactionDate ? parseDateOnly(row.transactionDate) : null,
              importBatchId: batch.id,
              sourceRowNo: row.rowNo,
              rawRow: row.rawRow as Prisma.InputJsonValue,
            },
          });
          continue;
        }

        const lots = await tx.inventoryLot.findMany({
          where: {
            productId: row.productId,
            status: InventoryLotStatus.ACTIVE,
          },
          orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        });

        const allocation = allocateLots(
          lots.map((lot) => ({ id: lot.id, quantity: lot.quantity })),
          row.quantity,
        );

        for (const item of allocation.allocations) {
          const lot = lots.find((entry) => entry.id === item.lotId);

          if (!lot) {
            continue;
          }

          const nextQuantity = lot.quantity - item.quantity;

          await tx.inventoryLot.update({
            where: { id: item.lotId },
            data: {
              quantity: nextQuantity,
              version: { increment: 1 },
              status: nextQuantity === 0 ? InventoryLotStatus.ARCHIVED : undefined,
              archivedAt: nextQuantity === 0 ? new Date() : undefined,
            },
          });

          await tx.salesRecord.create({
            data: {
              lotId: item.lotId,
              quantity: item.quantity,
              source: "CSV_IMPORT",
              posTransactionId: row.transactionId || null,
              transactionDate: row.transactionDate ? parseDateOnly(row.transactionDate) : null,
              importBatchId: batch.id,
              sourceRowNo: row.rowNo,
              sourceRowKey: buildSourceRowKey(row),
              dedupeKey: `${buildSourceRowKey(row)}:${item.lotId}`,
            },
          });
        }

        if (allocation.remainingQuantity > 0) {
          await tx.unmatchedSale.create({
            data: {
              rawProductName: row.productName,
              janCode: row.janCode || null,
              quantity: row.quantity,
              requestedQuantity: row.quantity,
              appliedQuantity: allocation.appliedQuantity,
              remainingQuantity: allocation.remainingQuantity,
              reason: UnmatchedReason.INSUFFICIENT_STOCK,
              transactionDate: row.transactionDate ? parseDateOnly(row.transactionDate) : null,
              importBatchId: batch.id,
              sourceRowNo: row.rowNo,
              rawRow: row.rawRow as Prisma.InputJsonValue,
            },
          });
        }
      }

      return tx.importBatch.update({
        where: { id: batch.id },
        data: {
          status: ImportBatchStatus.EXECUTED,
          executedAt: new Date(),
          previewPayload: Prisma.JsonNull,
        },
      });
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message !== "PREVIEW_NOT_FOUND" &&
      error.message !== "PREVIEW_ALREADY_EXECUTED"
    ) {
      await prisma.importBatch.updateMany({
        where: {
          id: previewId,
          status: { not: ImportBatchStatus.EXECUTED },
        },
        data: {
          status: ImportBatchStatus.FAILED,
        },
      });
    }

    throw error;
  }
}

export async function executeManualSale(params: {
  productId: string;
  quantity: number;
  transactionDate?: string;
}) {
  const prisma = await getPrisma();
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: params.productId },
      select: { id: true },
    });

    if (!product) {
      throw new Error("PRODUCT_NOT_FOUND");
    }

    const manualSaleId = crypto.randomUUID();
    const allocation = await applyManualSaleInTx(tx, {
      productId: params.productId,
      quantity: params.quantity,
      transactionDate: params.transactionDate ? parseDateOnly(params.transactionDate) : null,
      saleId: manualSaleId,
    });

    return {
      productId: params.productId,
      quantity: params.quantity,
      transactionDate: params.transactionDate ?? null,
      saleId: manualSaleId,
      allocations: allocation.allocations,
    };
  });
}

export async function receiveStockInTx(
  tx: Prisma.TransactionClient,
  params: { productId: string; expiryDate: string; quantity: number },
) {
  const expiryDate = parseDateOnly(params.expiryDate);
  // Prefer ACTIVE lot to avoid unique constraint violation when both ACTIVE and ARCHIVED
  // lots exist for the same product/expiry (unique is on [productId, expiryDate, status]).
  const existing =
    (await tx.inventoryLot.findFirst({
      where: {
        productId: params.productId,
        expiryDate,
        status: InventoryLotStatus.ACTIVE,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    })) ??
    (await tx.inventoryLot.findFirst({
      where: {
        productId: params.productId,
        expiryDate,
        status: InventoryLotStatus.ARCHIVED,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }));

  if (existing) {
    const nextQuantity = existing.quantity + params.quantity;
    const lot = await tx.inventoryLot.update({
      where: { id: existing.id },
      data: {
        quantity: nextQuantity,
        initialQuantity: existing.initialQuantity + params.quantity,
        status: nextQuantity > 0 ? InventoryLotStatus.ACTIVE : existing.status,
        archivedAt: nextQuantity > 0 ? null : existing.archivedAt,
        version: { increment: 1 },
      },
    });

    await tx.receiptRecord.create({
      data: {
        lotId: existing.id,
        quantity: params.quantity,
      },
    });

    return lot;
  }

  const lot = await tx.inventoryLot.create({
    data: {
      productId: params.productId,
      expiryDate,
      quantity: params.quantity,
      initialQuantity: params.quantity,
    },
  });

  await tx.receiptRecord.create({
    data: {
      lotId: lot.id,
      quantity: params.quantity,
    },
  });

  return lot;
}

async function applyManualSaleInTx(
  tx: Prisma.TransactionClient,
  params: {
    productId: string;
    quantity: number;
    transactionDate: Date | null;
    saleId: string;
  },
) {
  const lots = await tx.inventoryLot.findMany({
    where: {
      productId: params.productId,
      status: InventoryLotStatus.ACTIVE,
    },
    orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });

  const allocation = allocateLots(
    lots.map((lot) => ({ id: lot.id, quantity: lot.quantity })),
    params.quantity,
  );

  if (allocation.remainingQuantity > 0) {
    throw new Error("INSUFFICIENT_STOCK");
  }

  for (const item of allocation.allocations) {
    const lot = lots.find((entry) => entry.id === item.lotId);

    if (!lot) {
      continue;
    }

    const nextQuantity = lot.quantity - item.quantity;

    await tx.inventoryLot.update({
      where: { id: item.lotId },
      data: {
        quantity: nextQuantity,
        version: { increment: 1 },
        status: nextQuantity === 0 ? InventoryLotStatus.ARCHIVED : undefined,
        archivedAt: nextQuantity === 0 ? new Date() : undefined,
      },
    });

    await tx.salesRecord.create({
      data: {
        lotId: item.lotId,
        quantity: item.quantity,
        source: "MANUAL",
        posTransactionId: params.saleId,
        transactionDate: params.transactionDate,
        dedupeKey: `manual:${params.saleId}:${item.lotId}`,
      },
    });
  }

  return allocation;
}

export async function resolveUnmatchedSale(params: {
  unmatchedId: string;
  action: "MARK_RESOLVED" | "RECEIVE_AND_APPLY";
  resolutionNote: string;
  expiryDate?: string;
  receiptQuantity?: number;
  productName?: string;
  spec?: string;
  defaultAlertDays?: number[];
}) {
  const prisma = await getPrisma();
  return prisma.$transaction(async (tx) => {
    const unmatched = await tx.unmatchedSale.findUnique({
      where: { id: params.unmatchedId },
    });

    if (!unmatched) {
      throw new Error("UNMATCHED_NOT_FOUND");
    }

    if (unmatched.resolved) {
      throw new Error("UNMATCHED_ALREADY_RESOLVED");
    }

    if (params.action === "MARK_RESOLVED") {
      return tx.unmatchedSale.update({
        where: { id: params.unmatchedId },
        data: {
          reason: UnmatchedReason.MANUAL_RESOLUTION,
          resolved: true,
          resolutionNote: params.resolutionNote,
        },
      });
    }

    if (!params.expiryDate || !params.receiptQuantity) {
      throw new Error("RECEIPT_INPUT_REQUIRED");
    }

    if (params.receiptQuantity < unmatched.remainingQuantity) {
      throw new Error("RECEIPT_QUANTITY_INSUFFICIENT");
    }

    const janCode = normalizeJanCode(unmatched.janCode);

    if (!janCode) {
      throw new Error("JAN_CODE_REQUIRED");
    }

    let product: Pick<Product, "id" | "name" | "spec" | "janCode"> | null =
      await tx.product.findUnique({
        where: { janCode },
        select: {
          id: true,
          name: true,
          spec: true,
          janCode: true,
        },
      });

    if (!product) {
      if (!params.productName || !params.spec) {
        throw new Error("PRODUCT_INPUT_REQUIRED");
      }

      product = await tx.product.create({
        data: {
          name: params.productName,
          spec: params.spec,
          janCode,
          alertDays: (params.defaultAlertDays ?? [30, 7, 0]) as Prisma.InputJsonValue,
        },
        select: {
          id: true,
          name: true,
          spec: true,
          janCode: true,
        },
      });
    }

    await receiveStockInTx(tx, {
      productId: product.id,
      expiryDate: params.expiryDate,
      quantity: params.receiptQuantity,
    });

    await applyManualSaleInTx(tx, {
      productId: product.id,
      quantity: unmatched.remainingQuantity,
      transactionDate: unmatched.transactionDate,
      saleId: `unmatched:${unmatched.id}:${crypto.randomUUID()}`,
    });

    const resolved = await tx.unmatchedSale.update({
      where: { id: params.unmatchedId },
      data: {
        reason: UnmatchedReason.MANUAL_RESOLUTION,
        resolved: true,
        resolutionNote: params.resolutionNote,
      },
    });

    return {
      unmatched: resolved,
      product,
    };
  });
}

export function mapErrorToStatus(error: unknown) {
  if (!(error instanceof Error)) {
    return { status: 500, code: "UNKNOWN", message: "Unknown error" };
  }

  if (error.message === "PREVIEW_NOT_FOUND") {
    return { status: 404, code: "PREVIEW_NOT_FOUND", message: "Preview not found" };
  }

  if (error.message === "PREVIEW_ALREADY_EXECUTED") {
    return {
      status: 409,
      code: "PREVIEW_ALREADY_EXECUTED",
      message: "This preview has already been executed",
    };
  }

  if (error.message === "PREVIEW_PAYLOAD_MISSING") {
    return {
      status: 409,
      code: "PREVIEW_PAYLOAD_MISSING",
      message: "Preview payload is no longer available",
    };
  }

  return {
    status: 500,
    code: "UNEXPECTED_ERROR",
    message: error.message,
  };
}

export async function ensureLotDeletable(lotId: string) {
  const prisma = await getPrisma();
  const [salesCount, disposalCount, adjustmentCount] = await Promise.all([
    prisma.salesRecord.count({ where: { lotId } }),
    prisma.disposalRecord.count({ where: { lotId } }),
    prisma.adjustmentRecord.count({ where: { lotId } }),
  ]);

  return salesCount === 0 && disposalCount === 0 && adjustmentCount === 0;
}

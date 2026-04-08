import {
  ImportBatchStatus,
  InventoryLotStatus,
  Prisma,
  UnmatchedReason,
} from "@prisma/client";

import { diffDaysFromToday, formatDateLabel, getExpiryBucket, parseDateOnly } from "@/lib/date";
import { type ImportRow, type PreviewRow, normalizeJanCode } from "@/lib/csv";
import { prisma } from "@/lib/prisma";

export type ProductInventorySummary = {
  productId: string;
  name: string;
  spec: string;
  janCode: string;
  earliestExpiry: string | null;
  totalQuantity: number;
  bucket: "expired" | "within7" | "within30" | "safe";
};

export async function listProductSummaries(params: {
  search?: string;
  bucket?: string;
}) {
  const search = params.search?.trim();
  const lots = await prisma.inventoryLot.findMany({
    where: {
      status: InventoryLotStatus.ACTIVE,
      product: search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { janCode: { contains: search } },
            ],
          }
        : undefined,
    },
    include: {
      product: true,
    },
    orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });

  const map = new Map<string, ProductInventorySummary>();

  for (const lot of lots) {
    const diffDays = diffDaysFromToday(lot.expiryDate);
    const bucket = getExpiryBucket(diffDays);
    const summary = map.get(lot.productId) ?? {
      productId: lot.productId,
      name: lot.product.name,
      spec: lot.product.spec,
      janCode: lot.product.janCode,
      earliestExpiry: null,
      totalQuantity: 0,
      bucket: bucket === "today" ? "within7" : bucket,
    };

    summary.totalQuantity += lot.quantity;

    if (!summary.earliestExpiry) {
      summary.earliestExpiry = formatDateLabel(lot.expiryDate);
    }

    if (bucket === "expired") {
      summary.bucket = "expired";
    } else if (bucket === "today" || bucket === "within7") {
      if (summary.bucket !== "expired") {
        summary.bucket = "within7";
      }
    } else if (bucket === "within30" && summary.bucket === "safe") {
      summary.bucket = "within30";
    }

    map.set(lot.productId, summary);
  }

  return Array.from(map.values()).filter((item) => {
    const bucket = params.bucket ?? "all";

    if (bucket === "all") {
      return true;
    }

    if (bucket === "expired") {
      return item.bucket === "expired";
    }

    if (bucket === "7d") {
      return item.bucket === "within7";
    }

    if (bucket === "30d") {
      return item.bucket === "within30";
    }

    return true;
  });
}

export async function getDashboardSummary() {
  const lots = await prisma.inventoryLot.findMany({
    where: { status: InventoryLotStatus.ACTIVE },
    include: { product: true },
    orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  const unmatchedCount = await prisma.unmatchedSale.count({
    where: { resolved: false },
  });

  const summary = {
    expiredCount: 0,
    within7Count: 0,
    within30Count: 0,
    unmatchedCount,
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

    if (bucket === "expired") {
      summary.expiredCount += 1;
    } else if (bucket === "today" || bucket === "within7") {
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
      unmatchedCount: previewRows.filter((row) => row.status !== "MATCHED").length,
      duplicateCount: previewRows.filter((row) => row.status === "DUPLICATE").length,
    },
  };
}

export async function executeImportBatch(previewId: string) {
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
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: params.productId },
      select: { id: true },
    });

    if (!product) {
      throw new Error("PRODUCT_NOT_FOUND");
    }

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

    const transactionDate = params.transactionDate
      ? parseDateOnly(params.transactionDate)
      : null;
    const manualSaleId = crypto.randomUUID();

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
          posTransactionId: manualSaleId,
          transactionDate,
          dedupeKey: `manual:${manualSaleId}:${item.lotId}`,
        },
      });
    }

    return {
      productId: params.productId,
      quantity: params.quantity,
      transactionDate: params.transactionDate ?? null,
      saleId: manualSaleId,
      allocations: allocation.allocations,
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
  const [salesCount, disposalCount, adjustmentCount] = await Promise.all([
    prisma.salesRecord.count({ where: { lotId } }),
    prisma.disposalRecord.count({ where: { lotId } }),
    prisma.adjustmentRecord.count({ where: { lotId } }),
  ]);

  return salesCount === 0 && disposalCount === 0 && adjustmentCount === 0;
}

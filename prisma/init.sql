-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "spec" TEXT NOT NULL,
    "janCode" TEXT NOT NULL,
    "alertDays" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InventoryLot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "expiryDate" DATETIME NOT NULL,
    "quantity" INTEGER NOT NULL,
    "initialQuantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" DATETIME,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InventoryLot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SalesRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lotId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "posTransactionId" TEXT,
    "transactionDate" DATETIME,
    "importBatchId" TEXT,
    "sourceRowNo" INTEGER,
    "sourceRowKey" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SalesRecord_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SalesRecord_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DisposalRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lotId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DisposalRecord_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AlertLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lotId" TEXT NOT NULL,
    "alertKind" TEXT NOT NULL,
    "thresholdDays" INTEGER,
    "businessDate" DATETIME,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AlertLog_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UnmatchedSale" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rawProductName" TEXT NOT NULL,
    "janCode" TEXT,
    "quantity" INTEGER NOT NULL,
    "requestedQuantity" INTEGER NOT NULL,
    "appliedQuantity" INTEGER NOT NULL DEFAULT 0,
    "remainingQuantity" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transactionDate" DATETIME,
    "importBatchId" TEXT,
    "sourceRowNo" INTEGER,
    "rawRow" JSONB,
    "resolutionNote" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "UnmatchedSale_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "previewPayload" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "executedAt" DATETIME
);

-- CreateTable
CREATE TABLE "ReceiptRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lotId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "importBatchId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReceiptRecord_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReceiptRecord_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AdjustmentRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lotId" TEXT NOT NULL,
    "beforeQty" INTEGER NOT NULL,
    "afterQty" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdjustmentRecord_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "defaultAlertDays" JSONB NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tokyo',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_janCode_key" ON "Product"("janCode");

-- CreateIndex
CREATE INDEX "Product_janCode_idx" ON "Product"("janCode");

-- CreateIndex
CREATE INDEX "InventoryLot_productId_expiryDate_idx" ON "InventoryLot"("productId", "expiryDate");

-- CreateIndex
CREATE INDEX "InventoryLot_status_expiryDate_idx" ON "InventoryLot"("status", "expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLot_productId_expiryDate_status_key" ON "InventoryLot"("productId", "expiryDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SalesRecord_dedupeKey_key" ON "SalesRecord"("dedupeKey");

-- CreateIndex
CREATE INDEX "SalesRecord_lotId_createdAt_idx" ON "SalesRecord"("lotId", "createdAt");

-- CreateIndex
CREATE INDEX "SalesRecord_importBatchId_sourceRowNo_idx" ON "SalesRecord"("importBatchId", "sourceRowNo");

-- CreateIndex
CREATE INDEX "DisposalRecord_lotId_createdAt_idx" ON "DisposalRecord"("lotId", "createdAt");

-- CreateIndex
CREATE INDEX "AlertLog_sentAt_idx" ON "AlertLog"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "AlertLog_lotId_thresholdDays_alertKind_key" ON "AlertLog"("lotId", "thresholdDays", "alertKind");

-- CreateIndex
CREATE UNIQUE INDEX "AlertLog_lotId_businessDate_alertKind_key" ON "AlertLog"("lotId", "businessDate", "alertKind");

-- CreateIndex
CREATE INDEX "UnmatchedSale_resolved_importedAt_idx" ON "UnmatchedSale"("resolved", "importedAt");

-- CreateIndex
CREATE INDEX "UnmatchedSale_importBatchId_sourceRowNo_idx" ON "UnmatchedSale"("importBatchId", "sourceRowNo");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_fileHash_key" ON "ImportBatch"("fileHash");

-- CreateIndex
CREATE INDEX "ImportBatch_status_createdAt_idx" ON "ImportBatch"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ReceiptRecord_lotId_createdAt_idx" ON "ReceiptRecord"("lotId", "createdAt");

-- CreateIndex
CREATE INDEX "AdjustmentRecord_lotId_createdAt_idx" ON "AdjustmentRecord"("lotId", "createdAt");


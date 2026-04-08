import { z } from "zod";

import { normalizeJanCode } from "@/lib/csv";
import { normalizeAlertDays } from "@/lib/date";

const trimmedTextSchema = z.string().trim().min(1).max(120);

const alertDaysSchema = z
  .array(z.number().int().min(0).max(365))
  .min(1)
  .max(10)
  .transform(normalizeAlertDays);

const janCodeSchema = z
  .string()
  .transform(normalizeJanCode)
  .refine((value) => /^\d{8,14}$/.test(value), {
    message: "JANコードは数字のみ8〜14桁で入力してください",
  });

export const productSchema = z.object({
  name: trimmedTextSchema,
  spec: trimmedTextSchema,
  janCode: janCodeSchema,
  alertDays: alertDaysSchema.optional(),
  initialLot: z
    .object({
      expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      quantity: z.number().int().positive(),
    })
    .optional(),
});

export const lotCreateSchema = z.object({
  productId: z.string().uuid(),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  quantity: z.number().int().positive(),
  initialQuantity: z.number().int().positive().optional(),
});

export const lotAdjustSchema = z.object({
  delta: z.number().int(),
  reason: z.string().min(1).max(200),
  version: z.number().int().min(1),
});

export const lotQuantitySchema = z.object({
  quantity: z.number().int().min(0),
  reason: z.string().min(1).max(200).default("在庫修正"),
  version: z.number().int().min(1),
});

export const disposeSchema = z.object({
  quantity: z.number().int().positive(),
  reason: z.string().min(1).max(200),
  version: z.number().int().min(1),
});

export const manualSaleSchema = z.object({
  quantity: z.number().int().positive(),
  transactionDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const settingsSchema = z.object({
  defaultAlertDays: alertDaysSchema,
});

export const unmatchedResolveSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("MARK_RESOLVED"),
    resolutionNote: z.string().min(1).max(200),
  }),
  z.object({
    action: z.literal("RECEIVE_AND_APPLY"),
    resolutionNote: z.string().min(1).max(200),
    expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    receiptQuantity: z.number().int().positive(),
    productName: z.string().min(1).max(120).optional(),
    spec: z.string().min(1).max(120).optional(),
  }),
]);

export const unmatchedBulkResolveSchema = z.object({
  entries: z
    .array(
      z.object({
        unmatchedId: z.string().uuid(),
        payload: unmatchedResolveSchema,
      }),
    )
    .min(1)
    .max(100),
});

export const csvExecuteSchema = z.object({
  previewId: z.string().uuid(),
});

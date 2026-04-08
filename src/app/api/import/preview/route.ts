import { ImportBatchStatus } from "@prisma/client";

import { fail, ok } from "@/lib/api";
import { buildFileHash, decodeCsvBuffer, defaultCsvParser } from "@/lib/csv";
import { buildImportPreview } from "@/lib/inventory";
import { getPrisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const prisma = getPrisma();
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return fail(400, "FILE_REQUIRED", "CSV ファイルを指定してください");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const content = decodeCsvBuffer(buffer);
    const fileHash = buildFileHash(content);
    const existing = await prisma.importBatch.findUnique({
      where: { fileHash },
    });

    if (existing?.status === ImportBatchStatus.EXECUTED) {
      return fail(409, "CSV_ALREADY_EXECUTED", "同じ CSV はすでに実行済みです");
    }

    const rows = defaultCsvParser.parse(content);
    const preview = await buildImportPreview(rows);

    const batch = existing
      ? await prisma.importBatch.update({
          where: { id: existing.id },
          data: {
            status: ImportBatchStatus.PREVIEWED,
            rowCount: preview.meta.rowCount,
            matchedCount: preview.meta.matchedCount,
            unmatchedCount: preview.meta.unmatchedCount,
            duplicateCount: preview.meta.duplicateCount,
            previewPayload: preview,
          },
        })
      : await prisma.importBatch.create({
          data: {
            fileName: file.name,
            fileHash,
            status: ImportBatchStatus.PREVIEWED,
            rowCount: preview.meta.rowCount,
            matchedCount: preview.meta.matchedCount,
            unmatchedCount: preview.meta.unmatchedCount,
            duplicateCount: preview.meta.duplicateCount,
            previewPayload: preview,
          },
        });

    return ok({
      previewId: batch.id,
      rows: preview.rows,
      meta: preview.meta,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith("CSV_PARSE_ERROR:") ||
        error.message.startsWith("CSV_VALIDATION_ERROR:"))
    ) {
      return fail(400, "INVALID_CSV", error.message.split(":").slice(1).join(":"));
    }

    return fail(500, "CSV_PREVIEW_FAILED", "CSV プレビューに失敗しました", error);
  }
}

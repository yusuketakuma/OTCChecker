import { createHash } from "crypto";

import Papa from "papaparse";

const requiredHeaders = ["JANコード", "商品名", "数量", "取引日", "取引ID"] as const;

export type ImportRow = {
  rowNo: number;
  janCode: string;
  productName: string;
  quantity: number;
  transactionDate: string;
  transactionId: string;
  rawRow: Record<string, string>;
};

export type PreviewRow = ImportRow & {
  status: "MATCHED" | "UNMATCHED" | "INSUFFICIENT_STOCK" | "DUPLICATE";
  reason?: string;
  appliedQuantity: number;
  remainingQuantity: number;
  productId?: string;
  matchedProductName?: string;
};

export function normalizeJanCode(value: string | null | undefined) {
  return (value ?? "").replaceAll(/[^0-9]/g, "");
}

export function decodeCsvBuffer(buffer: Buffer) {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer);

  if (!utf8.includes("\uFFFD")) {
    return utf8;
  }

  return new TextDecoder("shift-jis", { fatal: false }).decode(buffer);
}

export function buildFileHash(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function isDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export interface ParserStrategy {
  parse(content: string): ImportRow[];
}

export class GenericPosCsvParser implements ParserStrategy {
  parse(content: string) {
    const parsed = Papa.parse<Record<string, string>>(content, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim(),
    });

    if (parsed.errors.length > 0) {
      throw new Error(`CSV_PARSE_ERROR:${parsed.errors[0]?.message ?? "CSV parse error"}`);
    }

    const fields = parsed.meta.fields ?? [];
    const missingHeaders = requiredHeaders.filter((header) => !fields.includes(header));

    if (missingHeaders.length > 0) {
      throw new Error(`CSV_PARSE_ERROR:必須ヘッダが不足しています (${missingHeaders.join(", ")})`);
    }

    return parsed.data.map((row, index) => {
      const rowNo = index + 2;
      const janCode = normalizeJanCode(row["JANコード"]);
      const quantity = Number(row["数量"] ?? "0");
      const transactionDate = (row["取引日"] ?? "").trim();

      if (!janCode) {
        throw new Error(`CSV_VALIDATION_ERROR:${rowNo}行目のJANコードが不正です`);
      }

      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new Error(`CSV_VALIDATION_ERROR:${rowNo}行目の数量が不正です`);
      }

      if (!isDateOnly(transactionDate)) {
        throw new Error(`CSV_VALIDATION_ERROR:${rowNo}行目の取引日が不正です`);
      }

      return {
        rowNo,
        janCode,
        productName: (row["商品名"] ?? "").trim(),
        quantity,
        transactionDate,
        transactionId: (row["取引ID"] ?? "").trim(),
        rawRow: row,
      };
    });
  }
}

export const defaultCsvParser = new GenericPosCsvParser();

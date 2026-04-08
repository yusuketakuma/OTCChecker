"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { FormLabel } from "@/components/ui/form-label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { fetchJson, putJson } from "@/lib/client";
import { parsePositiveIntegerInput, positiveIntegerInputProps } from "@/lib/mobile-input";
import {
  clearStoredReceiptDefaults,
  readStoredReceiptDefaults,
  writeStoredReceiptDefaults,
} from "@/lib/receipt-defaults";
import { addDaysToDateKey, todayJstKey } from "@/lib/date";
import { cn, formatQuantity } from "@/lib/utils";

type PreviewResponse = {
  previewId: string;
  rows: Array<{
    rowNo: number;
    janCode: string;
    productName: string;
    quantity: number;
    transactionDate: string;
    transactionId: string;
    status: "MATCHED" | "UNMATCHED" | "INSUFFICIENT_STOCK" | "DUPLICATE";
    reason?: string;
    appliedQuantity: number;
    remainingQuantity: number;
    matchedProductName?: string;
  }>;
  meta: {
    rowCount: number;
    matchedCount: number;
    unmatchedCount: number;
    duplicateCount: number;
  };
};

type UnmatchedReason = "NO_PRODUCT" | "INSUFFICIENT_STOCK" | "DUPLICATE_ROW" | "MANUAL_RESOLUTION";

type UnmatchedRow = {
  id: string;
  rawProductName: string;
  janCode: string | null;
  remainingQuantity: number;
  requestedQuantity: number;
  appliedQuantity: number;
  reason: UnmatchedReason;
  sourceRowNo: number | null;
  transactionDate: string | null;
  resolutionNote: string | null;
  matchedProduct: {
    id: string;
    name: string;
    spec: string;
    janCode: string;
  } | null;
};

type BulkResolveResponse = {
  results: Array<{
    unmatchedId: string;
    status: "resolved" | "failed";
    error?: string;
  }>;
  completedCount: number;
  failedCount: number;
};

const previewTone = {
  MATCHED: "success",
  UNMATCHED: "warning",
  INSUFFICIENT_STOCK: "warning",
  DUPLICATE: "neutral",
} as const;

const previewLabel = {
  MATCHED: "MATCHED",
  UNMATCHED: "UNMATCHED",
  INSUFFICIENT_STOCK: "INSUFFICIENT",
  DUPLICATE: "DUPLICATE",
} as const;

const unmatchedReasonOptions = [
  { key: "all", label: "全件" },
  { key: "NO_PRODUCT", label: "商品未一致" },
  { key: "INSUFFICIENT_STOCK", label: "在庫不足" },
  { key: "DUPLICATE_ROW", label: "重複行" },
] as const;

const receiptExpiryPresets = [
  { label: "今日", days: 0 },
  { label: "+30日", days: 30 },
  { label: "+90日", days: 90 },
  { label: "+180日", days: 180 },
] as const;

const quantityPresets = [1, 3, 5, 10] as const;

type RowValidation = {
  canMarkResolved: boolean;
  canReceiveAndApply: boolean;
  missingNote: boolean;
  missingExpiry: boolean;
  invalidQuantity: boolean;
  missingProductName: boolean;
  missingSpec: boolean;
};

function validateUnmatchedRow(
  row: UnmatchedRow,
  note: string | undefined,
  expiryDate: string | undefined,
  receiptQuantityRaw: string | undefined,
  productName: string | undefined,
  spec: string | undefined,
): RowValidation {
  const trimmedNote = note?.trim();
  const trimmedExpiry = expiryDate?.trim();
  const parsedQty = parsePositiveIntegerInput(receiptQuantityRaw ?? "");
  const trimmedProductName = productName?.trim();
  const trimmedSpec = spec?.trim();

  const missingNote = !trimmedNote;
  const missingExpiry = !trimmedExpiry;
  const invalidQuantity = parsedQty === null;
  const needsProduct = !row.matchedProduct;
  const missingProductName = needsProduct && !trimmedProductName;
  const missingSpec = needsProduct && !trimmedSpec;

  return {
    canMarkResolved: !missingNote,
    canReceiveAndApply:
      !missingNote && !missingExpiry && !invalidQuantity && !missingProductName && !missingSpec,
    missingNote,
    missingExpiry,
    invalidQuantity,
    missingProductName,
    missingSpec,
  };
}

function ValidationHint({ show, children }: { show: boolean; children: React.ReactNode }) {
  if (!show) {
    return null;
  }

  return <p className="text-xs text-[var(--color-danger)]">{children}</p>;
}

function invalidFieldClass(invalid: boolean) {
  return invalid
    ? "border-[var(--color-danger)] focus:border-[var(--color-danger)] focus:ring-[var(--color-danger)]/20"
    : undefined;
}

function summarizePreview(rows: PreviewResponse["rows"]) {
  return rows.reduce(
    (summary, row) => {
      summary.total += 1;

      if (row.status === "MATCHED") {
        summary.matched += 1;
      }

      if (row.status === "UNMATCHED") {
        summary.unmatched += 1;
      }

      if (row.status === "INSUFFICIENT_STOCK") {
        summary.insufficientStock += 1;
      }

      if (row.status === "DUPLICATE") {
        summary.duplicate += 1;
      }

      return summary;
    },
    {
      total: 0,
      matched: 0,
      unmatched: 0,
      insufficientStock: 0,
      duplicate: 0,
    },
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
      {children}
    </p>
  );
}

export default function ImportPage() {
  const isOnline = useOnlineStatus();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const unmatchedSectionRef = useRef<HTMLElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [unmatched, setUnmatched] = useState<UnmatchedRow[]>([]);
  const [resolutionDrafts, setResolutionDrafts] = useState<Record<string, string>>({});
  const [receiptQuantityDrafts, setReceiptQuantityDrafts] = useState<Record<string, string>>({});
  const [expiryDateDrafts, setExpiryDateDrafts] = useState<Record<string, string>>({});
  const [productNameDrafts, setProductNameDrafts] = useState<Record<string, string>>({});
  const [specDrafts, setSpecDrafts] = useState<Record<string, string>>({});
  const [previewing, setPreviewing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [bulkResolvingAction, setBulkResolvingAction] = useState<"MARK_RESOLVED" | "RECEIVE_AND_APPLY" | null>(null);
  const [unmatchedQuery, setUnmatchedQuery] = useState("");
  const [unmatchedReasonFilter, setUnmatchedReasonFilter] = useState<(typeof unmatchedReasonOptions)[number]["key"]>("all");
  const [bulkResolutionNote, setBulkResolutionNote] = useState("確認済み");
  const [bulkExpiryDate, setBulkExpiryDate] = useState("");
  const [bulkReceiptQuantity, setBulkReceiptQuantity] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const previewSummary = preview ? summarizePreview(preview.rows) : null;
  const rowValidations = useMemo(() => {
    const map: Record<string, RowValidation> = {};

    for (const row of unmatched) {
      map[row.id] = validateUnmatchedRow(
        row,
        resolutionDrafts[row.id],
        expiryDateDrafts[row.id],
        receiptQuantityDrafts[row.id],
        productNameDrafts[row.id],
        specDrafts[row.id],
      );
    }

    return map;
  }, [unmatched, resolutionDrafts, expiryDateDrafts, receiptQuantityDrafts, productNameDrafts, specDrafts]);

  const filteredUnmatched = useMemo(() => {
    const query = unmatchedQuery.trim().toLowerCase();

    return unmatched.filter((row) => {
      if (unmatchedReasonFilter !== "all" && row.reason !== unmatchedReasonFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [
        row.rawProductName,
        row.janCode,
        row.reason,
        row.matchedProduct?.name,
        row.matchedProduct?.spec,
        row.matchedProduct?.janCode,
      ]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(query));
    });
  }, [unmatched, unmatchedQuery, unmatchedReasonFilter]);
  const bulkResolvableRows = useMemo(
    () => filteredUnmatched.filter((row) => rowValidations[row.id]?.canMarkResolved),
    [filteredUnmatched, rowValidations],
  );
  const bulkReceivableRows = useMemo(
    () =>
      filteredUnmatched.filter(
        (row) => row.reason !== "DUPLICATE_ROW" && rowValidations[row.id]?.canReceiveAndApply,
      ),
    [filteredUnmatched, rowValidations],
  );

  useEffect(() => {
    const parsedBulkQuantity = parsePositiveIntegerInput(bulkReceiptQuantity);
    writeStoredReceiptDefaults(bulkExpiryDate, parsedBulkQuantity ?? 1);
  }, [bulkExpiryDate, bulkReceiptQuantity]);

  function scrollToUnmatchedSection() {
    unmatchedSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function clearSelectedFile() {
    setFile(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function clearBulkReceiptDefaults() {
    setBulkExpiryDate("");
    setBulkReceiptQuantity("1");
    clearStoredReceiptDefaults();
    setMessage("一括入荷条件の保持をクリアしました。");
    setError("");
  }

  function applyUnmatchedRows(rows: UnmatchedRow[]) {
    const storedDefaults = readStoredReceiptDefaults();

    setUnmatched(rows);
    setBulkExpiryDate(storedDefaults.expiryDate);
    setBulkReceiptQuantity(String(storedDefaults.quantity));
    setResolutionDrafts(
      Object.fromEntries(rows.map((row) => [row.id, row.resolutionNote ?? "確認済み"])),
    );
    setReceiptQuantityDrafts(
      Object.fromEntries(rows.map((row) => [row.id, String(row.remainingQuantity)])),
    );
    setExpiryDateDrafts(
      Object.fromEntries(
        rows.map((row) => [row.id, storedDefaults.expiryDate]),
      ),
    );
    setProductNameDrafts(
      Object.fromEntries(
        rows.map((row) => [row.id, row.matchedProduct?.name ?? row.rawProductName ?? ""]),
      ),
    );
    setSpecDrafts(
      Object.fromEntries(rows.map((row) => [row.id, row.matchedProduct?.spec ?? ""])),
    );
  }

  const loadUnmatched = useCallback(async () => {
    const rows = await fetchJson<UnmatchedRow[]>("/api/unmatched");
    applyUnmatchedRows(rows);
  }, []);

  useEffect(() => {
    loadUnmatched().catch(() => undefined);
  }, [loadUnmatched]);

  useEffect(() => {
    if (typeof window === "undefined" || window.location.hash !== "#unmatched-list") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      scrollToUnmatchedSection();
    }, 100);

    return () => window.clearTimeout(timeoutId);
  }, [unmatched.length]);

  async function previewFile() {
    if (!file) {
      return;
    }

    setPreviewing(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/import/preview", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "CSV プレビューに失敗しました");
        return;
      }

      setPreview(payload.data);
      setError("");
      setMessage("");
    } finally {
      setPreviewing(false);
    }
  }

  async function executeImport() {
    if (!preview) {
      return;
    }

    setExecuting(true);

    try {
      const response = await fetch("/api/import/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previewId: preview.previewId }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "CSV 実行に失敗しました");
        return;
      }

      setMessage("CSV 消し込みが完了しました。未割当があればこの下に表示します。");
      setPreview(null);
      clearSelectedFile();
      setError("");
      await loadUnmatched();
      scrollToUnmatchedSection();
    } finally {
      setExecuting(false);
    }
  }

  function applyBulkDrafts() {
    if (!filteredUnmatched.length) {
      setError("一括適用できる未割当がありません。");
      setMessage("");
      return;
    }

    const nextNote = bulkResolutionNote;
    const nextExpiryDate = bulkExpiryDate;
    const parsedBulkQuantity = parsePositiveIntegerInput(bulkReceiptQuantity);

    setResolutionDrafts((current) => ({
      ...current,
      ...Object.fromEntries(filteredUnmatched.map((row) => [row.id, nextNote])),
    }));

    if (nextExpiryDate) {
      setExpiryDateDrafts((current) => ({
        ...current,
        ...Object.fromEntries(filteredUnmatched.map((row) => [row.id, nextExpiryDate])),
      }));
    }

    if (parsedBulkQuantity !== null) {
      setReceiptQuantityDrafts((current) => ({
        ...current,
        ...Object.fromEntries(filteredUnmatched.map((row) => [row.id, String(parsedBulkQuantity)])),
      }));
    }

    setMessage(`表示中の未割当 ${filteredUnmatched.length} 件に入力内容を反映しました。`);
    setError("");
  }

  function applyRemainingQuantitiesToFilteredRows() {
    if (!filteredUnmatched.length) {
      setError("一括適用できる未割当がありません。");
      setMessage("");
      return;
    }

    setReceiptQuantityDrafts((current) => ({
      ...current,
      ...Object.fromEntries(
        filteredUnmatched.map((row) => [row.id, String(row.remainingQuantity)]),
      ),
    }));
    setMessage(`表示中の未割当 ${filteredUnmatched.length} 件へ残数をセットしました。`);
    setError("");
  }

  async function resolveUnmatched(row: UnmatchedRow) {
    const note = resolutionDrafts[row.id]?.trim();

    if (!note) {
      setError("未割当を解決するには理由メモが必要です。");
      return;
    }

    setResolvingId(row.id);

    try {
      await putJson(`/api/unmatched/${row.id}/resolve`, {
        action: "MARK_RESOLVED",
        resolutionNote: note,
      });
      setMessage("未割当を解決済みにしました。");
      setError("");
      await loadUnmatched();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setResolvingId(null);
    }
  }

  async function receiveAndApply(row: UnmatchedRow) {
    const note = resolutionDrafts[row.id]?.trim();
    const expiryDate = expiryDateDrafts[row.id]?.trim();
    const receiptQuantity = parsePositiveIntegerInput(receiptQuantityDrafts[row.id] ?? "");
    const productName = productNameDrafts[row.id]?.trim();
    const spec = specDrafts[row.id]?.trim();

    if (!note) {
      setError("反映処理にも理由メモが必要です。");
      return;
    }

    if (!expiryDate) {
      setError("入荷して反映するには期限日が必要です。");
      return;
    }

    if (receiptQuantity === null) {
      setError("入荷数量は1以上で入力してください。");
      return;
    }

    if (!row.matchedProduct && (!productName || !spec)) {
      setError("商品作成には商品名と規格が必要です。");
      return;
    }

    setResolvingId(row.id);

    try {
      await putJson(`/api/unmatched/${row.id}/resolve`, {
        action: "RECEIVE_AND_APPLY",
        resolutionNote: note,
        expiryDate,
        receiptQuantity,
        productName: row.matchedProduct ? undefined : productName,
        spec: row.matchedProduct ? undefined : spec,
      });
      setMessage("未割当を在庫へ反映しました。");
      setError("");
      await loadUnmatched();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setResolvingId(null);
    }
  }

  async function resolveFilteredRows(action: "MARK_RESOLVED" | "RECEIVE_AND_APPLY") {
    const targetRows = action === "MARK_RESOLVED" ? bulkResolvableRows : bulkReceivableRows;

    if (!targetRows.length) {
      setError(
        action === "MARK_RESOLVED"
          ? "一括解決できる未割当がありません。"
          : "一括反映できる未割当がありません。",
      );
      setMessage("");
      return;
    }

    setBulkResolvingAction(action);
    setError("");
    setMessage("");

    try {
      const response = await fetchJson<BulkResolveResponse>("/api/unmatched/bulk-resolve", {
        method: "POST",
        body: JSON.stringify({
          entries: targetRows.map((row) => ({
            unmatchedId: row.id,
            payload:
              action === "MARK_RESOLVED"
                ? {
                    action,
                    resolutionNote: resolutionDrafts[row.id]?.trim(),
                  }
                : {
                    action,
                    resolutionNote: resolutionDrafts[row.id]?.trim(),
                    expiryDate: expiryDateDrafts[row.id]?.trim(),
                    receiptQuantity: parsePositiveIntegerInput(receiptQuantityDrafts[row.id] ?? ""),
                    productName: row.matchedProduct ? undefined : productNameDrafts[row.id]?.trim(),
                    spec: row.matchedProduct ? undefined : specDrafts[row.id]?.trim(),
                  },
          })),
        }),
      });

      const firstFailure = response.results.find((result) => result.status === "failed")?.error ?? "";

      await loadUnmatched();
      setMessage(
        action === "MARK_RESOLVED"
          ? `表示中の未割当を ${response.completedCount} 件解決済みにしました。`
          : `表示中の未割当を ${response.completedCount} 件在庫へ反映しました。`,
      );
      setError(response.failedCount > 0 ? `${response.failedCount}件は処理できませんでした。${firstFailure}` : "");
    } finally {
      setBulkResolvingAction(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Import"
        title="CSV取込"
        description="POS CSV を選択してプレビューし、FIFO で在庫へ消し込みます。"
      />

      <Card className="space-y-4">
        <CardTitle>ファイル選択</CardTitle>
        <CardDescription>iPhone の「ファイル」アプリから CSV を選択できます。</CardDescription>
        <Input
          ref={fileInputRef}
          accept=".csv,text/csv"
          disabled={!isOnline}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          type="file"
        />
        {file ? (
          <div className="flex items-center justify-between gap-3 text-sm text-slate-500">
            <p>選択中: {file.name}</p>
            <button
              type="button"
              className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 transition active:scale-[0.99]"
              onClick={clearSelectedFile}
            >
              選択をクリア
            </button>
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Button className="flex-1" disabled={!isOnline || !file || previewing} onClick={previewFile}>
            {previewing ? "プレビュー中..." : "プレビュー"}
          </Button>
          <Button
            className="flex-1"
            disabled={!isOnline || !preview || executing}
            variant="secondary"
            onClick={executeImport}
          >
            {executing ? "実行中..." : "消し込み実行"}
          </Button>
        </div>
        {!isOnline ? (
          <p className="text-sm text-[var(--color-danger)]">
            オフライン中は CSV 取込を停止しています。接続回復後に再開してください。
          </p>
        ) : null}
        {message ? <p className="text-sm text-[var(--color-success)]">{message}</p> : null}
        {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
      </Card>

      {preview ? (
        <Card className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {[
              {
                label: "消し込み可能",
                description: "そのまま実行できる行",
                value: previewSummary?.matched ?? preview.meta.matchedCount,
                className: "bg-emerald-50 text-emerald-900",
                labelClassName: "text-emerald-700",
              },
              {
                label: "商品未一致",
                description: "商品マスタ未登録",
                value: previewSummary?.unmatched ?? 0,
                className: "bg-amber-50 text-amber-900",
                labelClassName: "text-amber-700",
              },
              {
                label: "在庫不足",
                description: "未割当対応が必要",
                value: previewSummary?.insufficientStock ?? 0,
                className: "bg-rose-50 text-rose-900",
                labelClassName: "text-rose-700",
              },
              {
                label: "重複行",
                description: "実行済みの取込行",
                value: previewSummary?.duplicate ?? preview.meta.duplicateCount,
                className: "bg-slate-100 text-slate-900",
                labelClassName: "text-slate-600",
              },
              {
                label: "対象行数",
                description: "CSV内の総行数",
                value: previewSummary?.total ?? preview.meta.rowCount,
                className: "bg-sky-50 text-sky-900 col-span-2 lg:col-span-1",
                labelClassName: "text-sky-700",
              },
            ].map((item) => (
              <div className={cn("rounded-2xl p-4", item.className)} key={item.label}>
                <p className={cn("text-xs font-medium", item.labelClassName)}>{item.label}</p>
                <p className="mt-1 text-2xl font-semibold">{formatQuantity(item.value)}</p>
                <p className="mt-1 text-xs text-current/70">{item.description}</p>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900">
            要対応 {formatQuantity(preview.meta.unmatchedCount)} 行
            <span className="ml-2 text-amber-800/80">
              商品未一致と在庫不足のみを集計し、重複行は含みません。
            </span>
          </div>
          <div className="space-y-3">
            {preview.rows.map((row) => (
              <div className="rounded-2xl border border-slate-100 p-4" key={`${row.rowNo}-${row.transactionId}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-[var(--color-text)]">
                      {row.productName || row.matchedProductName || "名称なし"}
                    </p>
                    <p className="text-sm text-slate-500">
                      {row.rowNo}行目 / JAN {row.janCode} / 数量 {row.quantity}
                    </p>
                  </div>
                  <Badge tone={previewTone[row.status]}>
                    {previewLabel[row.status]}
                  </Badge>
                </div>
                <div className="mt-3 grid gap-2 text-sm text-slate-600 grid-cols-1 sm:grid-cols-3">
                  <p>取引日: {row.transactionDate || "-"}</p>
                  <p>引当: {row.appliedQuantity}</p>
                  <p>残数: {row.remainingQuantity}</p>
                </div>
                {row.reason ? <p className="mt-2 text-sm text-slate-600">{row.reason}</p> : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <section className="scroll-mt-24 space-y-3" id="unmatched-list" ref={unmatchedSectionRef}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-[var(--color-text)]">未割当一覧</h2>
          <Badge tone="neutral">{filteredUnmatched.length}/{unmatched.length}件</Badge>
        </div>
        {!unmatched.length ? (
          <EmptyState title="未割当はありません" description="NO_PRODUCT と INSUFFICIENT_STOCK がここに出ます。" />
        ) : (
          <>
            <Card className="space-y-4">
              <Input
                value={unmatchedQuery}
                onChange={(event) => setUnmatchedQuery(event.target.value)}
                placeholder="商品名・JAN・理由で検索"
              />
              <div className="flex flex-wrap gap-2">
                {unmatchedReasonOptions.map((option) => (
                  <button
                    className={`rounded-full px-4 py-2 text-sm font-medium ${
                      unmatchedReasonFilter === option.key
                        ? "bg-[var(--color-brand)] text-white"
                        : "bg-slate-100 text-slate-600"
                    }`}
                    key={option.key}
                    onClick={() => setUnmatchedReasonFilter(option.key)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="space-y-3 rounded-2xl bg-slate-50/90 p-3">
                <FieldLabel>表示中の未割当に一括入力</FieldLabel>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-2 rounded-2xl border border-[var(--color-brand-soft)] bg-white/80 p-3">
                    <div className="space-y-1">
                      <FormLabel htmlFor="bulk-resolution-note">一括解決メモ</FormLabel>
                      <p className="text-xs text-slate-500">表示中の未割当に共通で反映します。</p>
                    </div>
                    <Input
                      aria-label="一括解決メモ"
                      id="bulk-resolution-note"
                      disabled={!isOnline}
                      value={bulkResolutionNote}
                      onChange={(event) => setBulkResolutionNote(event.target.value)}
                      placeholder="例: 棚卸確認済み"
                    />
                  </div>
                  <div className="space-y-2">
                    <FormLabel htmlFor="bulk-expiry-date">一括期限日</FormLabel>
                    <Input
                      id="bulk-expiry-date"
                      disabled={!isOnline}
                      type="date"
                      value={bulkExpiryDate}
                      onChange={(event) => setBulkExpiryDate(event.target.value)}
                    />
                    <div className="flex flex-wrap gap-2">
                      {receiptExpiryPresets.map((preset) => (
                        <button
                          key={`bulk-${preset.label}`}
                          type="button"
                          disabled={!isOnline}
                          className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
                          onClick={() => setBulkExpiryDate(addDaysToDateKey(todayJstKey(), preset.days))}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <FormLabel htmlFor="bulk-receipt-quantity">一括入荷数量</FormLabel>
                    <Input
                      id="bulk-receipt-quantity"
                      disabled={!isOnline}
                      {...positiveIntegerInputProps}
                      enterKeyHint="done"
                      value={bulkReceiptQuantity}
                      onChange={(event) => setBulkReceiptQuantity(event.target.value)}
                      placeholder="例: 3"
                    />
                    <div className="flex flex-wrap gap-2">
                      {quantityPresets.map((preset) => (
                        <button
                          key={`bulk-qty-${preset}`}
                          type="button"
                          disabled={!isOnline}
                          className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
                          onClick={() => setBulkReceiptQuantity(String(preset))}
                        >
                          {preset}個
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                {(bulkExpiryDate || (parsePositiveIntegerInput(bulkReceiptQuantity) ?? 1) > 1) ? (
                  <div className="rounded-2xl bg-emerald-50/80 p-3 text-sm text-emerald-900">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">前回の入荷条件を保持中</p>
                        <p className="mt-1">
                          期限日 {bulkExpiryDate || "未設定"} / 数量 {parsePositiveIntegerInput(bulkReceiptQuantity) ?? 1}個
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={!isOnline}
                        className="rounded-full bg-white/80 px-3 py-1.5 text-xs font-medium text-emerald-900 ring-1 ring-emerald-200 disabled:opacity-50"
                        onClick={clearBulkReceiptDefaults}
                      >
                        保持をクリア
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                  <p>検索や理由フィルタで表示中の行だけに反映します。</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={!isOnline || !filteredUnmatched.length || bulkResolvingAction !== null}
                      variant="secondary"
                      onClick={applyRemainingQuantitiesToFilteredRows}
                    >
                      残数を一括セット
                    </Button>
                    <Button
                      disabled={!isOnline || !filteredUnmatched.length || bulkResolvingAction !== null}
                      variant="secondary"
                      onClick={applyBulkDrafts}
                    >
                      表示中に一括入力
                    </Button>
                    <Button
                      disabled={!isOnline || !bulkReceivableRows.length || bulkResolvingAction !== null}
                      onClick={() => resolveFilteredRows("RECEIVE_AND_APPLY")}
                    >
                      {bulkResolvingAction === "RECEIVE_AND_APPLY"
                        ? "一括反映中..."
                        : `表示中を一括反映 (${bulkReceivableRows.length})`}
                    </Button>
                    <Button
                      disabled={!isOnline || !bulkResolvableRows.length || bulkResolvingAction !== null}
                      variant="secondary"
                      onClick={() => resolveFilteredRows("MARK_RESOLVED")}
                    >
                      {bulkResolvingAction === "MARK_RESOLVED"
                        ? "一括解決中..."
                        : `メモのみで一括解決 (${bulkResolvableRows.length})`}
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
            {!filteredUnmatched.length ? (
              <EmptyState title="条件に合う未割当がありません" description="検索語やフィルタを変更してください。" />
            ) : (
              <div className="space-y-3">
                {filteredUnmatched.map((row) => {
                  const validation = rowValidations[row.id];
                  const isResolving = resolvingId === row.id;
                  const resolutionNoteId = `resolution-note-${row.id}`;
                  const resolutionNoteLabel = `${row.rawProductName || "未割当行"}の解決メモ`;

                  return (
                    <Card className="space-y-3" key={row.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-sm">{row.rawProductName || "名称なし"}</CardTitle>
                          <CardDescription>
                            JAN {row.janCode ?? "-"} / 行 {row.sourceRowNo ?? "-"} / 取引日 {row.transactionDate ?? "-"}
                          </CardDescription>
                        </div>
                        <Badge tone={row.reason === "NO_PRODUCT" ? "warning" : "neutral"}>{row.reason}</Badge>
                      </div>
                      <div className="grid gap-2 text-sm text-slate-600 grid-cols-1 sm:grid-cols-3">
                        <p>要求数: {row.requestedQuantity}</p>
                        <p>適用数: {row.appliedQuantity}</p>
                        <p>残数: {row.remainingQuantity}</p>
                      </div>
                      {row.matchedProduct ? (
                        <div className="space-y-3 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-900">
                          <div>
                            <p className="font-medium">既存商品候補</p>
                            <p className="mt-1">
                              {row.matchedProduct.name} / {row.matchedProduct.spec}
                            </p>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-3">
                            <Link
                              className="inline-flex h-11 w-full items-center justify-center rounded-full bg-white/90 px-4 py-3 text-sm font-semibold text-emerald-900 ring-1 ring-emerald-200 transition active:scale-[0.99]"
                              href={`/inventory/${row.matchedProduct.id}`}
                            >
                              在庫詳細
                            </Link>
                            <Link
                              className="inline-flex h-11 w-full items-center justify-center rounded-full bg-white/90 px-4 py-3 text-sm font-semibold text-emerald-900 ring-1 ring-emerald-200 transition active:scale-[0.99]"
                              href={`/inventory/${row.matchedProduct.id}#manual-receipt`}
                            >
                              手動入荷
                            </Link>
                            <Link
                              className="inline-flex h-11 w-full items-center justify-center rounded-full bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.99]"
                              href={`/scan?jan=${encodeURIComponent(row.matchedProduct.janCode)}&name=${encodeURIComponent(row.matchedProduct.name)}&spec=${encodeURIComponent(row.matchedProduct.spec)}&quantity=${encodeURIComponent(String(row.remainingQuantity))}`}
                            >
                              スキャン入荷
                            </Link>
                          </div>
                        </div>
                      ) : (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Link
                            className="inline-flex h-11 w-full items-center justify-center rounded-full bg-white/90 px-4 py-3 text-sm font-semibold text-[var(--color-text)] ring-1 ring-slate-200 transition active:scale-[0.99]"
                            href={`/products?q=${encodeURIComponent(row.janCode ?? row.rawProductName)}`}
                          >
                            商品管理で探す
                          </Link>
                          <Link
                            className="inline-flex h-11 w-full items-center justify-center rounded-full bg-[var(--color-brand)] px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.99]"
                            href={`/scan?jan=${encodeURIComponent(row.janCode ?? "")}&name=${encodeURIComponent(row.rawProductName ?? "")}&quantity=${encodeURIComponent(String(row.remainingQuantity))}`}
                          >
                            新規商品として登録
                          </Link>
                        </div>
                      )}
                      {row.reason !== "DUPLICATE_ROW" ? (
                        <div className="space-y-3">
                          {!row.matchedProduct ? (
                            <div className="space-y-3 rounded-2xl bg-slate-50/90 p-3">
                              <FieldLabel>商品マスタ作成</FieldLabel>
                              <div className="space-y-1">
                                <Input
                                  aria-invalid={validation?.missingProductName || undefined}
                                  className={invalidFieldClass(validation?.missingProductName ?? false)}
                                  disabled={!isOnline}
                                  value={productNameDrafts[row.id] ?? ""}
                                  onChange={(event) =>
                                    setProductNameDrafts((current) => ({
                                      ...current,
                                      [row.id]: event.target.value,
                                    }))
                                  }
                                  placeholder="商品名"
                                />
                                <ValidationHint show={validation?.missingProductName ?? false}>
                                  商品名を入力してください
                                </ValidationHint>
                              </div>
                              <div className="space-y-1">
                                <Input
                                  aria-invalid={validation?.missingSpec || undefined}
                                  className={invalidFieldClass(validation?.missingSpec ?? false)}
                                  disabled={!isOnline}
                                  value={specDrafts[row.id] ?? ""}
                                  onChange={(event) =>
                                    setSpecDrafts((current) => ({
                                      ...current,
                                      [row.id]: event.target.value,
                                    }))
                                  }
                                  placeholder="規格"
                                />
                                <ValidationHint show={validation?.missingSpec ?? false}>
                                  規格を入力してください
                                </ValidationHint>
                              </div>
                            </div>
                          ) : null}
                          <div className="space-y-3 rounded-2xl bg-slate-50/90 p-3">
                            <FieldLabel>不足分を入荷して反映</FieldLabel>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="space-y-2">
                                <FieldLabel>期限日</FieldLabel>
                                <Input
                                  aria-invalid={validation?.missingExpiry || undefined}
                                  className={invalidFieldClass(validation?.missingExpiry ?? false)}
                                  disabled={!isOnline}
                                  type="date"
                                  value={expiryDateDrafts[row.id] ?? ""}
                                  onChange={(event) =>
                                    setExpiryDateDrafts((current) => ({
                                      ...current,
                                      [row.id]: event.target.value,
                                    }))
                                  }
                                />
                                <div className="flex flex-wrap gap-2">
                                  {receiptExpiryPresets.map((preset) => (
                                    <button
                                      key={`${row.id}-${preset.label}`}
                                      type="button"
                                      disabled={!isOnline}
                                      className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
                                      onClick={() =>
                                        setExpiryDateDrafts((current) => ({
                                          ...current,
                                          [row.id]: addDaysToDateKey(todayJstKey(), preset.days),
                                        }))
                                      }
                                    >
                                      {preset.label}
                                    </button>
                                  ))}
                                </div>
                                <ValidationHint show={validation?.missingExpiry ?? false}>
                                  期限日を入力してください
                                </ValidationHint>
                              </div>
                              <div className="space-y-2">
                                <FieldLabel>入荷数量</FieldLabel>
                                <Input
                                  aria-invalid={validation?.invalidQuantity || undefined}
                                  className={invalidFieldClass(validation?.invalidQuantity ?? false)}
                                  disabled={!isOnline}
                                  {...positiveIntegerInputProps}
                                  enterKeyHint="done"
                                  value={receiptQuantityDrafts[row.id] ?? String(row.remainingQuantity)}
                                  onChange={(event) =>
                                    setReceiptQuantityDrafts((current) => ({
                                      ...current,
                                      [row.id]: event.target.value,
                                    }))
                                  }
                                />
                                <div className="flex flex-wrap gap-2">
                                  {quantityPresets.map((preset) => (
                                    <button
                                      key={`${row.id}-qty-${preset}`}
                                      type="button"
                                      disabled={!isOnline}
                                      className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
                                      onClick={() =>
                                        setReceiptQuantityDrafts((current) => ({
                                          ...current,
                                          [row.id]: String(preset),
                                        }))
                                      }
                                    >
                                      {preset}個
                                    </button>
                                  ))}
                                  <button
                                    type="button"
                                    disabled={!isOnline}
                                    className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
                                    onClick={() =>
                                      setReceiptQuantityDrafts((current) => ({
                                        ...current,
                                        [row.id]: String(row.remainingQuantity),
                                      }))
                                    }
                                  >
                                    残数をセット
                                  </button>
                                </div>
                                <ValidationHint show={validation?.invalidQuantity ?? false}>
                                  入荷数量は1以上で入力してください
                                </ValidationHint>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}
                      <div className="space-y-2">
                        <FormLabel htmlFor={resolutionNoteId}>{resolutionNoteLabel}</FormLabel>
                        <Textarea
                          aria-label={resolutionNoteLabel}
                          aria-invalid={validation?.missingNote || undefined}
                          className={invalidFieldClass(validation?.missingNote ?? false)}
                          id={resolutionNoteId}
                          value={resolutionDrafts[row.id] ?? ""}
                          onChange={(event) =>
                            setResolutionDrafts((current) => ({
                              ...current,
                              [row.id]: event.target.value,
                            }))
                          }
                          placeholder="この行の対応メモ"
                        />
                        <ValidationHint show={validation?.missingNote ?? false}>
                          解決メモを入力してください
                        </ValidationHint>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {row.reason !== "DUPLICATE_ROW" ? (
                          <Button
                            className="w-full"
                            disabled={!isOnline || isResolving || !(validation?.canReceiveAndApply ?? false)}
                            onClick={() => receiveAndApply(row)}
                          >
                            {isResolving
                              ? "反映中..."
                              : row.matchedProduct
                                ? "入荷して売上反映"
                                : "商品作成して売上反映"}
                          </Button>
                        ) : null}
                        <Button
                          className="w-full"
                          disabled={!isOnline || isResolving || !(validation?.canMarkResolved ?? false)}
                          variant="secondary"
                          onClick={() => resolveUnmatched(row)}
                        >
                          {isResolving ? "更新中..." : "メモのみで解決"}
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

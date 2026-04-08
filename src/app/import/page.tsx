"use client";

import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { fetchJson, putJson } from "@/lib/client";
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
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [unmatched, setUnmatched] = useState<UnmatchedRow[]>([]);
  const [resolutionDrafts, setResolutionDrafts] = useState<Record<string, string>>({});
  const [receiptQuantityDrafts, setReceiptQuantityDrafts] = useState<Record<string, number>>({});
  const [expiryDateDrafts, setExpiryDateDrafts] = useState<Record<string, string>>({});
  const [productNameDrafts, setProductNameDrafts] = useState<Record<string, string>>({});
  const [specDrafts, setSpecDrafts] = useState<Record<string, string>>({});
  const [previewing, setPreviewing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [unmatchedQuery, setUnmatchedQuery] = useState("");
  const [unmatchedReasonFilter, setUnmatchedReasonFilter] = useState<(typeof unmatchedReasonOptions)[number]["key"]>("all");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const previewSummary = preview ? summarizePreview(preview.rows) : null;
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

  function applyUnmatchedRows(rows: UnmatchedRow[]) {
    setUnmatched(rows);
    setResolutionDrafts(
      Object.fromEntries(rows.map((row) => [row.id, row.resolutionNote ?? "確認済み"])),
    );
    setReceiptQuantityDrafts(
      Object.fromEntries(rows.map((row) => [row.id, row.remainingQuantity])),
    );
    setExpiryDateDrafts(
      Object.fromEntries(rows.map((row) => [row.id, ""])),
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

  async function loadUnmatched() {
    const rows = await fetchJson<UnmatchedRow[]>("/api/unmatched");
    applyUnmatchedRows(rows);
  }

  useEffect(() => {
    fetchJson<UnmatchedRow[]>("/api/unmatched")
      .then(applyUnmatchedRows)
      .catch(() => undefined);
  }, [message]);

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

      setMessage("CSV 消し込みが完了しました。");
      setPreview(null);
      setFile(null);
      setError("");
      await loadUnmatched();
    } finally {
      setExecuting(false);
    }
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
    const receiptQuantity = receiptQuantityDrafts[row.id] ?? 0;
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

    if (receiptQuantity <= 0) {
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
          accept=".csv,text/csv"
          disabled={!isOnline}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          type="file"
        />
        {file ? (
          <p className="text-sm text-slate-500">
            選択中: {file.name}
          </p>
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

      <section className="space-y-3">
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
            </Card>
            {!filteredUnmatched.length ? (
              <EmptyState title="条件に合う未割当がありません" description="検索語やフィルタを変更してください。" />
            ) : (
              <div className="space-y-3">
                {filteredUnmatched.map((row) => (
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
                  <div className="rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-900">
                    <p className="font-medium">既存商品候補</p>
                    <p className="mt-1">
                      {row.matchedProduct.name} / {row.matchedProduct.spec}
                    </p>
                  </div>
                ) : null}
                {row.reason !== "DUPLICATE_ROW" ? (
                  <div className="space-y-3">
                    {!row.matchedProduct ? (
                      <div className="space-y-3 rounded-2xl bg-slate-50/90 p-3">
                        <FieldLabel>商品マスタ作成</FieldLabel>
                        <Input
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
                        <Input
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
                      </div>
                    ) : null}
                    <div className="space-y-3 rounded-2xl bg-slate-50/90 p-3">
                      <FieldLabel>不足分を入荷して反映</FieldLabel>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                          <FieldLabel>期限日</FieldLabel>
                          <Input
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
                        </div>
                        <div className="space-y-2">
                          <FieldLabel>入荷数量</FieldLabel>
                          <Input
                            disabled={!isOnline}
                            min={1}
                            type="number"
                            value={receiptQuantityDrafts[row.id] ?? row.remainingQuantity}
                            onChange={(event) =>
                              setReceiptQuantityDrafts((current) => ({
                                ...current,
                                [row.id]: Math.max(1, Number(event.target.value)),
                              }))
                            }
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="space-y-2">
                  <FieldLabel>解決メモ</FieldLabel>
                  <Textarea
                    value={resolutionDrafts[row.id] ?? ""}
                    onChange={(event) =>
                      setResolutionDrafts((current) => ({
                        ...current,
                        [row.id]: event.target.value,
                      }))
                    }
                    placeholder="解決メモを入力"
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {row.reason !== "DUPLICATE_ROW" ? (
                    <Button
                      className="w-full"
                      disabled={!isOnline || resolvingId === row.id}
                      onClick={() => receiveAndApply(row)}
                    >
                      {resolvingId === row.id
                        ? "反映中..."
                        : row.matchedProduct
                          ? "入荷して売上反映"
                          : "商品作成して売上反映"}
                    </Button>
                  ) : null}
                  <Button
                    className="w-full"
                    disabled={!isOnline || resolvingId === row.id}
                    variant="secondary"
                    onClick={() => resolveUnmatched(row)}
                  >
                    {resolvingId === row.id ? "更新中..." : "メモのみで解決"}
                  </Button>
                </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

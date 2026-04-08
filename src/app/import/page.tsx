"use client";

import { useEffect, useState } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { fetchJson, putJson } from "@/lib/client";

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

type UnmatchedRow = {
  id: string;
  rawProductName: string;
  janCode: string | null;
  remainingQuantity: number;
  requestedQuantity: number;
  appliedQuantity: number;
  reason: string;
  sourceRowNo: number | null;
  transactionDate: string | null;
  resolutionNote: string | null;
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

export default function ImportPage() {
  const isOnline = useOnlineStatus();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [unmatched, setUnmatched] = useState<UnmatchedRow[]>([]);
  const [resolutionDrafts, setResolutionDrafts] = useState<Record<string, string>>({});
  const [previewing, setPreviewing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadUnmatched() {
    const rows = await fetchJson<UnmatchedRow[]>("/api/unmatched");
    setUnmatched(rows);
    setResolutionDrafts(
      Object.fromEntries(rows.map((row) => [row.id, row.resolutionNote ?? "確認済み"])),
    );
  }

  useEffect(() => {
    fetchJson<UnmatchedRow[]>("/api/unmatched")
      .then((rows) => {
        setUnmatched(rows);
        setResolutionDrafts(
          Object.fromEntries(rows.map((row) => [row.id, row.resolutionNote ?? "確認済み"])),
        );
      })
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
        <div className="flex gap-3">
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
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-2xl bg-emerald-50 p-4">
              <p className="text-xs font-medium text-emerald-700">一致</p>
              <p className="mt-1 text-2xl font-semibold text-emerald-900">{preview.meta.matchedCount}</p>
            </div>
            <div className="rounded-2xl bg-amber-50 p-4">
              <p className="text-xs font-medium text-amber-700">要確認</p>
              <p className="mt-1 text-2xl font-semibold text-amber-900">{preview.meta.unmatchedCount}</p>
            </div>
            <div className="rounded-2xl bg-slate-100 p-4">
              <p className="text-xs font-medium text-slate-600">重複</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{preview.meta.duplicateCount}</p>
            </div>
            <div className="rounded-2xl bg-sky-50 p-4">
              <p className="text-xs font-medium text-sky-700">対象行数</p>
              <p className="mt-1 text-2xl font-semibold text-sky-900">{preview.meta.rowCount}</p>
            </div>
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
                <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
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
        <h2 className="text-lg font-semibold text-[var(--color-text)]">未割当一覧</h2>
        {!unmatched.length ? (
          <EmptyState title="未割当はありません" description="NO_PRODUCT と INSUFFICIENT_STOCK がここに出ます。" />
        ) : (
          <div className="space-y-3">
            {unmatched.map((row) => (
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
                <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
                  <p>要求数: {row.requestedQuantity}</p>
                  <p>適用数: {row.appliedQuantity}</p>
                  <p>残数: {row.remainingQuantity}</p>
                </div>
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
                <Button
                  disabled={!isOnline || resolvingId === row.id}
                  variant="secondary"
                  onClick={() => resolveUnmatched(row)}
                >
                  {resolvingId === row.id ? "更新中..." : "解決済みにする"}
                </Button>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

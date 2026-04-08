"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { fetchJson, postJson, putJson } from "@/lib/client";
import { formatDateLabel, formatDateTimeLabel, todayJstKey } from "@/lib/date";

type HistoryTab = "receipts" | "sales" | "disposals" | "adjustments";

type Lot = {
  id: string;
  expiryDate: string;
  quantity: number;
  initialQuantity: number;
  status: string;
  version: number;
  salesRecords: Array<{
    id: string;
    quantity: number;
    source: "CSV_IMPORT" | "MANUAL";
    transactionDate: string | null;
    createdAt: string;
  }>;
  disposalRecords: Array<{ id: string; quantity: number; reason: string; createdAt: string }>;
  adjustmentRecords: Array<{ id: string; delta: number; reason: string; createdAt: string }>;
  receiptRecords: Array<{ id: string; quantity: number; createdAt: string }>;
};

type ProductDetail = {
  id: string;
  name: string;
  spec: string;
  janCode: string;
  alertDays: number[];
  lots: Lot[];
};

const historyTabs: Array<{ key: HistoryTab; label: string }> = [
  { key: "receipts", label: "入荷" },
  { key: "sales", label: "売上" },
  { key: "disposals", label: "廃棄" },
  { key: "adjustments", label: "調整" },
];

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
      {children}
    </p>
  );
}

export default function InventoryDetailPage() {
  const params = useParams<{ productId: string }>();
  const productId = params.productId;
  const isOnline = useOnlineStatus();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [selling, setSelling] = useState(false);
  const [editName, setEditName] = useState("");
  const [editSpec, setEditSpec] = useState("");
  const [editAlertDays, setEditAlertDays] = useState("30,7,0");
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, number>>({});
  const [reasonDrafts, setReasonDrafts] = useState<Record<string, string>>({});
  const [adjustDrafts, setAdjustDrafts] = useState<Record<string, number>>({});
  const [adjustReasons, setAdjustReasons] = useState<Record<string, string>>({});
  const [disposeDrafts, setDisposeDrafts] = useState<Record<string, number>>({});
  const [disposeReasons, setDisposeReasons] = useState<Record<string, string>>({});
  const [receiptExpiryDate, setReceiptExpiryDate] = useState("");
  const [receiptQuantity, setReceiptQuantity] = useState(1);
  const [saleDate, setSaleDate] = useState(todayJstKey());
  const [saleQuantity, setSaleQuantity] = useState(1);
  const [historyTab, setHistoryTab] = useState<HistoryTab>("receipts");

  const load = useCallback(async () => {
    try {
      const detail = await fetchJson<ProductDetail>(`/api/products/${productId}`);
      setProduct(detail);
      setEditName(detail.name);
      setEditSpec(detail.spec);
      setEditAlertDays(detail.alertDays.join(","));
      setQtyDrafts(Object.fromEntries(detail.lots.map((lot) => [lot.id, lot.quantity])));
      setReasonDrafts(Object.fromEntries(detail.lots.map((lot) => [lot.id, "在庫修正"])));
      setAdjustDrafts(Object.fromEntries(detail.lots.map((lot) => [lot.id, 0])));
      setAdjustReasons(Object.fromEntries(detail.lots.map((lot) => [lot.id, "棚卸差異"])));
      setDisposeDrafts(Object.fromEntries(detail.lots.map((lot) => [lot.id, 0])));
      setDisposeReasons(
        Object.fromEntries(detail.lots.map((lot) => [lot.id, "期限近接による廃棄"])),
      );
      setReceiptExpiryDate(detail.lots[0]?.expiryDate.slice(0, 10) ?? "");
      setReceiptQuantity(1);
      setSaleDate(todayJstKey());
      setSaleQuantity(1);
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  const history = useMemo(() => {
    if (!product) {
      return {
        receipts: [],
        sales: [],
        disposals: [],
        adjustments: [],
      } as Record<
        HistoryTab,
        Array<{ id: string; lotId: string; date: string; detail: string }>
      >;
    }

    return {
      receipts: product.lots
        .flatMap((lot) =>
          lot.receiptRecords.map((item) => ({
            id: item.id,
            lotId: lot.id,
            date: item.createdAt,
            detail: `期限 ${formatDateLabel(lot.expiryDate)} / ${item.quantity}個`,
          })),
        )
        .sort((a, b) => b.date.localeCompare(a.date)),
      sales: product.lots
        .flatMap((lot) =>
          lot.salesRecords.map((item) => ({
            id: item.id,
            lotId: lot.id,
            date: item.createdAt,
            detail: `期限 ${formatDateLabel(lot.expiryDate)} / ${item.quantity}個 / ${item.source === "MANUAL" ? "手動売上" : "CSV"}${item.transactionDate ? ` / 売上日 ${formatDateLabel(item.transactionDate)}` : ""}`,
          })),
        )
        .sort((a, b) => b.date.localeCompare(a.date)),
      disposals: product.lots
        .flatMap((lot) =>
          lot.disposalRecords.map((item) => ({
            id: item.id,
            lotId: lot.id,
            date: item.createdAt,
            detail: `期限 ${formatDateLabel(lot.expiryDate)} / ${item.quantity}個 / ${item.reason}`,
          })),
        )
        .sort((a, b) => b.date.localeCompare(a.date)),
      adjustments: product.lots
        .flatMap((lot) =>
          lot.adjustmentRecords.map((item) => ({
            id: item.id,
            lotId: lot.id,
            date: item.createdAt,
            detail: `期限 ${formatDateLabel(lot.expiryDate)} / ${item.delta > 0 ? "+" : ""}${item.delta} / ${item.reason}`,
          })),
        )
        .sort((a, b) => b.date.localeCompare(a.date)),
    };
  }, [product]);

  async function saveProduct() {
    if (!product) {
      return;
    }

    setSaving(true);

    try {
      setError("");
      setMessage("");
      await putJson(`/api/products/${product.id}`, {
        name: editName,
        spec: editSpec,
        alertDays: editAlertDays
          .split(",")
          .map((item) => Number(item.trim()))
          .filter((item) => Number.isFinite(item)),
      });
      setMessage("商品マスタを更新しました。");
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function updateLot(lot: Lot) {
    try {
      setError("");
      setMessage("");
      await putJson(`/api/lots/${lot.id}`, {
        quantity: qtyDrafts[lot.id],
        reason: reasonDrafts[lot.id],
        version: lot.version,
      });
      setMessage("在庫数量を更新しました。");
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function disposeLot(lot: Lot) {
    try {
      setError("");
      setMessage("");
      await postJson(`/api/lots/${lot.id}/dispose`, {
        quantity: disposeDrafts[lot.id],
        reason: disposeReasons[lot.id],
        version: lot.version,
      });
      setMessage("廃棄を登録しました。");
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function adjustLot(lot: Lot) {
    try {
      setError("");
      setMessage("");
      await postJson(`/api/lots/${lot.id}/adjust`, {
        delta: adjustDrafts[lot.id],
        reason: adjustReasons[lot.id],
        version: lot.version,
      });
      setMessage("差分調整を登録しました。");
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function deleteLot(lot: Lot) {
    if (!window.confirm("このロットを削除しますか。履歴がある場合は削除できません。")) {
      return;
    }

    try {
      setError("");
      setMessage("");
      await fetchJson(`/api/lots/${lot.id}`, { method: "DELETE" });
      setMessage("ロットを削除しました。");
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function receiveStock() {
    if (!product || !receiptExpiryDate) {
      setError("入荷登録には期限日が必要です。");
      return;
    }

    try {
      setError("");
      setMessage("");
      await postJson("/api/lots", {
        productId: product.id,
        expiryDate: receiptExpiryDate,
        quantity: receiptQuantity,
      });
      setMessage("入荷を登録しました。");
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function recordManualSale() {
    if (!product) {
      return;
    }

    setSelling(true);

    try {
      setError("");
      setMessage("");
      await postJson(`/api/products/${product.id}/sales`, {
        quantity: saleQuantity,
        transactionDate: saleDate || undefined,
      });
      setMessage("手動売上を登録しました。");
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSelling(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Detail"
        title={product?.name ?? "在庫詳細"}
        description={product ? `${product.spec} / JAN ${product.janCode}` : "ロット詳細を取得中です。"}
      />

      {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
      {message ? <p className="text-sm text-[var(--color-success)]">{message}</p> : null}
      {!isOnline ? (
        <p className="text-sm text-[var(--color-danger)]">
          オフライン中は閲覧のみです。更新、売上、調整、廃棄、削除は接続回復後に行ってください。
        </p>
      ) : null}

      <Card className="space-y-4">
        <div className="space-y-3">
          <div className="space-y-2">
            <FieldLabel>商品名</FieldLabel>
            <Input disabled={!isOnline} value={editName} onChange={(event) => setEditName(event.target.value)} placeholder="商品名" />
          </div>
          <div className="space-y-2">
            <FieldLabel>規格</FieldLabel>
            <Input disabled={!isOnline} value={editSpec} onChange={(event) => setEditSpec(event.target.value)} placeholder="規格" />
          </div>
          <div className="space-y-2">
            <FieldLabel>アラート日数</FieldLabel>
            <Input
              disabled={!isOnline}
              value={editAlertDays}
              onChange={(event) => setEditAlertDays(event.target.value)}
              placeholder="30,7,0"
            />
          </div>
        </div>
        <Button className="w-full" disabled={!isOnline || saving} onClick={saveProduct}>
          商品マスタを更新
        </Button>
      </Card>

      <Card className="space-y-4">
        <CardTitle>手動入荷登録</CardTitle>
        <CardDescription>バーコードが使えない場合も、この商品へ直接入荷を追加できます。</CardDescription>
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <div className="space-y-2">
            <FieldLabel>期限日</FieldLabel>
            <Input
              disabled={!isOnline}
              type="date"
              value={receiptExpiryDate}
              onChange={(event) => setReceiptExpiryDate(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <FieldLabel>数量</FieldLabel>
            <Input
              disabled={!isOnline}
              type="number"
              min={1}
              value={receiptQuantity}
              onChange={(event) => setReceiptQuantity(Math.max(1, Number(event.target.value)))}
            />
          </div>
          <Button className="w-full sm:col-span-2" disabled={!isOnline || !receiptExpiryDate} onClick={receiveStock}>
            入荷登録
          </Button>
        </div>
      </Card>

      <Card className="space-y-4">
        <CardTitle>手動売上登録</CardTitle>
        <CardDescription>CSV を待たずに、その場の販売や補正売上を FIFO で反映します。</CardDescription>
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <div className="space-y-2">
            <FieldLabel>売上日</FieldLabel>
            <Input
              disabled={!isOnline}
              type="date"
              value={saleDate}
              onChange={(event) => setSaleDate(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <FieldLabel>数量</FieldLabel>
            <Input
              disabled={!isOnline}
              type="number"
              min={1}
              value={saleQuantity}
              onChange={(event) => setSaleQuantity(Math.max(1, Number(event.target.value)))}
            />
          </div>
          <Button className="w-full sm:col-span-2" disabled={!isOnline || !saleDate || selling} variant="secondary" onClick={recordManualSale}>
            {selling ? "登録中..." : "売上登録"}
          </Button>
        </div>
      </Card>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--color-text)]">ロット一覧</h2>
          <Badge tone="neutral">{product?.lots.length ?? 0}件</Badge>
        </div>
        {!product?.lots.length ? (
          <EmptyState title="ロットがありません" description="スキャン画面から入荷登録してください。" />
        ) : (
          <div className="space-y-3">
            {product.lots.map((lot) => (
              <Card className="space-y-4" key={lot.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>期限 {formatDateLabel(lot.expiryDate)}</CardTitle>
                    <CardDescription>
                      初回 {lot.initialQuantity}個 / 現在 {lot.quantity}個
                    </CardDescription>
                  </div>
                  <Badge tone={lot.status === "ACTIVE" ? "success" : "neutral"}>{lot.status}</Badge>
                </div>
                <div className="space-y-3 rounded-2xl bg-slate-50/90 p-3">
                  <FieldLabel>数量を上書き</FieldLabel>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <FieldLabel>現在庫</FieldLabel>
                      <Input
                        disabled={!isOnline}
                        type="number"
                        value={qtyDrafts[lot.id] ?? lot.quantity}
                        onChange={(event) =>
                          setQtyDrafts((current) => ({
                            ...current,
                            [lot.id]: Number(event.target.value),
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>理由</FieldLabel>
                      <Input
                        disabled={!isOnline}
                        value={reasonDrafts[lot.id] ?? ""}
                        onChange={(event) =>
                          setReasonDrafts((current) => ({
                            ...current,
                            [lot.id]: event.target.value,
                          }))
                        }
                        placeholder="修正理由"
                      />
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button className="w-full" disabled={!isOnline} variant="secondary" onClick={() => updateLot(lot)}>
                      数量更新
                    </Button>
                    <Button className="w-full" disabled={!isOnline} variant="danger" onClick={() => deleteLot(lot)}>
                      ロット削除
                    </Button>
                  </div>
                </div>
                <div className="space-y-3 border-t border-slate-100 pt-4">
                  <FieldLabel>棚卸差異を調整</FieldLabel>
                  <div className="grid gap-3 sm:grid-cols-[112px_1fr]">
                    <div className="space-y-2">
                      <FieldLabel>差分</FieldLabel>
                      <Input
                        disabled={!isOnline}
                        type="number"
                        value={adjustDrafts[lot.id] ?? 0}
                        onChange={(event) =>
                          setAdjustDrafts((current) => ({
                            ...current,
                            [lot.id]: Number(event.target.value),
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>理由</FieldLabel>
                      <Input
                        disabled={!isOnline}
                        value={adjustReasons[lot.id] ?? ""}
                        onChange={(event) =>
                          setAdjustReasons((current) => ({
                            ...current,
                            [lot.id]: event.target.value,
                          }))
                        }
                        placeholder="差分調整理由"
                      />
                    </div>
                  </div>
                  <Button
                    className="w-full"
                    disabled={!isOnline || !adjustDrafts[lot.id]}
                    variant="secondary"
                    onClick={() => adjustLot(lot)}
                  >
                    差分調整
                  </Button>
                </div>
                <div className="space-y-3 border-t border-slate-100 pt-4">
                  <FieldLabel>廃棄を登録</FieldLabel>
                  <div className="grid gap-3 sm:grid-cols-[112px_1fr]">
                    <div className="space-y-2">
                      <FieldLabel>廃棄数</FieldLabel>
                      <Input
                        disabled={!isOnline}
                        type="number"
                        value={disposeDrafts[lot.id] ?? 0}
                        onChange={(event) =>
                          setDisposeDrafts((current) => ({
                            ...current,
                            [lot.id]: Number(event.target.value),
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>理由</FieldLabel>
                      <Input
                        disabled={!isOnline}
                        value={disposeReasons[lot.id] ?? ""}
                        onChange={(event) =>
                          setDisposeReasons((current) => ({
                            ...current,
                            [lot.id]: event.target.value,
                          }))
                        }
                        placeholder="廃棄理由"
                      />
                    </div>
                  </div>
                  <Button className="w-full" disabled={!isOnline} onClick={() => disposeLot(lot)}>
                    廃棄登録
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--color-text)]">履歴</h2>
        <div className="flex flex-wrap gap-2">
          {historyTabs.map((tab) => (
            <button
              className={`rounded-full px-4 py-2 text-sm font-medium ${
                historyTab === tab.key
                  ? "bg-[var(--color-brand)] text-white"
                  : "bg-slate-100 text-slate-600"
              }`}
              key={tab.key}
              onClick={() => setHistoryTab(tab.key)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
        {!history[historyTab].length ? (
          <EmptyState title="履歴はありません" description="入荷・売上・廃棄・調整がここに並びます。" />
        ) : (
          <div className="space-y-2">
            {history[historyTab].map((item) => (
              <Card className="space-y-2 py-4 sm:flex sm:items-center sm:justify-between sm:gap-3" key={item.id}>
                <div>
                  <CardTitle className="text-sm">
                    {historyTabs.find((tab) => tab.key === historyTab)?.label}
                  </CardTitle>
                  <CardDescription>{formatDateTimeLabel(item.date)}</CardDescription>
                </div>
                <p className="text-sm leading-6 text-slate-600 sm:text-right">{item.detail}</p>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

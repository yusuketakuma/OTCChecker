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
import {
  addDaysToDateKey,
  formatDateLabel,
  formatDateTimeLabel,
  todayJstKey,
} from "@/lib/date";
import {
  nonNegativeIntegerInputProps,
  parsePositiveIntegerInput,
  positiveIntegerInputProps,
  signedIntegerInputProps,
} from "@/lib/mobile-input";
import {
  readStoredReceiptDefaults,
  writeStoredReceiptDefaults,
} from "@/lib/receipt-defaults";
import { parseAlertDaysInput } from "@/lib/utils";

type HistoryTab = "receipts" | "sales" | "disposals" | "adjustments";

type Lot = {
  id: string;
  expiryDate: string;
  quantity: number;
  initialQuantity: number;
  status: "ACTIVE" | "ARCHIVED" | "DELETED";
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

const receiptExpiryPresets = [
  { label: "今日", days: 0 },
  { label: "+30日", days: 30 },
  { label: "+90日", days: 90 },
  { label: "+180日", days: 180 },
] as const;

const saleDatePresets = [
  { label: "今日", days: 0 },
  { label: "昨日", days: -1 },
  { label: "7日前", days: -7 },
] as const;

const commonQuantityPresets = [1, 3, 5, 10] as const;

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
      {children}
    </p>
  );
}

type LotActionState = {
  disabled: boolean;
  helperText: string;
};

const lotStatusMeta: Record<
  Lot["status"],
  { label: string; tone: "neutral" | "danger" | "success"; description: string }
> = {
  ACTIVE: {
    label: "販売対象",
    tone: "success",
    description: "販売・廃棄・調整の対象です。",
  },
  ARCHIVED: {
    label: "アーカイブ済み",
    tone: "neutral",
    description: "通常在庫から外した履歴ロットです。売上・廃棄の対象外です。",
  },
  DELETED: {
    label: "削除済み",
    tone: "danger",
    description: "削除済みロットです。",
  },
};

function parseIntegerDraft(value: string) {
  const trimmed = value.trim();

  if (!trimmed || !/^-?\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isLotDeleteBlocked(lot: Lot) {
  return (
    lot.salesRecords.length > 0 ||
    lot.disposalRecords.length > 0 ||
    lot.adjustmentRecords.length > 0
  );
}

function getQuantityActionState(
  lot: Lot,
  draft: string,
  reason: string,
  isOnline: boolean,
): LotActionState {
  const nextQuantity = parseIntegerDraft(draft);

  if (!isOnline) {
    return { disabled: true, helperText: "オフライン中は数量更新できません。" };
  }

  if (nextQuantity === null || nextQuantity < 0) {
    return { disabled: true, helperText: "数量は0以上の整数で入力してください。" };
  }

  if (!reason.trim()) {
    return { disabled: true, helperText: "更新理由を入力してください。" };
  }

  if (nextQuantity === lot.quantity) {
    return { disabled: true, helperText: "現在庫から変更がないため更新不要です。" };
  }

  if (lot.status === "ARCHIVED" && nextQuantity > 0) {
    return {
      disabled: false,
      helperText: "アーカイブ済みロットを在庫へ戻す更新です。理由は履歴に残ります。",
    };
  }

  if (nextQuantity === 0) {
    return {
      disabled: false,
      helperText: "0個で更新すると、このロットはアーカイブ扱いになります。",
    };
  }

  return {
    disabled: false,
    helperText: "数量を直接補正し、更新理由を履歴に記録します。",
  };
}

function getAdjustActionState(
  lot: Lot,
  draft: string,
  reason: string,
  isOnline: boolean,
): LotActionState {
  const delta = parseIntegerDraft(draft);

  if (!isOnline) {
    return { disabled: true, helperText: "オフライン中は差分調整できません。" };
  }

  if (delta === null) {
    return { disabled: true, helperText: "差分は整数で入力してください。" };
  }

  if (!reason.trim()) {
    return { disabled: true, helperText: "差分調整の理由を入力してください。" };
  }

  if (delta === 0) {
    return { disabled: true, helperText: "差分が0のため調整は不要です。" };
  }

  if (lot.quantity + delta < 0) {
    return {
      disabled: true,
      helperText: "調整後の在庫が0未満になるため登録できません。",
    };
  }

  if (lot.status === "ARCHIVED" && lot.quantity + delta > 0) {
    return {
      disabled: false,
      helperText: "アーカイブ済みロットを在庫へ戻す差分調整です。",
    };
  }

  if (lot.quantity + delta === 0) {
    return {
      disabled: false,
      helperText: "在庫が0個になるため、このロットはアーカイブされます。",
    };
  }

  return {
    disabled: false,
    helperText:
      delta > 0 ? "プラス差分で在庫を補正します。" : "マイナス差分で在庫を補正します。",
  };
}

function getDisposeActionState(
  lot: Lot,
  draft: string,
  reason: string,
  isOnline: boolean,
): LotActionState {
  const quantity = parseIntegerDraft(draft);

  if (!isOnline) {
    return { disabled: true, helperText: "オフライン中は廃棄登録できません。" };
  }

  if (lot.status !== "ACTIVE") {
    return {
      disabled: true,
      helperText: "アーカイブ済みロットは廃棄登録できません。",
    };
  }

  if (lot.quantity < 1) {
    return { disabled: true, helperText: "在庫がないため廃棄登録できません。" };
  }

  if (quantity === null || quantity < 1) {
    return { disabled: true, helperText: "廃棄数は1以上の整数で入力してください。" };
  }

  if (quantity > lot.quantity) {
    return {
      disabled: true,
      helperText: `廃棄数は現在庫 ${lot.quantity} 個以内で入力してください。`,
    };
  }

  if (!reason.trim()) {
    return { disabled: true, helperText: "廃棄理由を入力してください。" };
  }

  if (quantity === lot.quantity) {
    return {
      disabled: false,
      helperText: "全量廃棄すると、このロットはアーカイブされます。",
    };
  }

  return {
    disabled: false,
    helperText: `1〜${lot.quantity}個まで廃棄登録できます。`,
  };
}

function getDeleteActionState(lot: Lot, isOnline: boolean): LotActionState {
  if (!isOnline) {
    return { disabled: true, helperText: "オフライン中はロット削除できません。" };
  }

  if (isLotDeleteBlocked(lot)) {
    return {
      disabled: true,
      helperText: "売上・廃棄・調整履歴があるロットは削除できません。",
    };
  }

  return {
    disabled: false,
    helperText: "履歴のない誤登録ロットのみ削除できます。",
  };
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
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});
  const [reasonDrafts, setReasonDrafts] = useState<Record<string, string>>({});
  const [adjustDrafts, setAdjustDrafts] = useState<Record<string, string>>({});
  const [adjustReasons, setAdjustReasons] = useState<Record<string, string>>({});
  const [disposeDrafts, setDisposeDrafts] = useState<Record<string, string>>({});
  const [disposeReasons, setDisposeReasons] = useState<Record<string, string>>({});
  const [receiptExpiryDate, setReceiptExpiryDate] = useState(() => readStoredReceiptDefaults().expiryDate);
  const [receiptQuantity, setReceiptQuantity] = useState(() => String(readStoredReceiptDefaults().quantity));
  const [saleDate, setSaleDate] = useState(todayJstKey());
  const [saleQuantity, setSaleQuantity] = useState("1");
  const [historyTab, setHistoryTab] = useState<HistoryTab>("receipts");
  const [pendingDeleteLotId, setPendingDeleteLotId] = useState<string | null>(null);
  const parsedReceiptQuantity = parsePositiveIntegerInput(receiptQuantity);
  const alertDaysInput = parseAlertDaysInput(editAlertDays);
  const parsedSaleQuantity = parsePositiveIntegerInput(saleQuantity);
  const totalActiveQuantity = useMemo(
    () =>
      product?.lots
        .filter((lot) => lot.status === "ACTIVE")
        .reduce((sum, lot) => sum + lot.quantity, 0) ?? 0,
    [product],
  );
  const saleRemainingQuantity =
    parsedSaleQuantity === null
      ? totalActiveQuantity
      : Math.max(totalActiveQuantity - parsedSaleQuantity, 0);
  const saleExceedsStock = parsedSaleQuantity !== null && parsedSaleQuantity > totalActiveQuantity;

  const load = useCallback(async () => {
    try {
      const detail = await fetchJson<ProductDetail>(`/api/products/${productId}`);
      setProduct(detail);
      setEditName(detail.name);
      setEditSpec(detail.spec);
      setEditAlertDays(detail.alertDays.join(","));
      setQtyDrafts(Object.fromEntries(detail.lots.map((lot) => [lot.id, String(lot.quantity)])));
      setReasonDrafts(Object.fromEntries(detail.lots.map((lot) => [lot.id, "在庫修正"])));
      setAdjustDrafts(Object.fromEntries(detail.lots.map((lot) => [lot.id, "0"])));
      setAdjustReasons(Object.fromEntries(detail.lots.map((lot) => [lot.id, "棚卸差異"])));
      setDisposeDrafts(Object.fromEntries(detail.lots.map((lot) => [lot.id, ""])));
      setDisposeReasons(
        Object.fromEntries(detail.lots.map((lot) => [lot.id, "期限近接による廃棄"])),
      );
      setSaleDate(todayJstKey());
      setSaleQuantity("1");
      setPendingDeleteLotId(null);
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    writeStoredReceiptDefaults(receiptExpiryDate, parsedReceiptQuantity ?? 1);
  }, [parsedReceiptQuantity, receiptExpiryDate]);

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
      if (alertDaysInput.error) {
        setError(alertDaysInput.error);
        setMessage("");
        return;
      }

      await putJson(`/api/products/${product.id}`, {
        name: editName,
        spec: editSpec,
        alertDays: alertDaysInput.values,
      });
      setEditAlertDays(alertDaysInput.normalizedText);
      setMessage("商品マスタを更新しました。");
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function updateLot(lot: Lot) {
    const quantityAction = getQuantityActionState(
      lot,
      qtyDrafts[lot.id] ?? String(lot.quantity),
      reasonDrafts[lot.id] ?? "",
      isOnline,
    );
    const nextQuantity = parseIntegerDraft(qtyDrafts[lot.id] ?? "");

    if (quantityAction.disabled || nextQuantity === null) {
      setError(quantityAction.helperText);
      setMessage("");
      return;
    }

    try {
      setError("");
      setMessage("");
      await putJson(`/api/lots/${lot.id}`, {
        quantity: nextQuantity,
        reason: (reasonDrafts[lot.id] ?? "").trim(),
        version: lot.version,
      });
      setMessage("在庫数量を更新しました。");
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function disposeLot(lot: Lot) {
    const disposeAction = getDisposeActionState(
      lot,
      disposeDrafts[lot.id] ?? "",
      disposeReasons[lot.id] ?? "",
      isOnline,
    );
    const disposalQuantity = parseIntegerDraft(disposeDrafts[lot.id] ?? "");

    if (disposeAction.disabled || disposalQuantity === null) {
      setError(disposeAction.helperText);
      setMessage("");
      return;
    }

    try {
      setError("");
      setMessage("");
      await postJson(`/api/lots/${lot.id}/dispose`, {
        quantity: disposalQuantity,
        reason: (disposeReasons[lot.id] ?? "").trim(),
        version: lot.version,
      });
      setMessage("廃棄を登録しました。");
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function adjustLot(lot: Lot) {
    const adjustAction = getAdjustActionState(
      lot,
      adjustDrafts[lot.id] ?? "0",
      adjustReasons[lot.id] ?? "",
      isOnline,
    );
    const delta = parseIntegerDraft(adjustDrafts[lot.id] ?? "");

    if (adjustAction.disabled || delta === null) {
      setError(adjustAction.helperText);
      setMessage("");
      return;
    }

    try {
      setError("");
      setMessage("");
      await postJson(`/api/lots/${lot.id}/adjust`, {
        delta,
        reason: (adjustReasons[lot.id] ?? "").trim(),
        version: lot.version,
      });
      setMessage("差分調整を登録しました。");
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function deleteLot(lot: Lot) {
    const deleteAction = getDeleteActionState(lot, isOnline);

    if (deleteAction.disabled) {
      setError(deleteAction.helperText);
      setMessage("");
      return;
    }

    try {
      setError("");
      setMessage("");
      await fetchJson(`/api/lots/${lot.id}`, { method: "DELETE" });
      setMessage("ロットを削除しました。");
      setPendingDeleteLotId(null);
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

    if (parsedReceiptQuantity === null) {
      setError("入荷数量は1以上の整数で入力してください。");
      return;
    }

    try {
      setError("");
      setMessage("");
      await postJson("/api/lots", {
        productId: product.id,
        expiryDate: receiptExpiryDate,
        quantity: parsedReceiptQuantity,
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

    if (parsedSaleQuantity === null) {
      setError("売上数量は1以上の整数で入力してください。");
      setMessage("");
      return;
    }

    if (saleExceedsStock) {
      setError(`現在庫 ${totalActiveQuantity} 個を超えるため売上登録できません。`);
      setMessage("");
      return;
    }

    setSelling(true);

    try {
      setError("");
      setMessage("");
      await postJson(`/api/products/${product.id}/sales`, {
        quantity: parsedSaleQuantity,
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
            <p className={`text-sm ${alertDaysInput.error ? "text-[var(--color-danger)]" : "text-slate-500"}`}>
              {alertDaysInput.error || `保存時は ${alertDaysInput.normalizedText} に整えて反映します。全角カンマも使えます。`}
            </p>
          </div>
        </div>
        <Button className="w-full" disabled={!isOnline || saving || Boolean(alertDaysInput.error)} onClick={saveProduct}>
          商品マスタを更新
        </Button>
      </Card>

      <Card className="space-y-4">
        <CardTitle>手動入荷登録</CardTitle>
        <CardDescription>バーコードが使えない場合も、この商品へ直接入荷を追加できます。前回の入荷条件も引き継ぎます。</CardDescription>
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <div className="space-y-2">
            <FieldLabel>期限日</FieldLabel>
            <Input
              disabled={!isOnline}
              type="date"
              value={receiptExpiryDate}
              onChange={(event) => setReceiptExpiryDate(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {receiptExpiryPresets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  disabled={!isOnline}
                  className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
                  onClick={() => setReceiptExpiryDate(addDaysToDateKey(todayJstKey(), preset.days))}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <FieldLabel>数量</FieldLabel>
            <Input
              disabled={!isOnline}
              {...positiveIntegerInputProps}
              enterKeyHint="done"
              value={receiptQuantity}
              onChange={(event) => setReceiptQuantity(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {commonQuantityPresets.map((preset) => (
                <button
                  key={`receipt-${preset}`}
                  type="button"
                  disabled={!isOnline}
                  className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
                  onClick={() => setReceiptQuantity(String(preset))}
                >
                  {preset}個
                </button>
              ))}
            </div>
          </div>
          <Button
            className="w-full sm:col-span-2"
            disabled={!isOnline || !receiptExpiryDate || parsedReceiptQuantity === null}
            onClick={receiveStock}
          >
            入荷登録
          </Button>
        </div>
      </Card>

      <Card className="space-y-4" id="manual-sale">
        <CardTitle>手動売上登録</CardTitle>
        <CardDescription>CSV を待たずに、その場の販売や補正売上を FIFO で反映します。</CardDescription>
        <div className="rounded-2xl bg-slate-50/90 p-3 text-sm text-slate-700">
          <p>現在の販売可能在庫: {totalActiveQuantity}個</p>
          <p>今回の売上後の見込み在庫: {saleRemainingQuantity}個</p>
          {saleExceedsStock ? (
            <p className="mt-2 text-[var(--color-danger)]">
              現在庫を超える数量です。数量を減らしてから登録してください。
            </p>
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <div className="space-y-2">
            <FieldLabel>売上日</FieldLabel>
            <Input
              disabled={!isOnline}
              type="date"
              value={saleDate}
              onChange={(event) => setSaleDate(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {saleDatePresets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  disabled={!isOnline}
                  className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
                  onClick={() => setSaleDate(addDaysToDateKey(todayJstKey(), preset.days))}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <FieldLabel>数量</FieldLabel>
            <Input
              disabled={!isOnline}
              {...positiveIntegerInputProps}
              enterKeyHint="done"
              value={saleQuantity}
              onChange={(event) => setSaleQuantity(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {commonQuantityPresets.map((preset) => (
                <button
                  key={`sale-${preset}`}
                  type="button"
                  disabled={!isOnline}
                  className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
                  onClick={() => setSaleQuantity(String(preset))}
                >
                  {preset}個
                </button>
              ))}
              {totalActiveQuantity > 0 ? (
                <button
                  type="button"
                  disabled={!isOnline}
                  className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 disabled:opacity-50"
                  onClick={() => setSaleQuantity(String(totalActiveQuantity))}
                >
                  全在庫
                </button>
              ) : null}
            </div>
          </div>
          <Button
            className="w-full sm:col-span-2"
            disabled={!isOnline || !saleDate || selling || parsedSaleQuantity === null || totalActiveQuantity === 0 || saleExceedsStock}
            variant="secondary"
            onClick={recordManualSale}
          >
            {selling ? "登録中..." : totalActiveQuantity === 0 ? "在庫がないため登録不可" : "売上登録"}
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
            {product.lots.map((lot) => {
              const status = lotStatusMeta[lot.status];
              const quantityAction = getQuantityActionState(
                lot,
                qtyDrafts[lot.id] ?? String(lot.quantity),
                reasonDrafts[lot.id] ?? "",
                isOnline,
              );
              const adjustAction = getAdjustActionState(
                lot,
                adjustDrafts[lot.id] ?? "0",
                adjustReasons[lot.id] ?? "",
                isOnline,
              );
              const disposeAction = getDisposeActionState(
                lot,
                disposeDrafts[lot.id] ?? "",
                disposeReasons[lot.id] ?? "",
                isOnline,
              );
              const deleteAction = getDeleteActionState(lot, isOnline);
              const disposeInputsDisabled =
                !isOnline || lot.status !== "ACTIVE" || lot.quantity < 1;
              const deleteConfirmOpen = pendingDeleteLotId === lot.id;

              return (
                <Card className="space-y-4" key={lot.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle>期限 {formatDateLabel(lot.expiryDate)}</CardTitle>
                      <CardDescription>
                        初回 {lot.initialQuantity}個 / 現在 {lot.quantity}個
                      </CardDescription>
                    </div>
                    <div className="space-y-2 text-right">
                      <Badge tone={status.tone}>{status.label}</Badge>
                      <p className="text-xs leading-5 text-slate-500">{status.description}</p>
                    </div>
                  </div>
                  <div className="space-y-3 rounded-2xl bg-slate-50/90 p-3">
                    <FieldLabel>数量を上書き</FieldLabel>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <FieldLabel>現在庫</FieldLabel>
                        <Input
                          disabled={!isOnline}
                          {...nonNegativeIntegerInputProps}
                          enterKeyHint="next"
                          value={qtyDrafts[lot.id] ?? String(lot.quantity)}
                          onChange={(event) =>
                            setQtyDrafts((current) => ({
                              ...current,
                              [lot.id]: event.target.value,
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
                    <p
                      className={`text-xs leading-5 ${
                        quantityAction.disabled ? "text-amber-700" : "text-slate-500"
                      }`}
                    >
                      {quantityAction.helperText}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Button
                        className="w-full"
                        disabled={quantityAction.disabled}
                        variant="secondary"
                        onClick={() => updateLot(lot)}
                      >
                        数量更新
                      </Button>
                      <Button
                        className="w-full"
                        disabled={deleteAction.disabled}
                        variant="danger"
                        onClick={() =>
                          setPendingDeleteLotId((current) => (current === lot.id ? null : lot.id))
                        }
                      >
                        {deleteConfirmOpen ? "削除確認を閉じる" : "ロット削除"}
                      </Button>
                    </div>
                    <p
                      className={`text-xs leading-5 ${
                        deleteAction.disabled ? "text-amber-700" : "text-slate-500"
                      }`}
                    >
                      {deleteAction.helperText}
                    </p>
                    {deleteConfirmOpen ? (
                      <div className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50/80 p-3">
                        <FieldLabel>ロット削除の確認</FieldLabel>
                        <p className="text-sm text-rose-900">
                          このロットを削除します。履歴がある場合は削除できません。
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Button className="w-full" variant="danger" onClick={() => deleteLot(lot)}>
                            このロットを削除する
                          </Button>
                          <Button
                            className="w-full"
                            variant="secondary"
                            onClick={() => setPendingDeleteLotId(null)}
                          >
                            キャンセル
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="space-y-3 border-t border-slate-100 pt-4">
                    <FieldLabel>棚卸差異を調整</FieldLabel>
                    <div className="grid gap-3 sm:grid-cols-[112px_1fr]">
                      <div className="space-y-2">
                        <FieldLabel>差分</FieldLabel>
                        <Input
                          disabled={!isOnline}
                          {...signedIntegerInputProps}
                          enterKeyHint="next"
                          value={adjustDrafts[lot.id] ?? "0"}
                          onChange={(event) =>
                            setAdjustDrafts((current) => ({
                              ...current,
                              [lot.id]: event.target.value,
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
                    <p
                      className={`text-xs leading-5 ${
                        adjustAction.disabled ? "text-amber-700" : "text-slate-500"
                      }`}
                    >
                      {adjustAction.helperText}
                    </p>
                    <Button
                      className="w-full"
                      disabled={adjustAction.disabled}
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
                          disabled={disposeInputsDisabled}
                          {...positiveIntegerInputProps}
                          enterKeyHint="next"
                          max={lot.quantity}
                          value={disposeDrafts[lot.id] ?? ""}
                          onChange={(event) =>
                            setDisposeDrafts((current) => ({
                              ...current,
                              [lot.id]: event.target.value,
                            }))
                          }
                        />
                        <div className="flex flex-wrap gap-2">
                          {commonQuantityPresets
                            .filter((preset) => preset <= lot.quantity)
                            .map((preset) => (
                              <button
                                key={`${lot.id}-dispose-${preset}`}
                                type="button"
                                disabled={disposeInputsDisabled}
                                className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
                                onClick={() =>
                                  setDisposeDrafts((current) => ({
                                    ...current,
                                    [lot.id]: String(preset),
                                  }))
                                }
                              >
                                {preset}個
                              </button>
                            ))}
                          <button
                            type="button"
                            disabled={disposeInputsDisabled}
                            className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 disabled:opacity-50"
                            onClick={() =>
                              setDisposeDrafts((current) => ({
                                ...current,
                                [lot.id]: String(lot.quantity),
                              }))
                            }
                          >
                            全量
                          </button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <FieldLabel>理由</FieldLabel>
                        <Input
                          disabled={disposeInputsDisabled}
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
                    <p
                      className={`text-xs leading-5 ${
                        disposeAction.disabled ? "text-amber-700" : "text-slate-500"
                      }`}
                    >
                      {disposeAction.helperText}
                    </p>
                    <Button
                      className="w-full"
                      disabled={disposeAction.disabled}
                      onClick={() => disposeLot(lot)}
                    >
                      廃棄登録
                    </Button>
                  </div>
                </Card>
              );
            })}
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

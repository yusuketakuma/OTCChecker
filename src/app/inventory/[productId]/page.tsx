"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  diffDaysFromToday,
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
  clearStoredReceiptDefaults,
  readStoredReceiptDefaults,
  writeStoredReceiptDefaults,
} from "@/lib/receipt-defaults";
import { parseAlertDaysInput } from "@/lib/utils";

type HistoryTab = "receipts" | "sales" | "disposals" | "adjustments";
type LotActionKind = "update" | "adjust" | "dispose" | "delete";

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
const alertDayPresets = [30, 14, 7, 3, 0] as const;

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

function getHashTargetId(hash: string) {
  if (!hash.startsWith("#") || hash.length < 2) {
    return null;
  }

  const encodedId = hash.slice(1);

  try {
    return decodeURIComponent(encodedId);
  } catch {
    return encodedId;
  }
}

function isLotDeleteBlocked(lot: Lot) {
  return (
    lot.salesRecords.length > 0 ||
    lot.disposalRecords.length > 0 ||
    lot.adjustmentRecords.length > 0
  );
}

function buildSalePreview(lots: Lot[], requestedQuantity: number | null) {
  if (requestedQuantity === null || requestedQuantity <= 0) {
    return [] as Array<{
      lotId: string;
      expiryDate: string;
      beforeQuantity: number;
      consumeQuantity: number;
      afterQuantity: number;
    }>;
  }

  let remaining = requestedQuantity;

  return lots
    .filter(
      (lot) => lot.status === "ACTIVE" && lot.quantity > 0 && diffDaysFromToday(lot.expiryDate) >= 0,
    )
    .map((lot) => {
      const consumeQuantity = Math.min(lot.quantity, remaining);
      remaining -= consumeQuantity;

      return {
        lotId: lot.id,
        expiryDate: lot.expiryDate,
        beforeQuantity: lot.quantity,
        consumeQuantity,
        afterQuantity: lot.quantity - consumeQuantity,
      };
    })
    .filter((lot) => lot.consumeQuantity > 0);
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
  const handledHashRef = useRef<string | null>(null);
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [receiving, setReceiving] = useState(false);
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
  const [receiptExpiryDate, setReceiptExpiryDate] = useState("");
  const [receiptQuantity, setReceiptQuantity] = useState("1");
  const [receiptDefaultsReady, setReceiptDefaultsReady] = useState(false);
  const [saleDate, setSaleDate] = useState(todayJstKey());
  const [saleQuantity, setSaleQuantity] = useState("1");
  const [historyTab, setHistoryTab] = useState<HistoryTab>("receipts");
  const [pendingDeleteLotId, setPendingDeleteLotId] = useState<string | null>(null);
  const [pendingLotAction, setPendingLotAction] = useState<{
    lotId: string;
    action: LotActionKind;
  } | null>(null);
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
  const saleableLots = useMemo(
    () =>
      product?.lots.filter(
        (lot) => lot.status === "ACTIVE" && diffDaysFromToday(lot.expiryDate) >= 0,
      ) ?? [],
    [product],
  );
  const expiredActiveQuantity = useMemo(
    () =>
      product?.lots
        .filter((lot) => lot.status === "ACTIVE" && diffDaysFromToday(lot.expiryDate) < 0)
        .reduce((sum, lot) => sum + lot.quantity, 0) ?? 0,
    [product],
  );
  const saleableQuantity = useMemo(
    () => saleableLots.reduce((sum, lot) => sum + lot.quantity, 0),
    [saleableLots],
  );
  const productSummary = useMemo(() => {
    const lots = product?.lots ?? [];
    const expiredLots = lots.filter(
      (lot) => lot.status === "ACTIVE" && diffDaysFromToday(lot.expiryDate) < 0,
    );
    const todayLots = lots.filter(
      (lot) => lot.status === "ACTIVE" && diffDaysFromToday(lot.expiryDate) === 0,
    );
    const nextActionLot = lots.find((lot) => lot.status === "ACTIVE" && lot.quantity > 0) ?? null;

    return {
      activeLotCount: lots.filter((lot) => lot.status === "ACTIVE").length,
      archivedLotCount: lots.filter((lot) => lot.status === "ARCHIVED").length,
      expiredLotCount: expiredLots.length,
      todayLotCount: todayLots.length,
      earliestExpiry: nextActionLot ? formatDateLabel(nextActionLot.expiryDate) : null,
      nextActionLotId: nextActionLot?.id ?? null,
      firstExpiredLotId: expiredLots[0]?.id ?? null,
      firstTodayLotId: todayLots[0]?.id ?? null,
    };
  }, [product?.lots]);
  const saleRemainingQuantity =
    parsedSaleQuantity === null
      ? saleableQuantity
      : Math.max(saleableQuantity - parsedSaleQuantity, 0);
  const saleExceedsStock = parsedSaleQuantity !== null && parsedSaleQuantity > saleableQuantity;
  const salePreview = useMemo(
    () => buildSalePreview(product?.lots ?? [], parsedSaleQuantity),
    [parsedSaleQuantity, product?.lots],
  );

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
    const storedDefaults = readStoredReceiptDefaults();

    setReceiptExpiryDate(storedDefaults.expiryDate);
    setReceiptQuantity(String(storedDefaults.quantity));
    setReceiptDefaultsReady(true);
  }, []);

  useEffect(() => {
    if (!receiptDefaultsReady) {
      return;
    }

    writeStoredReceiptDefaults(receiptExpiryDate, parsedReceiptQuantity ?? 1);
  }, [parsedReceiptQuantity, receiptDefaultsReady, receiptExpiryDate]);

  function clearReceiptDefaults() {
    setReceiptExpiryDate("");
    setReceiptQuantity("1");
    clearStoredReceiptDefaults();
    setError("");
    setMessage("入荷条件の保持をクリアしました。");
  }

  const scrollToCurrentHash = useCallback(() => {
    const hash = window.location.hash;
    const targetId = getHashTargetId(hash);

    if (!targetId) {
      handledHashRef.current = null;
      return false;
    }

    const target = document.getElementById(targetId);

    if (!target) {
      return false;
    }

    target.scrollIntoView({ block: "start" });
    handledHashRef.current = hash;
    return true;
  }, []);

  useEffect(() => {
    const hash = window.location.hash;

    if (!hash || handledHashRef.current === hash) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      scrollToCurrentHash();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [product, scrollToCurrentHash]);

  useEffect(() => {
    let frameId = 0;

    const handleHashChange = () => {
      handledHashRef.current = null;

      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        scrollToCurrentHash();
      });
    };

    window.addEventListener("hashchange", handleHashChange);

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }

      window.removeEventListener("hashchange", handleHashChange);
    };
  }, [scrollToCurrentHash]);

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

  function toggleAlertDay(day: number) {
    const next = alertDaysInput.values.includes(day)
      ? alertDaysInput.values.filter((value) => value !== day)
      : [...alertDaysInput.values, day];

    setEditAlertDays(next.length ? next.sort((a, b) => b - a).join(",") : "");
    setMessage("");
  }

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
    if (pendingLotAction?.lotId === lot.id) {
      return;
    }

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
      setPendingLotAction({ lotId: lot.id, action: "update" });
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
    } finally {
      setPendingLotAction(null);
    }
  }

  async function disposeLot(lot: Lot) {
    if (pendingLotAction?.lotId === lot.id) {
      return;
    }

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
      setPendingLotAction({ lotId: lot.id, action: "dispose" });
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
    } finally {
      setPendingLotAction(null);
    }
  }

  async function adjustLot(lot: Lot) {
    if (pendingLotAction?.lotId === lot.id) {
      return;
    }

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
      setPendingLotAction({ lotId: lot.id, action: "adjust" });
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
    } finally {
      setPendingLotAction(null);
    }
  }

  async function deleteLot(lot: Lot) {
    if (pendingLotAction?.lotId === lot.id) {
      return;
    }

    const deleteAction = getDeleteActionState(lot, isOnline);

    if (deleteAction.disabled) {
      setError(deleteAction.helperText);
      setMessage("");
      return;
    }

    try {
      setPendingLotAction({ lotId: lot.id, action: "delete" });
      setError("");
      setMessage("");
      await fetchJson(`/api/lots/${lot.id}`, { method: "DELETE" });
      setMessage("ロットを削除しました。");
      setPendingDeleteLotId(null);
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setPendingLotAction(null);
    }
  }

  async function receiveStock() {
    if (receiving || !product) {
      return;
    }

    if (!receiptExpiryDate) {
      setError("入荷登録には期限日が必要です。");
      return;
    }

    if (parsedReceiptQuantity === null) {
      setError("入荷数量は1以上の整数で入力してください。");
      return;
    }

    try {
      setReceiving(true);
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
    } finally {
      setReceiving(false);
    }
  }

  async function recordManualSale() {
    if (selling || !product) {
      return;
    }

    if (parsedSaleQuantity === null) {
      setError("売上数量は1以上の整数で入力してください。");
      setMessage("");
      return;
    }

    if (saleExceedsStock) {
      setError(`販売可能在庫 ${saleableQuantity} 個を超えるため売上登録できません。`);
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
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl bg-slate-50/90 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">総在庫</p>
            <p className="mt-2 text-2xl font-semibold text-[var(--color-text)]">{totalActiveQuantity}個</p>
            <p className="mt-1 text-sm text-slate-500">販売可能 {saleableQuantity}個</p>
          </div>
          <div className="rounded-2xl bg-rose-50/90 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-600">期限切れ対応</p>
            <p className="mt-2 text-2xl font-semibold text-rose-900">{productSummary.expiredLotCount}件</p>
            <p className="mt-1 text-sm text-rose-700">本日期限 {productSummary.todayLotCount}件</p>
          </div>
          <div className="rounded-2xl bg-white/90 p-4 ring-1 ring-slate-200">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">最短期限</p>
            <p className="mt-2 text-2xl font-semibold text-[var(--color-text)]">{productSummary.earliestExpiry ?? "-"}</p>
            <p className="mt-1 text-sm text-slate-500">有効 {productSummary.activeLotCount}件 / 履歴 {productSummary.archivedLotCount}件</p>
          </div>
          <div className="rounded-2xl bg-emerald-50/90 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">すぐ操作</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                className="inline-flex h-10 items-center justify-center rounded-full bg-emerald-700 px-4 text-sm font-semibold text-white"
                href="#manual-receipt"
              >
                手動入荷
              </a>
              <a
                className="inline-flex h-10 items-center justify-center rounded-full bg-white px-4 text-sm font-semibold text-emerald-900 ring-1 ring-emerald-200"
                href="#manual-sale"
              >
                手動売上
              </a>
              {productSummary.firstExpiredLotId ? (
                <a
                  className="inline-flex h-10 items-center justify-center rounded-full bg-rose-100 px-4 text-sm font-semibold text-rose-800 ring-1 ring-rose-200"
                  href={`#lot-${productSummary.firstExpiredLotId}`}
                >
                  期限切れへ
                </a>
              ) : null}
              {!productSummary.firstExpiredLotId && productSummary.firstTodayLotId ? (
                <a
                  className="inline-flex h-10 items-center justify-center rounded-full bg-amber-100 px-4 text-sm font-semibold text-amber-800 ring-1 ring-amber-200"
                  href={`#lot-${productSummary.firstTodayLotId}`}
                >
                  本日期限へ
                </a>
              ) : null}
              {!productSummary.firstExpiredLotId && !productSummary.firstTodayLotId && productSummary.nextActionLotId ? (
                <a
                  className="inline-flex h-10 items-center justify-center rounded-full bg-white px-4 text-sm font-semibold text-slate-700 ring-1 ring-slate-200"
                  href={`#lot-${productSummary.nextActionLotId}`}
                >
                  最初のロットへ
                </a>
              ) : null}
            </div>
          </div>
        </div>
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
            <div className="flex flex-wrap gap-2">
              {alertDayPresets.map((day) => {
                const selected = alertDaysInput.values.includes(day);

                return (
                  <button
                    key={day}
                    type="button"
                    disabled={!isOnline}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                      selected
                        ? "bg-[var(--color-brand)] text-white"
                        : "bg-slate-100 text-slate-700"
                    }`}
                    onClick={() => toggleAlertDay(day)}
                  >
                    {day === 0 ? "当日" : `${day}日前`}
                  </button>
                );
              })}
            </div>
            <p className={`text-sm ${alertDaysInput.error ? "text-[var(--color-danger)]" : "text-slate-500"}`}>
              {alertDaysInput.error || `保存時は ${alertDaysInput.normalizedText} に整えて反映します。全角カンマも使えます。`}
            </p>
          </div>
        </div>
        <Button className="w-full" disabled={!isOnline || saving || Boolean(alertDaysInput.error)} onClick={saveProduct}>
          商品マスタを更新
        </Button>
      </Card>

      <Card className="scroll-mt-24 space-y-4" id="manual-receipt">
        <CardTitle>手動入荷登録</CardTitle>
        <CardDescription>バーコードが使えない場合も、この商品へ直接入荷を追加できます。前回の入荷条件も引き継ぎます。</CardDescription>
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <div className="space-y-2">
            <FieldLabel>期限日</FieldLabel>
            <Input
              disabled={!isOnline || receiving}
              type="date"
              value={receiptExpiryDate}
              onChange={(event) => setReceiptExpiryDate(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {receiptExpiryPresets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  disabled={!isOnline || receiving}
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
              disabled={!isOnline || receiving}
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
                  disabled={!isOnline || receiving}
                  className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
                  onClick={() => setReceiptQuantity(String(preset))}
                >
                  {preset}個
                </button>
              ))}
            </div>
          </div>
          {receiptExpiryDate || (parsedReceiptQuantity ?? 1) > 1 ? (
            <div className="rounded-2xl bg-emerald-50/80 p-3 text-sm text-emerald-900 sm:col-span-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">前回の入荷条件を保持中</p>
                  <p className="mt-1">
                    期限日 {receiptExpiryDate || "未設定"} / 数量 {parsedReceiptQuantity ?? 1}個
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!isOnline || receiving}
                  className="rounded-full bg-white/80 px-3 py-1.5 text-xs font-medium text-emerald-900 ring-1 ring-emerald-200 disabled:opacity-50"
                  onClick={clearReceiptDefaults}
                >
                  保持をクリア
                </button>
              </div>
            </div>
          ) : null}
          <Button
            className="w-full sm:col-span-2"
            disabled={!isOnline || receiving || !receiptExpiryDate || parsedReceiptQuantity === null}
            onClick={receiveStock}
          >
            {receiving ? "登録中..." : "入荷登録"}
          </Button>
        </div>
      </Card>

      <Card className="scroll-mt-24 space-y-4" id="manual-sale">
        <CardTitle>手動売上登録</CardTitle>
        <CardDescription>CSV を待たずに、その場の販売や補正売上を FIFO で反映します。</CardDescription>
        <div className="rounded-2xl bg-slate-50/90 p-3 text-sm text-slate-700">
          <p>現在の販売可能在庫: {saleableQuantity}個</p>
          <p>今回の売上後の見込み在庫: {saleRemainingQuantity}個</p>
          {expiredActiveQuantity > 0 ? (
            <p className="mt-2 text-amber-700">
              期限切れ在庫 {expiredActiveQuantity} 個は手動売上の対象外です。先に廃棄登録してください。
            </p>
          ) : null}
          {saleExceedsStock ? (
            <p className="mt-2 text-[var(--color-danger)]">
              販売可能在庫を超える数量です。数量を減らしてから登録してください。
            </p>
          ) : null}
        </div>
        {parsedSaleQuantity !== null && totalActiveQuantity > 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white/90 p-3 text-sm text-slate-700">
            <p className="font-medium text-[var(--color-text)]">FIFO消し込み予定</p>
            {!salePreview.length ? (
              <p className="mt-2 text-[var(--color-danger)]">引当できるロットがありません。</p>
            ) : (
              <div className="mt-3 space-y-2">
                {salePreview.map((lot) => (
                  <div
                    key={`sale-preview-${lot.lotId}`}
                    className="flex items-start justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-2"
                  >
                    <div>
                      <p className="font-medium">期限 {formatDateLabel(lot.expiryDate)}</p>
                      <p className="text-xs text-slate-500">
                        売上前 {lot.beforeQuantity}個 → 売上後 {lot.afterQuantity}個
                      </p>
                    </div>
                    <Badge tone="info">-{lot.consumeQuantity}個</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <div className="space-y-2">
            <FieldLabel>売上日</FieldLabel>
            <Input
              disabled={!isOnline || selling}
              type="date"
              value={saleDate}
              onChange={(event) => setSaleDate(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {saleDatePresets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  disabled={!isOnline || selling}
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
              disabled={!isOnline || selling}
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
                  disabled={!isOnline || selling}
                  className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
                  onClick={() => setSaleQuantity(String(preset))}
                >
                  {preset}個
                </button>
              ))}
              {saleableQuantity > 0 ? (
                <button
                  type="button"
                  disabled={!isOnline || selling}
                  className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 disabled:opacity-50"
                  onClick={() => setSaleQuantity(String(saleableQuantity))}
                >
                  販売可能分すべて
                </button>
              ) : null}
            </div>
          </div>
          <Button
            className="w-full sm:col-span-2"
            disabled={!isOnline || !saleDate || selling || parsedSaleQuantity === null || saleableQuantity === 0 || saleExceedsStock}
            variant="secondary"
            onClick={recordManualSale}
          >
            {selling ? "登録中..." : saleableQuantity === 0 ? "販売可能在庫がないため登録不可" : "売上登録"}
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
              const lotBusy = pendingLotAction?.lotId === lot.id;
              const activeLotAction = lotBusy ? pendingLotAction.action : null;
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
                !isOnline || lot.status !== "ACTIVE" || lot.quantity < 1 || lotBusy;
              const deleteConfirmOpen = pendingDeleteLotId === lot.id;

              return (
                <Card className="space-y-4 scroll-mt-24" id={`lot-${lot.id}`} key={lot.id}>
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
                          disabled={!isOnline || lotBusy}
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
                          disabled={!isOnline || lotBusy}
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
                        disabled={quantityAction.disabled || lotBusy}
                        variant="secondary"
                        onClick={() => updateLot(lot)}
                      >
                        {activeLotAction === "update" ? "更新中..." : "数量更新"}
                      </Button>
                      <Button
                        className="w-full"
                        disabled={deleteAction.disabled || lotBusy}
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
                          <Button
                            className="w-full"
                            disabled={lotBusy}
                            variant="danger"
                            onClick={() => deleteLot(lot)}
                          >
                            {activeLotAction === "delete" ? "削除中..." : "このロットを削除する"}
                          </Button>
                          <Button
                            className="w-full"
                            disabled={lotBusy}
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
                          disabled={!isOnline || lotBusy}
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
                          disabled={!isOnline || lotBusy}
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
                      disabled={adjustAction.disabled || lotBusy}
                      variant="secondary"
                      onClick={() => adjustLot(lot)}
                    >
                      {activeLotAction === "adjust" ? "調整中..." : "差分調整"}
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
                      disabled={disposeAction.disabled || lotBusy}
                      onClick={() => disposeLot(lot)}
                    >
                      {activeLotAction === "dispose" ? "登録中..." : "廃棄登録"}
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

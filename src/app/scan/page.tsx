"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "next/navigation";

import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { BarcodeScanner } from "@/components/scan/barcode-scanner";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useRefreshOnForeground } from "@/hooks/use-refresh-on-foreground";
import { fetchJson, postJson } from "@/lib/client";
import { normalizeJanCode } from "@/lib/csv";
import { addDaysToDateKey, getExpiryStatusMeta, todayJstKey } from "@/lib/date";
import { receiptExpiryPresets, quantityPresets } from "@/lib/presets";
import {
  coercePositiveIntegerInput,
  janInputProps,
  parsePositiveIntegerInput,
  positiveIntegerInputProps,
  sanitizeJanInput,
} from "@/lib/mobile-input";
import {
  clearStoredReceiptDefaults,
  readStoredReceiptDefaults,
  writeStoredReceiptDefaults,
} from "@/lib/receipt-defaults";

type ProductLookup = {
  id: string;
  name: string;
  spec: string;
  janCode: string;
  alertDays: number[];
  inventorySummary: {
    totalQuantity: number;
    activeLotCount: number;
    earliestExpiry: string | null;
    earliestLotId: string | null;
    bucket: "expired" | "today" | "within7" | "within30" | "safe" | null;
  };
} | null;

type LookupState =
  | { status: "idle"; janCode: string }
  | { status: "pending"; janCode: string }
  | { status: "resolved"; janCode: string; product: NonNullable<ProductLookup> }
  | { status: "missing"; janCode: string }
  | { status: "error"; janCode: string; message: string };

type RecentScanEntry = {
  janCode: string;
  name?: string;
  spec?: string;
  productId?: string;
};

const recentScanStorageKey = "otc-checker:recent-scans";

function normalizeRecentScanEntry(value: unknown): RecentScanEntry | null {
  if (typeof value === "string") {
    const janCode = normalizeJanCode(value);

    return janCode ? { janCode } : null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const janCode = normalizeJanCode(typeof candidate.janCode === "string" ? candidate.janCode : "");

  if (!janCode) {
    return null;
  }

  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  const spec = typeof candidate.spec === "string" ? candidate.spec.trim() : "";

  const productId = typeof candidate.productId === "string" ? candidate.productId.trim() : "";

  return {
    janCode,
    ...(name ? { name } : {}),
    ...(spec ? { spec } : {}),
    ...(productId ? { productId } : {}),
  };
}

function ScanPageContent() {
  const searchParams = useSearchParams();
  const [janCode, setJanCode] = useState("");
  const [lookupState, setLookupState] = useState<LookupState>({
    status: "idle",
    janCode: "",
  });
  const [name, setName] = useState("");
  const [spec, setSpec] = useState("");
  const [expiryDate, setExpiryDate] = useState(() => readStoredReceiptDefaults().expiryDate);
  const [quantity, setQuantity] = useState(() => String(readStoredReceiptDefaults().quantity));
  const [message, setMessage] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastSubmittedDraft, setLastSubmittedDraft] = useState<{
    janCode: string;
    name: string;
    spec: string;
  } | null>(null);
  const [lastSavedProduct, setLastSavedProduct] = useState<{
    id: string;
    janCode: string;
    name: string;
    spec: string;
    quantity: number;
    expiryDate: string;
    currentQuantity?: number;
    lotId?: string;
  } | null>(null);
  const [recentScans, setRecentScans] = useState<RecentScanEntry[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }

    const saved = window.localStorage.getItem(recentScanStorageKey);

    if (!saved) {
      return [];
    }

    try {
      const parsed = JSON.parse(saved) as unknown;

      if (!Array.isArray(parsed)) {
        window.localStorage.removeItem(recentScanStorageKey);
        return [];
      }

      return parsed
        .map((item) => normalizeRecentScanEntry(item))
        .filter((item): item is RecentScanEntry => item !== null)
        .slice(0, 5);
    } catch {
      window.localStorage.removeItem(recentScanStorageKey);
      return [];
    }
  });
  const isOnline = useOnlineStatus();
  const lookupJanCodeRef = useRef("");
  const appliedPrefillRef = useRef(false);
  const guidedFocusJanCodeRef = useRef<string | null>(null);
  const janInputRef = useRef<HTMLInputElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const expiryDateInputRef = useRef<HTMLInputElement | null>(null);
  const quantityInputRef = useRef<HTMLInputElement | null>(null);
  const normalizedJanCode = normalizeJanCode(janCode);
  const parsedQuantity = parsePositiveIntegerInput(quantity);
  const quickQuantityPresets = useMemo(() => {
    const currentQuantity = parsedQuantity ?? 1;

    return Array.from(new Set<number>([...quantityPresets, currentQuantity])).sort((a, b) => a - b);
  }, [parsedQuantity]);
  const isJanComplete = /^\d{8,14}$/.test(normalizedJanCode);
  const currentLookupMatchesJan = lookupState.janCode === normalizedJanCode;
  const product =
    lookupState.status === "resolved" && currentLookupMatchesJan
      ? lookupState.product
      : null;
  const isLookupPending =
    isOnline &&
    isJanComplete &&
    lookupState.status === "pending" &&
    currentLookupMatchesJan;
  const lookupError =
    lookupState.status === "error" && currentLookupMatchesJan
      ? lookupState.message
      : "";
  const requiresManualDetails =
    isJanComplete &&
    lookupState.status === "missing" &&
    currentLookupMatchesJan;
  const canSubmit =
    isOnline &&
    !isSubmitting &&
    isJanComplete &&
    Boolean(expiryDate) &&
    parsedQuantity !== null &&
    !isLookupPending &&
    !lookupError &&
    (Boolean(product) || (requiresManualDetails && Boolean(name.trim()) && Boolean(spec.trim())));
  const selectedExpiryMeta = expiryDate ? getExpiryStatusMeta(expiryDate) : null;
  const inventoryExpiryMeta = product?.inventorySummary.earliestExpiry
    ? getExpiryStatusMeta(product.inventorySummary.earliestExpiry)
    : null;

  function resetLookupForJan(value: string) {
    const nextNormalized = normalizeJanCode(value);

    setLookupState(
      nextNormalized.length >= 8 && isOnline
        ? { status: "pending", janCode: nextNormalized }
        : { status: "idle", janCode: nextNormalized },
    );
    setName("");
    setSpec("");
    setSubmitError("");
  }

  function handleJanChange(value: string, recentScan?: RecentScanEntry) {
    const nextValue = sanitizeJanInput(value);
    const nextNormalized = normalizeJanCode(nextValue);

    setJanCode(nextValue);
    setMessage("");

    if (recentScan && nextNormalized) {
      setName(recentScan.name ?? "");
      setSpec(recentScan.spec ?? "");
    }

    if (nextNormalized !== normalizedJanCode) {
      resetLookupForJan(nextValue);

      if (recentScan && nextNormalized) {
        setName(recentScan.name ?? "");
        setSpec(recentScan.spec ?? "");
      }
    }
  }

  function clearJanInput() {
    setJanCode("");
    setLookupState({ status: "idle", janCode: "" });
    setName("");
    setSpec("");
    setMessage("");
    setSubmitError("");
    setLastSavedProduct(null);
  }

  function pushRecentScan(entry: RecentScanEntry) {
    const normalizedEntry = normalizeRecentScanEntry(entry);

    if (!normalizedEntry) {
      return;
    }

    setRecentScans((current) => {
      const currentEntry = current.find((item) => item.janCode === normalizedEntry.janCode);
      const nextEntry = {
        ...currentEntry,
        ...normalizedEntry,
      };
      const next = [nextEntry, ...current.filter((item) => item.janCode !== nextEntry.janCode)].slice(0, 5);
      window.localStorage.setItem(recentScanStorageKey, JSON.stringify(next));
      return next;
    });
  }

  function clearReceiptDefaults() {
    setExpiryDate("");
    setQuantity("1");
    clearStoredReceiptDefaults();
  }

  function clearRecentScans() {
    setRecentScans([]);

    if (typeof window !== "undefined") {
      window.localStorage.removeItem(recentScanStorageKey);
    }
  }

  function removeRecentScan(janCode: string) {
    setRecentScans((current) => {
      const next = current.filter((item) => item.janCode !== janCode);

      if (typeof window !== "undefined") {
        if (next.length > 0) {
          window.localStorage.setItem(recentScanStorageKey, JSON.stringify(next));
        } else {
          window.localStorage.removeItem(recentScanStorageKey);
        }
      }

      return next;
    });
  }

  useEffect(() => {
    writeStoredReceiptDefaults(expiryDate, parsedQuantity ?? 1);
  }, [expiryDate, parsedQuantity]);

  useEffect(() => {
    if (!isSubmitting && !janCode) {
      janInputRef.current?.focus();
    }
  }, [isSubmitting, janCode]);

  useEffect(() => {
    if (appliedPrefillRef.current) {
      return;
    }

    const prefillJan = normalizeJanCode(searchParams.get("jan") ?? "");
    const prefillName = searchParams.get("name") ?? "";
    const prefillSpec = searchParams.get("spec") ?? "";
    const prefillExpiryDate = searchParams.get("expiryDate") ?? "";
    const prefillQuantityRaw = searchParams.get("quantity") ?? "";
    const prefillQuantity = parsePositiveIntegerInput(prefillQuantityRaw);

    if (!prefillJan && !prefillName && !prefillSpec && !prefillExpiryDate && !prefillQuantityRaw) {
      appliedPrefillRef.current = true;
      return;
    }

    appliedPrefillRef.current = true;

    if (prefillJan) {
      setJanCode(prefillJan);
      setLookupState(
        isOnline
          ? { status: "pending", janCode: prefillJan }
          : { status: "idle", janCode: prefillJan },
      );
    }

    if (prefillName) {
      setName(prefillName);
    }

    if (prefillSpec) {
      setSpec(prefillSpec);
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(prefillExpiryDate)) {
      setExpiryDate(prefillExpiryDate);
    }

    if (prefillQuantity !== null) {
      setQuantity(String(prefillQuantity));
    }
  }, [isOnline, searchParams]);

  useEffect(() => {
    if (!isOnline) {
      lookupJanCodeRef.current = "";
      setLookupState({ status: "idle", janCode: normalizedJanCode });
      return;
    }

    if (!isJanComplete) {
      lookupJanCodeRef.current = "";
      setLookupState({ status: "idle", janCode: normalizedJanCode });
      return;
    }

    const code = normalizedJanCode;
    const controller = new AbortController();

    lookupJanCodeRef.current = code;
    setLookupState((current) =>
      current.status === "pending" && current.janCode === code
        ? current
        : { status: "pending", janCode: code },
    );

    fetchJson<ProductLookup>(`/api/products/jan/${code}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (lookupJanCodeRef.current !== code) {
          return;
        }

        if (result) {
          setLookupState({
            status: "resolved",
            janCode: code,
            product: result,
          });
          setName(result.name);
          setSpec(result.spec);
          pushRecentScan({
            janCode: code,
            name: result.name,
            spec: result.spec,
            productId: result.id,
          });
          // Auto-focus quantity field after product lookup succeeds
          quantityInputRef.current?.focus();
        } else {
          setLookupState({ status: "missing", janCode: code });
          // Auto-focus name field for new product registration
          nameInputRef.current?.focus();
        }
      })
      .catch((cause) => {
        if (controller.signal.aborted || lookupJanCodeRef.current !== code) {
          return;
        }

        setLookupState({
          status: "error",
          janCode: code,
          message: cause.message,
        });
      });

    return () => {
      controller.abort();
    };
  }, [isJanComplete, isOnline, normalizedJanCode]);

  useRefreshOnForeground(() => {
    if (!isOnline || !isJanComplete) {
      return;
    }

    const code = normalizedJanCode;
    lookupJanCodeRef.current = code;

    fetchJson<ProductLookup>(`/api/products/jan/${code}`)
      .then((result) => {
        if (lookupJanCodeRef.current !== code) {
          return;
        }

        if (result) {
          setLookupState({
            status: "resolved",
            janCode: code,
            product: result,
          });
          setName(result.name);
          setSpec(result.spec);
          pushRecentScan({
            janCode: code,
            name: result.name,
            spec: result.spec,
            productId: result.id,
          });
          return;
        }

        setLookupState({ status: "missing", janCode: code });
      })
      .catch((cause) => {
        if (lookupJanCodeRef.current !== code) {
          return;
        }

        setLookupState({
          status: "error",
          janCode: code,
          message: (cause as Error).message,
        });
      });
  });

  useEffect(() => {
    if (
      !isOnline ||
      !isJanComplete ||
      !currentLookupMatchesJan ||
      (lookupState.status !== "resolved" && lookupState.status !== "missing")
    ) {
      guidedFocusJanCodeRef.current = null;
      return;
    }

    if (guidedFocusJanCodeRef.current === normalizedJanCode) {
      return;
    }

    const nextTarget =
      lookupState.status === "missing"
        ? nameInputRef.current
        : !expiryDate
          ? expiryDateInputRef.current
          : null;

    if (!nextTarget) {
      return;
    }

    guidedFocusJanCodeRef.current = normalizedJanCode;

    const frameId = window.requestAnimationFrame(() => {
      nextTarget.focus();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [
    currentLookupMatchesJan,
    expiryDate,
    isJanComplete,
    isOnline,
    lookupState.status,
    normalizedJanCode,
  ]);

  function restoreLastSubmittedDraft() {
    if (!lastSubmittedDraft) {
      return;
    }

    setJanCode(lastSubmittedDraft.janCode);
    setName(lastSubmittedDraft.name);
    setSpec(lastSubmittedDraft.spec);
    setLookupState(
      isOnline
        ? { status: "pending", janCode: lastSubmittedDraft.janCode }
        : { status: "idle", janCode: lastSubmittedDraft.janCode },
    );
    setMessage("");
    setSubmitError("");
    setLastSavedProduct(null);
  }

  function handleQuantityKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || !canSubmit) {
      return;
    }

    event.preventDefault();
    void submit();
  }

  async function submit() {
    if (parsedQuantity === null) {
      setSubmitError("数量は1以上の整数で入力してください。");
      setMessage("");
      return;
    }

    try {
      setIsSubmitting(true);
      setSubmitError("");
      setMessage("");
      const code = normalizedJanCode;

      let recentProductId = product?.id ?? "";
      let savedLotId = "";
      const savedProductName = product?.name ?? name;
      const savedProductSpec = product?.spec ?? spec;

      if (product?.id) {
        const savedLot = await postJson<{ id: string }>("/api/lots", {
          productId: product.id,
          expiryDate,
          quantity: parsedQuantity,
        });
        savedLotId = savedLot.id;
      } else {
        const createdProduct = await postJson<{ id: string; lotId?: string }>("/api/products", {
          janCode: code,
          name,
          spec,
          initialLot: {
            expiryDate,
            quantity: parsedQuantity,
          },
        });
        recentProductId = createdProduct.id;
        savedLotId = createdProduct.lotId ?? "";
      }

      setLastSubmittedDraft({
        janCode: code,
        name: savedProductName,
        spec: savedProductSpec,
      });
      if (recentProductId) {
        setLastSavedProduct({
          id: recentProductId,
          janCode: code,
          name: savedProductName,
          spec: savedProductSpec,
          quantity: parsedQuantity,
          expiryDate,
          currentQuantity:
            (product?.inventorySummary.totalQuantity ?? 0) + parsedQuantity,
          ...(savedLotId ? { lotId: savedLotId } : {}),
        });
      }
      pushRecentScan({
        janCode: code,
        name: savedProductName,
        spec: savedProductSpec,
        ...(recentProductId ? { productId: recentProductId } : {}),
      });
      setMessage(
        product
          ? "既存SKUへ入荷登録しました。必要なら在庫詳細で反映を確認してください。"
          : "新規SKUを作成して入荷登録しました。",
      );
      setJanCode("");
      setLookupState({ status: "idle", janCode: "" });
      setName("");
      setSpec("");
      window.requestAnimationFrame(() => {
        janInputRef.current?.focus();
      });
    } catch (cause) {
      setSubmitError((cause as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  }

  const lookupTone =
    !isOnline
      ? "warning"
      : isLookupPending
        ? "info"
        : product
          ? "info"
          : lookupError
            ? "danger"
            : requiresManualDetails
              ? "neutral"
              : "neutral";
  const lookupLabel =
    !isOnline
      ? "照会停止中"
      : isLookupPending
        ? "JAN照会中"
        : product
          ? "既存SKU"
          : lookupError
            ? "照会エラー"
            : requiresManualDetails
              ? "新規SKU候補"
              : "JAN入力待ち";
  const helperText = !isOnline
    ? "オフライン中は閲覧のみです。登録するには接続を回復してください。"
    : !normalizedJanCode
      ? "JANコードを入力すると商品を照会します。"
      : !isJanComplete
        ? "JANコードは数字のみ8〜14桁で入力してください。"
        : isLookupPending
          ? "現在のJANに一致する商品を確認しています。完了まで登録はできません。"
          : product
            ? "既存 SKU を読み込み済みです。"
            : lookupError
              ? "JAN照会に失敗しました。入力を確認して再試行してください。"
              : "未登録 SKU の場合は商品名と規格を入力してください。";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Scan"
        title="バーコードから即登録"
        description="iPhone カメラまたは JAN 手入力で SKU を引き当て、賞味期限と数量をそのまま登録します。"
      />

      <Card className="space-y-4">
        <CardTitle>カメラ読取</CardTitle>
        <CardDescription>iPhone Safari は zxing 経由で読み取ります。権限がない場合は下の手入力を使います。</CardDescription>
        <BarcodeScanner
          disabled={!isOnline || isSubmitting}
          onDetected={(value) => {
            const normalized = normalizeJanCode(value);
            handleJanChange(normalized);
            pushRecentScan({ janCode: normalized });
          }}
        />
      </Card>

      <Card className="space-y-4">
        <CardTitle>登録フォーム</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Badge tone={isOnline ? "success" : "warning"}>
            {isOnline ? "オンライン" : "オフライン"}
          </Badge>
          <Badge tone={lookupTone}>{lookupLabel}</Badge>
        </div>
        <div className="grid gap-3">
          <div className="flex items-center gap-2">
            <Input
              ref={janInputRef}
              disabled={isSubmitting}
              {...janInputProps}
              enterKeyHint="next"
              value={janCode}
              onChange={(event) => handleJanChange(event.target.value)}
              placeholder="JANコード"
            />
            {janCode ? (
              <button
                type="button"
                disabled={isSubmitting}
                className="inline-flex h-12 shrink-0 items-center justify-center rounded-full bg-slate-100 px-4 text-sm font-medium text-slate-700 disabled:opacity-50"
                onClick={clearJanInput}
              >
                クリア
              </button>
            ) : null}
          </div>
          <Input
            ref={nameInputRef}
            disabled={!isOnline || isSubmitting || isLookupPending || Boolean(product)}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="商品名"
          />
          <Input
            disabled={!isOnline || isSubmitting || isLookupPending || Boolean(product)}
            value={spec}
            onChange={(event) => setSpec(event.target.value)}
            placeholder="規格"
          />
          <div className="space-y-2">
            <Input
              ref={expiryDateInputRef}
              disabled={!isOnline || isSubmitting}
              type="date"
              value={expiryDate}
              onChange={(event) => setExpiryDate(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {receiptExpiryPresets.map((preset) => {
                const nextDate = addDaysToDateKey(todayJstKey(), preset.days);

                return (
                  <button
                    key={preset.label}
                    type="button"
                    disabled={!isOnline || isSubmitting}
                    className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
                    onClick={() => setExpiryDate(nextDate)}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              disabled={!isOnline || isSubmitting}
              variant="secondary"
              onClick={() =>
                setQuantity(String(Math.max(1, coercePositiveIntegerInput(quantity) - 1)))
              }
            >
              -
            </Button>
            <Input
              ref={quantityInputRef}
              disabled={!isOnline || isSubmitting}
              className="text-center"
              {...positiveIntegerInputProps}
              enterKeyHint={canSubmit ? "send" : "done"}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              onKeyDown={handleQuantityKeyDown}
            />
            <Button
              disabled={!isOnline || isSubmitting}
              variant="secondary"
              onClick={() => setQuantity(String(coercePositiveIntegerInput(quantity) + 1))}
            >
              +
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {quickQuantityPresets.map((preset) => (
              <button
                key={`scan-qty-${preset}`}
                type="button"
                disabled={!isOnline || isSubmitting}
                className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
                onClick={() => setQuantity(String(preset))}
              >
                {preset}個
              </button>
            ))}
          </div>
        </div>
        <p className="text-sm text-slate-500">{helperText}</p>
        {product ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 text-sm text-emerald-950">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">既存在庫の状況</p>
                <p className="mt-1">
                  {product.name} / {product.spec}
                </p>
              </div>
              <Badge
                tone={inventoryExpiryMeta?.tone ?? "success"}
              >
                {product.inventorySummary.bucket === "expired"
                  ? "期限切れあり"
                  : product.inventorySummary.bucket === "today"
                    ? "本日期限あり"
                    : product.inventorySummary.bucket === "within7"
                      ? "7日以内あり"
                      : product.inventorySummary.bucket === "within30"
                        ? "30日以内あり"
                        : "安全在庫"}
              </Badge>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-emerald-900/90">
              <p>現在庫: {product.inventorySummary.totalQuantity}個</p>
              <p>有効ロット: {product.inventorySummary.activeLotCount}件</p>
              <p className="col-span-2">
                最短期限: {product.inventorySummary.earliestExpiry ?? "登録なし"}
                {inventoryExpiryMeta ? ` (${inventoryExpiryMeta.relativeLabel})` : ""}
              </p>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <Link
                className="inline-flex h-11 w-full items-center justify-center rounded-full bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.99]"
                href={`/inventory/${product.id}`}
              >
                在庫詳細
              </Link>
              <Link
                className="inline-flex h-11 w-full items-center justify-center rounded-full bg-white/90 px-4 py-3 text-sm font-semibold text-emerald-900 ring-1 ring-emerald-200 transition active:scale-[0.99]"
                href={`/inventory/${product.id}#manual-receipt`}
              >
                手動入荷
              </Link>
              {product.inventorySummary.earliestLotId ? (
                <Link
                  className="inline-flex h-11 w-full items-center justify-center rounded-full bg-white/90 px-4 py-3 text-sm font-semibold text-emerald-900 ring-1 ring-emerald-200 transition active:scale-[0.99]"
                  href={`/inventory/${product.id}#lot-${product.inventorySummary.earliestLotId}`}
                >
                  最短ロット
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
        {selectedExpiryMeta ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-3 text-sm text-slate-700">
            <div className="flex items-center justify-between gap-3">
              <p>
                今回の期限: {expiryDate} ({selectedExpiryMeta.relativeLabel})
              </p>
              <Badge tone={selectedExpiryMeta.tone}>{selectedExpiryMeta.shortLabel}</Badge>
            </div>
          </div>
        ) : null}
        {lastSavedProduct && !janCode ? (
          <div className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 text-sm text-emerald-950">
            <div className="space-y-1">
              <p className="font-semibold">直前の登録を確認</p>
              <p>
                {lastSavedProduct.name} / {lastSavedProduct.spec}
              </p>
              <p className="text-emerald-900/80">
                JAN {lastSavedProduct.janCode} に {lastSavedProduct.quantity} 個を反映しました。
              </p>
              {typeof lastSavedProduct.currentQuantity === "number" ? (
                <p className="text-emerald-900/80">
                  反映後の在庫: {lastSavedProduct.currentQuantity} 個
                </p>
              ) : null}
              <p className="text-emerald-900/80">今回の期限: {lastSavedProduct.expiryDate}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Link
                className="inline-flex h-11 w-full items-center justify-center rounded-full bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.99]"
                href={`/inventory/${lastSavedProduct.id}`}
              >
                在庫詳細を開く
              </Link>
              {lastSavedProduct.lotId ? (
                <Link
                  className="inline-flex h-11 w-full items-center justify-center rounded-full bg-white/90 px-4 py-3 text-sm font-semibold text-emerald-900 ring-1 ring-emerald-200 transition active:scale-[0.99]"
                  href={`/inventory/${lastSavedProduct.id}#lot-${lastSavedProduct.lotId}`}
                >
                  今回のロットへ
                </Link>
              ) : null}
              <button
                type="button"
                disabled={isSubmitting}
                className="inline-flex h-11 w-full items-center justify-center rounded-full bg-white/90 px-4 py-3 text-sm font-semibold text-emerald-900 ring-1 ring-emerald-200 transition active:scale-[0.99] disabled:opacity-50"
                onClick={restoreLastSubmittedDraft}
              >
                同じ商品を続けて登録
              </button>
            </div>
          </div>
        ) : null}
        {(expiryDate || (parsedQuantity ?? 1) > 1) ? (
          <div className="rounded-2xl bg-emerald-50/80 p-3 text-sm text-emerald-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">前回の入荷条件を保持中</p>
                <p className="mt-1">
                  期限日 {expiryDate || "未設定"} / 数量 {parsedQuantity ?? 1}個
                </p>
              </div>
              <button
                type="button"
                disabled={!isOnline || isSubmitting}
                className="rounded-full bg-white/80 px-3 py-1.5 text-xs font-medium text-emerald-900 ring-1 ring-emerald-200 disabled:opacity-50"
                onClick={clearReceiptDefaults}
              >
                保持をクリア
              </button>
            </div>
          </div>
        ) : null}
        <Button className="w-full" disabled={!canSubmit} onClick={submit}>
          {isSubmitting ? "登録中..." : isLookupPending ? "JAN照会中..." : "登録する"}
        </Button>
        {!canSubmit && janCode.trim() && !isSubmitting ? (
          <p className="text-sm text-slate-500">
            {!expiryDate ? "期限日を入力"
              : parsedQuantity === null ? "数量を1以上で入力"
              : requiresManualDetails && !name.trim() ? "商品名を入力"
              : requiresManualDetails && !spec.trim() ? "規格を入力"
              : "入力内容を確認中..."}
          </p>
        ) : null}
        {lastSubmittedDraft && !lastSavedProduct && !janCode ? (
          <Button className="w-full" variant="secondary" disabled={isSubmitting} onClick={restoreLastSubmittedDraft}>
            同じ商品でもう一件
          </Button>
        ) : null}
        {message ? <p className="text-sm text-[var(--color-success)]">{message}</p> : null}
        {lookupError ? <p className="text-sm text-[var(--color-danger)]">{lookupError}</p> : null}
        {submitError ? <p className="text-sm text-[var(--color-danger)]">{submitError}</p> : null}
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>直近読取履歴</CardTitle>
            <CardDescription>タップで JAN を再入力します。</CardDescription>
          </div>
          {recentScans.length ? (
            <button
              type="button"
              disabled={isSubmitting}
              className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
              onClick={clearRecentScans}
            >
              履歴をクリア
            </button>
          ) : null}
        </div>
        {!recentScans.length ? (
          <p className="text-sm text-slate-500">まだ読取履歴はありません。</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {recentScans.map((item) => (
              <div
                className="inline-flex items-center overflow-hidden rounded-2xl bg-slate-100 text-sm font-medium text-slate-700"
                key={item.janCode}
              >
                <button
                  className="px-4 py-2 text-left"
                  disabled={isSubmitting}
                  onClick={() => handleJanChange(item.janCode, item)}
                  type="button"
                >
                  <span className="block text-sm font-semibold text-slate-800">
                    {item.name || item.janCode}
                  </span>
                  <span className="block text-xs font-normal text-slate-500">
                    {item.name ? `${item.spec ? `${item.spec} / ` : ""}JAN ${item.janCode}` : "JANコードを再入力"}
                  </span>
                </button>
                {item.productId ? (
                  <Link
                    aria-label={`${item.name || item.janCode}の在庫詳細を開く`}
                    className="border-l border-slate-200 px-3 py-2 text-xs font-semibold text-[var(--color-brand)] transition active:scale-[0.99]"
                    href={`/inventory/${item.productId}`}
                  >
                    在庫
                  </Link>
                ) : null}
                <button
                  aria-label={`${item.janCode} を履歴から削除`}
                  className="border-l border-slate-200 px-3 py-2 text-slate-500 transition active:scale-[0.99]"
                  disabled={isSubmitting}
                  onClick={() => removeRecentScan(item.janCode)}
                  type="button"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export default function ScanPage() {
  return (
    <Suspense fallback={<div className="space-y-6" />}>
      <ScanPageContent />
    </Suspense>
  );
}

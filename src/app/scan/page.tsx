"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { BarcodeScanner } from "@/components/scan/barcode-scanner";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { fetchJson, postJson } from "@/lib/client";
import { normalizeJanCode } from "@/lib/csv";
import { addDaysToDateKey, todayJstKey } from "@/lib/date";
import {
  coercePositiveIntegerInput,
  janInputProps,
  parsePositiveIntegerInput,
  positiveIntegerInputProps,
  sanitizeJanInput,
} from "@/lib/mobile-input";

type ProductLookup = {
  id: string;
  name: string;
  spec: string;
  janCode: string;
  alertDays: number[];
} | null;

type LookupState =
  | { status: "idle"; janCode: string }
  | { status: "pending"; janCode: string }
  | { status: "resolved"; janCode: string; product: NonNullable<ProductLookup> }
  | { status: "missing"; janCode: string }
  | { status: "error"; janCode: string; message: string };

const recentScanStorageKey = "otc-checker:recent-scans";
const receiptDefaultsStorageKey = "otc-checker:scan-receipt-defaults";
const expiryPresets = [
  { label: "今日", days: 0 },
  { label: "+30日", days: 30 },
  { label: "+90日", days: 90 },
  { label: "+180日", days: 180 },
] as const;

const quantityPresets = [1, 3, 5, 10] as const;

function readStoredReceiptDefaults() {
  if (typeof window === "undefined") {
    return { expiryDate: "", quantity: "1" };
  }

  try {
    const saved = window.localStorage.getItem(receiptDefaultsStorageKey);

    if (!saved) {
      return { expiryDate: "", quantity: "1" };
    }

    const parsed = JSON.parse(saved) as { expiryDate?: string; quantity?: number };

    return {
      expiryDate: typeof parsed.expiryDate === "string" ? parsed.expiryDate : "",
      quantity:
        typeof parsed.quantity === "number" && parsed.quantity > 0
          ? String(parsed.quantity)
          : "1",
    };
  } catch {
    window.localStorage.removeItem(receiptDefaultsStorageKey);
    return { expiryDate: "", quantity: "1" };
  }
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
  const [quantity, setQuantity] = useState(() => readStoredReceiptDefaults().quantity);
  const [message, setMessage] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recentScans, setRecentScans] = useState<string[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }

    const saved = window.localStorage.getItem(recentScanStorageKey);

    if (!saved) {
      return [];
    }

    try {
      return JSON.parse(saved) as string[];
    } catch {
      window.localStorage.removeItem(recentScanStorageKey);
      return [];
    }
  });
  const isOnline = useOnlineStatus();
  const lookupJanCodeRef = useRef("");
  const appliedPrefillRef = useRef(false);
  const normalizedJanCode = normalizeJanCode(janCode);
  const parsedQuantity = parsePositiveIntegerInput(quantity);
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

  function handleJanChange(value: string) {
    const nextValue = sanitizeJanInput(value);
    const nextNormalized = normalizeJanCode(nextValue);

    setJanCode(nextValue);
    setMessage("");

    if (nextNormalized !== normalizedJanCode) {
      resetLookupForJan(nextValue);
    }
  }

  function pushRecentScan(value: string) {
    setRecentScans((current) => {
      const next = [value, ...current.filter((item) => item !== value)].slice(0, 5);
      window.localStorage.setItem(recentScanStorageKey, JSON.stringify(next));
      return next;
    });
  }

  function clearReceiptDefaults() {
    setExpiryDate("");
    setQuantity("1");

    if (typeof window !== "undefined") {
      window.localStorage.removeItem(receiptDefaultsStorageKey);
    }
  }

  function clearRecentScans() {
    setRecentScans([]);

    if (typeof window !== "undefined") {
      window.localStorage.removeItem(recentScanStorageKey);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      receiptDefaultsStorageKey,
      JSON.stringify({
        expiryDate,
        quantity: parsedQuantity ?? 1,
      }),
    );
  }, [expiryDate, parsedQuantity]);

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
        } else {
          setLookupState({ status: "missing", janCode: code });
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

      if (product?.id) {
        await postJson("/api/lots", {
          productId: product.id,
          expiryDate,
          quantity: parsedQuantity,
        });
      } else {
        await postJson<{ id: string }>("/api/products", {
          janCode: code,
          name,
          spec,
          initialLot: {
            expiryDate,
            quantity: parsedQuantity,
          },
        });
      }

      pushRecentScan(code);
      setMessage(product ? "既存SKUへ入荷登録しました。" : "新規SKUを作成して入荷登録しました。");
      setJanCode("");
      setLookupState({ status: "idle", janCode: "" });
      setName("");
      setSpec("");
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
            pushRecentScan(normalized);
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
          <Input
            disabled={isSubmitting}
            {...janInputProps}
            enterKeyHint="next"
            value={janCode}
            onChange={(event) => handleJanChange(event.target.value)}
            placeholder="JANコード"
          />
          <Input
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
              disabled={!isOnline || isSubmitting}
              type="date"
              value={expiryDate}
              onChange={(event) => setExpiryDate(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {expiryPresets.map((preset) => {
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
              disabled={!isOnline || isSubmitting}
              className="text-center"
              {...positiveIntegerInputProps}
              enterKeyHint="done"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
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
            {quantityPresets.map((preset) => (
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
              <button
                className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700"
                disabled={isSubmitting}
                key={item}
                onClick={() => handleJanChange(item)}
                type="button"
              >
                {item}
              </button>
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

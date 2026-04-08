"use client";

import { useEffect, useRef, useState } from "react";

import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { BarcodeScanner } from "@/components/scan/barcode-scanner";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { fetchJson, postJson } from "@/lib/client";
import { normalizeJanCode } from "@/lib/csv";

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

function readStoredReceiptDefaults() {
  if (typeof window === "undefined") {
    return { expiryDate: "", quantity: 1 };
  }

  try {
    const saved = window.localStorage.getItem(receiptDefaultsStorageKey);

    if (!saved) {
      return { expiryDate: "", quantity: 1 };
    }

    const parsed = JSON.parse(saved) as { expiryDate?: string; quantity?: number };

    return {
      expiryDate: typeof parsed.expiryDate === "string" ? parsed.expiryDate : "",
      quantity: typeof parsed.quantity === "number" && parsed.quantity > 0 ? parsed.quantity : 1,
    };
  } catch {
    window.localStorage.removeItem(receiptDefaultsStorageKey);
    return { expiryDate: "", quantity: 1 };
  }
}

export default function ScanPage() {
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
  const normalizedJanCode = normalizeJanCode(janCode);
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
    quantity > 0 &&
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
    const nextNormalized = normalizeJanCode(value);

    setJanCode(value);
    setMessage("");

    if (nextNormalized !== normalizedJanCode) {
      resetLookupForJan(value);
    }
  }

  function pushRecentScan(value: string) {
    setRecentScans((current) => {
      const next = [value, ...current.filter((item) => item !== value)].slice(0, 5);
      window.localStorage.setItem(recentScanStorageKey, JSON.stringify(next));
      return next;
    });
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      receiptDefaultsStorageKey,
      JSON.stringify({
        expiryDate,
        quantity,
      }),
    );
  }, [expiryDate, quantity]);

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
          setName("");
          setSpec("");
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
        setName("");
        setSpec("");
      });

    return () => {
      controller.abort();
    };
  }, [isJanComplete, isOnline, normalizedJanCode]);

  async function submit() {
    try {
      setIsSubmitting(true);
      setSubmitError("");
      setMessage("");
      const code = normalizedJanCode;

      let productId = product?.id;

      if (!productId) {
        const created = await postJson<{ id: string }>("/api/products", {
          janCode: code,
          name,
          spec,
        });
        productId = created.id;
      }

      await postJson("/api/lots", {
        productId,
        expiryDate,
        quantity,
      });

      pushRecentScan(code);
      setMessage("入荷登録が完了しました。");
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
          <Input
            disabled={!isOnline || isSubmitting}
            type="date"
            value={expiryDate}
            onChange={(event) => setExpiryDate(event.target.value)}
          />
          <div className="flex items-center gap-3">
            <Button
              disabled={!isOnline || isSubmitting}
              variant="secondary"
              onClick={() => setQuantity((current) => Math.max(1, current - 1))}
            >
              -
            </Button>
            <Input
              disabled={!isOnline || isSubmitting}
              className="text-center"
              type="number"
              value={quantity}
              onChange={(event) => setQuantity(Math.max(1, Number(event.target.value)))}
            />
            <Button
              disabled={!isOnline || isSubmitting}
              variant="secondary"
              onClick={() => setQuantity((current) => current + 1)}
            >
              +
            </Button>
          </div>
        </div>
        <p className="text-sm text-slate-500">{helperText}</p>
        {(expiryDate || quantity > 1) ? (
          <div className="rounded-2xl bg-emerald-50/80 p-3 text-sm text-emerald-900">
            <p className="font-medium">前回の入荷条件を保持中</p>
            <p className="mt-1">
              期限日 {expiryDate || "未設定"} / 数量 {quantity}個
            </p>
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
        <div className="flex items-center justify-between">
          <CardTitle>直近読取履歴</CardTitle>
          <CardDescription>タップで JAN を再入力します。</CardDescription>
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

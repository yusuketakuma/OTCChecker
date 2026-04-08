"use client";

import { useEffect, useState } from "react";

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

const recentScanStorageKey = "otc-checker:recent-scans";

export default function ScanPage() {
  const [janCode, setJanCode] = useState("");
  const [product, setProduct] = useState<ProductLookup>(null);
  const [name, setName] = useState("");
  const [spec, setSpec] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
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

  function handleJanChange(value: string) {
    setJanCode(value);

    if (normalizeJanCode(value).length < 8) {
      setProduct(null);
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
    if (!isOnline) {
      return;
    }

    const code = normalizeJanCode(janCode);

    if (code.length < 8) {
      return;
    }

    fetchJson<ProductLookup>(`/api/products/jan/${code}`)
      .then((result) => {
        setProduct(result);
        if (result) {
          setName(result.name);
          setSpec(result.spec);
        } else {
          setName("");
          setSpec("");
        }
      })
      .catch((cause) => setError(cause.message));
  }, [isOnline, janCode]);

  async function submit() {
    try {
      setError("");
      setMessage("");
      const code = normalizeJanCode(janCode);

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
      setProduct(null);
      setName("");
      setSpec("");
      setExpiryDate("");
      setQuantity(1);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

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
          disabled={!isOnline}
          onDetected={(value) => {
            const normalized = normalizeJanCode(value);
            setJanCode(normalized);
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
          <Badge tone={product ? "info" : "neutral"}>
            {product ? "既存SKU" : "新規SKU候補"}
          </Badge>
        </div>
        <div className="grid gap-3">
          <Input value={janCode} onChange={(event) => handleJanChange(event.target.value)} placeholder="JANコード" />
          <Input disabled={!isOnline} value={name} onChange={(event) => setName(event.target.value)} placeholder="商品名" />
          <Input disabled={!isOnline} value={spec} onChange={(event) => setSpec(event.target.value)} placeholder="規格" />
          <Input disabled={!isOnline} type="date" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} />
          <div className="flex items-center gap-3">
            <Button disabled={!isOnline} variant="secondary" onClick={() => setQuantity((current) => Math.max(1, current - 1))}>
              -
            </Button>
            <Input
              disabled={!isOnline}
              className="text-center"
              type="number"
              value={quantity}
              onChange={(event) => setQuantity(Math.max(1, Number(event.target.value)))}
            />
            <Button disabled={!isOnline} variant="secondary" onClick={() => setQuantity((current) => current + 1)}>
              +
            </Button>
          </div>
        </div>
        <p className="text-sm text-slate-500">
          {product ? "既存 SKU を読み込み済みです。" : "未登録 SKU の場合は商品名と規格を入力してください。"}
        </p>
        <Button className="w-full" disabled={!isOnline} onClick={submit}>
          登録する
        </Button>
        {!isOnline ? (
          <p className="text-sm text-[var(--color-danger)]">
            オフライン中は閲覧のみです。登録するには接続を回復してください。
          </p>
        ) : null}
        {message ? <p className="text-sm text-[var(--color-success)]">{message}</p> : null}
        {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
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
                key={item}
                onClick={() => setJanCode(item)}
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

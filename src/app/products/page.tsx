"use client";

import Link from "next/link";
import { startTransition, useDeferredValue, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fetchJson, postJson } from "@/lib/client";
import {
  janInputProps,
  parsePositiveIntegerInput,
  positiveIntegerInputProps,
  sanitizeJanInput,
} from "@/lib/mobile-input";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { formatLotNumber, formatQuantity } from "@/lib/utils";

type ProductMasterSummary = {
  productId: string;
  name: string;
  spec: string;
  janCode: string;
  alertDays: number[];
  earliestExpiry: string | null;
  totalQuantity: number;
  activeLotCount: number;
  primaryLotId: string | null;
  bucket: "expired" | "within7" | "within30" | "safe" | "outOfStock";
};

export default function ProductsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const isOnline = useOnlineStatus();
  const [items, setItems] = useState<ProductMasterSummary[]>([]);
  const [query, setQuery] = useState(() => {
    if (typeof window === "undefined") {
      return "";
    }

    return new URLSearchParams(window.location.search).get("q") ?? "";
  });
  const [name, setName] = useState("");
  const [spec, setSpec] = useState("");
  const [janCode, setJanCode] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const deferredQuery = useDeferredValue(query);
  const initialLotQuantity = parsePositiveIntegerInput(quantity);

  async function loadProducts(search: string) {
    const data = await fetchJson<ProductMasterSummary[]>(
      `/api/products?mode=master&q=${encodeURIComponent(search)}`,
    );
    setItems(data);
  }

  useEffect(() => {
    const controller = new AbortController();

    fetchJson<ProductMasterSummary[]>(
      `/api/products?mode=master&q=${encodeURIComponent(deferredQuery)}`,
      { signal: controller.signal },
    )
      .then((data) => {
        setItems(data);
        setError("");
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setError(cause.message);
        }
      });

    return () => controller.abort();
  }, [deferredQuery]);

  useEffect(() => {
    const params = new URLSearchParams();

    if (query.trim()) {
      params.set("q", query.trim());
    }

    const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;

    startTransition(() => {
      router.replace(nextUrl, { scroll: false });
    });
  }, [pathname, query, router]);

  async function createProduct() {
    if (expiryDate && initialLotQuantity === null) {
      setError("初回数量は1以上の整数で入力してください。");
      setMessage("");
      return;
    }

    try {
      setCreating(true);
      setError("");
      setMessage("");

      await postJson("/api/products", {
        name,
        spec,
        janCode,
        initialLot: expiryDate
          ? {
              expiryDate,
              quantity: initialLotQuantity!,
            }
          : undefined,
      });

      setName("");
      setSpec("");
      setJanCode("");
      setExpiryDate("");
      setQuantity("1");
      setQuery("");
      setMessage(expiryDate ? "商品と初回ロットを登録しました。" : "商品マスタを登録しました。");
      await loadProducts("");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Products"
        title="商品管理"
        description="在庫ゼロの商品も含めて SKU を管理し、入荷前に商品マスタを先行登録できます。"
      />

      <Card className="space-y-4">
        <CardTitle>商品検索</CardTitle>
        <Input
          placeholder="商品名・JANコードで検索"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>新規商品を追加</CardTitle>
            <CardDescription>商品だけ先に作るか、期限日と数量を入れて初回ロットまで登録できます。</CardDescription>
          </div>
          <Badge tone="neutral">{items.length}件</Badge>
        </div>
        <div className="grid gap-3">
          <Input
            disabled={!isOnline || creating}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="商品名"
          />
          <Input
            disabled={!isOnline || creating}
            value={spec}
            onChange={(event) => setSpec(event.target.value)}
            placeholder="規格"
          />
          <Input
            disabled={!isOnline || creating}
            {...janInputProps}
            enterKeyHint="next"
            value={janCode}
            onChange={(event) => setJanCode(sanitizeJanInput(event.target.value))}
            placeholder="JANコード"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              disabled={!isOnline || creating}
              type="date"
              value={expiryDate}
              onChange={(event) => setExpiryDate(event.target.value)}
            />
            <Input
              {...positiveIntegerInputProps}
              enterKeyHint="done"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              placeholder="初回数量（期限入力時のみ）"
              disabled={!isOnline || creating || !expiryDate}
            />
          </div>
          <p className="text-xs text-slate-500">
            期限を入れない場合は商品マスタのみ登録します。初回在庫を同時登録したいときだけ期限日と数量を入力してください。
          </p>
        </div>
        <Button
          className="w-full"
          disabled={
            !isOnline ||
            creating ||
            !name.trim() ||
            !spec.trim() ||
            !janCode.trim() ||
            (Boolean(expiryDate) && initialLotQuantity === null)
          }
          onClick={createProduct}
        >
          {creating ? "登録中..." : expiryDate ? "商品と初回ロットを追加" : "商品マスタを追加"}
        </Button>
        {!isOnline ? (
          <p className="text-sm text-[var(--color-danger)]">
            オフライン中は商品登録を停止しています。接続回復後に登録してください。
          </p>
        ) : null}
        {message ? <p className="text-sm text-[var(--color-success)]">{message}</p> : null}
        {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
      </Card>

      {!items.length ? (
        <EmptyState
          title="商品が見つかりません"
          description="検索条件を変えるか、新規商品マスタを登録してください。"
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card className="space-y-3" key={item.productId}>
              <Link
                className="block rounded-2xl transition hover:bg-slate-50/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                href={`/inventory/${item.productId}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle>{item.name}</CardTitle>
                    <CardDescription>{item.spec}</CardDescription>
                  </div>
                  <Badge
                    tone={
                      item.bucket === "expired"
                        ? "danger"
                        : item.bucket === "within7"
                          ? "warning"
                          : item.bucket === "within30"
                            ? "info"
                            : item.bucket === "outOfStock"
                              ? "neutral"
                              : "success"
                    }
                  >
                    {item.bucket === "expired"
                      ? "期限切れ"
                      : item.bucket === "within7"
                        ? "7日以内"
                        : item.bucket === "within30"
                          ? "30日以内"
                          : item.bucket === "outOfStock"
                            ? "在庫なし"
                            : "正常"}
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-slate-600">
                  <p className="col-span-2">ロット番号: {item.primaryLotId ? formatLotNumber(item.primaryLotId) : "-"}</p>
                  <p>在庫数: {formatQuantity(item.totalQuantity)}個</p>
                  <p>期限: {item.earliestExpiry ?? "-"}</p>
                  <p className="col-span-2">JAN: {item.janCode}</p>
                </div>
              </Link>
              <div className="grid gap-2 sm:grid-cols-2">
                <Link
                  className="inline-flex h-12 w-full items-center justify-center rounded-full bg-[var(--color-brand)] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-900/15 transition active:scale-[0.99]"
                  href={`/scan?jan=${encodeURIComponent(item.janCode)}&name=${encodeURIComponent(item.name)}&spec=${encodeURIComponent(item.spec)}&quantity=1`}
                >
                  入荷する
                </Link>
                <Link
                  className="inline-flex h-12 w-full items-center justify-center rounded-full bg-white/85 px-4 py-3 text-sm font-semibold text-[var(--color-text)] ring-1 ring-slate-200 transition active:scale-[0.99]"
                  href={`/inventory/${item.productId}`}
                >
                  在庫詳細
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

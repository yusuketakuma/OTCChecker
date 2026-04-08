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
import { formatQuantity } from "@/lib/utils";

type ProductMasterSummary = {
  productId: string;
  name: string;
  spec: string;
  janCode: string;
  alertDays: number[];
  earliestExpiry: string | null;
  totalQuantity: number;
  activeLotCount: number;
  bucket: "expired" | "within7" | "within30" | "safe" | "outOfStock";
};

export default function ProductsPage() {
  const router = useRouter();
  const pathname = usePathname();
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
  const [quantity, setQuantity] = useState(1);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const deferredQuery = useDeferredValue(query);

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
              quantity,
            }
          : undefined,
      });

      setName("");
      setSpec("");
      setJanCode("");
      setExpiryDate("");
      setQuantity(1);
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
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="商品名" />
          <Input value={spec} onChange={(event) => setSpec(event.target.value)} placeholder="規格" />
          <Input value={janCode} onChange={(event) => setJanCode(event.target.value)} placeholder="JANコード" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              type="date"
              value={expiryDate}
              onChange={(event) => setExpiryDate(event.target.value)}
            />
            <Input
              min={1}
              type="number"
              value={quantity}
              onChange={(event) => setQuantity(Math.max(1, Number(event.target.value)))}
              placeholder="初回数量"
            />
          </div>
        </div>
        <Button
          className="w-full"
          disabled={creating || !name.trim() || !spec.trim() || !janCode.trim()}
          onClick={createProduct}
        >
          {creating ? "登録中..." : expiryDate ? "商品と初回ロットを追加" : "商品マスタを追加"}
        </Button>
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
            <Link href={`/inventory/${item.productId}`} key={item.productId}>
              <Card className="space-y-3">
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
                <div className="grid grid-cols-2 gap-3 text-sm text-slate-600">
                  <p>JAN: {item.janCode}</p>
                  <p>アラート: {item.alertDays.join("/")}</p>
                  <p>在庫数: {formatQuantity(item.totalQuantity)}個</p>
                  <p>有効ロット: {item.activeLotCount}件</p>
                  <p className="col-span-2">最短期限: {item.earliestExpiry ?? "-"}</p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { Suspense, startTransition, useDeferredValue, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fetchJson } from "@/lib/client";
import { formatQuantity } from "@/lib/utils";

type InventoryRow = {
  productId: string;
  name: string;
  spec: string;
  janCode: string;
  earliestExpiry: string | null;
  totalQuantity: number;
  activeLotCount: number;
  bucket: "expired" | "within7" | "within30" | "safe";
};

const tabs = [
  { key: "all", label: "全件" },
  { key: "expired", label: "期限切れ" },
  { key: "7d", label: "7日以内" },
  { key: "30d", label: "30日以内" },
] as const;

type InventoryTabKey = (typeof tabs)[number]["key"];

function normalizeBucket(value: string | null): InventoryTabKey {
  return tabs.some((tab) => tab.key === value)
    ? (value as InventoryTabKey)
    : "all";
}

function buildInventorySearchParams(query: string, bucket: InventoryTabKey) {
  const params = new URLSearchParams();

  if (query.trim()) {
    params.set("q", query.trim());
  }

  if (bucket !== "all") {
    params.set("bucket", bucket);
  }

  return params;
}

function InventoryPageContent({
  initialQuery,
  initialBucket,
}: {
  initialQuery: string;
  initialBucket: InventoryTabKey;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<InventoryRow[]>([]);
  const [query, setQuery] = useState(initialQuery);
  const [bucket, setBucket] = useState<InventoryTabKey>(initialBucket);
  const [error, setError] = useState("");
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    const controller = new AbortController();

    fetchJson<InventoryRow[]>(
      `/api/products?q=${encodeURIComponent(deferredQuery)}&bucket=${bucket}`,
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
  }, [deferredQuery, bucket]);

  useEffect(() => {
    const nextParams = buildInventorySearchParams(query, bucket);
    const currentParams = buildInventorySearchParams(
      searchParams.get("q") ?? "",
      normalizeBucket(searchParams.get("bucket")),
    );

    if (nextParams.toString() === currentParams.toString()) {
      return;
    }

    const nextUrl = nextParams.toString() ? `${pathname}?${nextParams.toString()}` : pathname;

    startTransition(() => {
      router.replace(nextUrl, { scroll: false });
    });
  }, [bucket, pathname, query, router, searchParams]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Inventory"
        title="在庫一覧"
        description="商品名・規格・JANで検索し、期限に応じて一覧を絞り込みます。"
      />

      <Card className="space-y-4">
        <Input
          placeholder="商品名・規格・JANコードで検索"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              className={`rounded-full px-4 py-2 text-sm font-medium ${
                bucket === tab.key
                  ? "bg-[var(--color-brand)] text-white"
                  : "bg-slate-100 text-slate-600"
              }`}
              key={tab.key}
              onClick={() => setBucket(tab.key)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </Card>

      {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
      {!items.length ? (
        <EmptyState title="該当する在庫がありません" description="検索条件を変えるか、スキャン画面から入荷登録してください。" />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card className="space-y-3" key={item.productId}>
              <Link
                className="block rounded-2xl transition hover:bg-slate-50/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                href={`/inventory/${item.productId}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>{item.name}</CardTitle>
                    <CardDescription>{item.spec}</CardDescription>
                  </div>
                  <Badge
                    tone={
                      item.bucket === "expired"
                        ? "danger"
                        : item.bucket === "within30"
                          ? "info"
                          : item.bucket === "within7"
                            ? "warning"
                            : "success"
                    }
                  >
                    {item.bucket === "expired"
                      ? "期限切れ"
                      : item.bucket === "within7"
                        ? "7日以内"
                        : item.bucket === "within30"
                          ? "30日以内"
                          : "正常"}
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-slate-600">
                  <p>JAN: {item.janCode}</p>
                  <p>在庫数: {formatQuantity(item.totalQuantity)}個</p>
                  <p>有効ロット: {item.activeLotCount}件</p>
                  <p className="col-span-2">最短期限: {item.earliestExpiry ?? "-"}</p>
                </div>
              </Link>
              <div className="grid gap-2 sm:grid-cols-3">
                <Link
                  aria-label={`${item.name}の入荷登録を開く`}
                  className="inline-flex h-12 w-full items-center justify-center rounded-full bg-[var(--color-brand)] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-900/15 transition active:scale-[0.99]"
                  href={`/scan?jan=${encodeURIComponent(item.janCode)}&name=${encodeURIComponent(item.name)}&spec=${encodeURIComponent(item.spec)}&quantity=1`}
                >
                  入荷する
                </Link>
                <Link
                  aria-label={`${item.name}の売上登録を開く`}
                  className="inline-flex h-12 w-full items-center justify-center rounded-full bg-white/85 px-4 py-3 text-sm font-semibold text-[var(--color-text)] ring-1 ring-slate-200 transition active:scale-[0.99]"
                  href={`/inventory/${item.productId}#manual-sale`}
                >
                  売上登録
                </Link>
                <Link
                  aria-label={`${item.name}の詳細を見る`}
                  className="inline-flex h-12 w-full items-center justify-center rounded-full bg-white/85 px-4 py-3 text-sm font-semibold text-[var(--color-text)] ring-1 ring-slate-200 transition active:scale-[0.99]"
                  href={`/inventory/${item.productId}`}
                >
                  詳細を見る
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function InventoryPageShell() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";
  const initialBucket = normalizeBucket(searchParams.get("bucket"));

  return (
    <InventoryPageContent
      key={`${initialQuery}:${initialBucket}`}
      initialBucket={initialBucket}
      initialQuery={initialQuery}
    />
  );
}

export default function InventoryPage() {
  return (
    <Suspense fallback={<div className="space-y-6" />}>
      <InventoryPageShell />
    </Suspense>
  );
}

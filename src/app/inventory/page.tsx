"use client";

import Link from "next/link";
import { Suspense, startTransition, useDeferredValue, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { FormLabel } from "@/components/ui/form-label";
import { Input } from "@/components/ui/input";
import { useRefreshOnForeground } from "@/hooks/use-refresh-on-foreground";
import { fetchJson } from "@/lib/client";
import { getExpiryStatusMeta } from "@/lib/date";
import { buildScanHref, formatQuantity } from "@/lib/utils";

type InventoryRow = {
  productId: string;
  name: string;
  spec: string;
  janCode: string;
  earliestLotId: string | null;
  earliestExpiry: string | null;
  totalQuantity: number;
  activeLotCount: number;
  bucket: "expired" | "today" | "within7" | "within30" | "safe";
};

const tabs = [
  { key: "all", label: "全件" },
  { key: "expired", label: "期限切れ" },
  { key: "today", label: "本日" },
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
  const [bucket, setBucket] = useState(initialBucket);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const deferredQuery = useDeferredValue(query);
  const activeQuery = query.trim();
  const hasActiveFilters = Boolean(activeQuery) || bucket !== "all";

  useEffect(() => {
    setQuery(initialQuery);
    setBucket(initialBucket);
  }, [initialBucket, initialQuery]);

  async function loadInventory(search: string, nextBucket: InventoryTabKey, signal: AbortSignal) {
    setLoading(true);

    try {
      const data = await fetchJson<InventoryRow[]>(
        `/api/products?q=${encodeURIComponent(search)}&bucket=${nextBucket}`,
        { signal },
      );
      setItems(data);
      setError("");
    } catch (cause) {
      if (!signal.aborted) {
        setError((cause as Error).message);
      }
    } finally {
      if (!signal.aborted) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadInventory(deferredQuery, bucket, controller.signal);

    return () => {
      controller.abort();
    };
  }, [bucket, deferredQuery]);

  useRefreshOnForeground(() => {
    const controller = new AbortController();
    void loadInventory(activeQuery, bucket, controller.signal);

    return () => controller.abort();
  });

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
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>検索と絞り込み</CardTitle>
            <CardDescription>商品名、規格、JANから最短期限順で探せます。</CardDescription>
          </div>
          <Badge tone="neutral">{items.length}件</Badge>
        </div>
        <div className="space-y-3">
          <div className="space-y-2">
            <FormLabel htmlFor="inventory-search">在庫を検索</FormLabel>
            <Input
              aria-label="在庫を検索"
              enterKeyHint="search"
              id="inventory-search"
              placeholder="商品名・規格・JANコード"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {query ? (
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center rounded-full bg-slate-100 px-4 text-sm font-medium text-slate-700 transition active:scale-[0.99]"
              onClick={() => setQuery("")}
            >
              検索をクリア
            </button>
          ) : null}
        </div>
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
        {hasActiveFilters ? (
          <div className="space-y-3 rounded-2xl bg-slate-50/90 p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <span className="font-medium text-[var(--color-text)]">適用中条件</span>
              {activeQuery ? (
                <span className="rounded-full bg-white px-3 py-1 text-xs font-medium ring-1 ring-slate-200">
                  検索: {activeQuery}
                </span>
              ) : null}
              {bucket !== "all" ? (
                <span className="rounded-full bg-white px-3 py-1 text-xs font-medium ring-1 ring-slate-200">
                  期限: {tabs.find((tab) => tab.key === bucket)?.label}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center rounded-full bg-white px-4 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition active:scale-[0.99]"
              onClick={() => {
                setQuery("");
                setBucket("all");
              }}
            >
              条件をリセット
            </button>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            全件表示中です。期限タブや検索で対象を絞り込めます。
          </p>
        )}
      </Card>

      {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
      {loading && items.length ? (
        <div className="flex items-center gap-2 rounded-2xl bg-slate-50 px-4 py-2 text-sm text-slate-500">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-transparent" />
          在庫を再取得しています…
        </div>
      ) : null}
      {loading && !items.length ? (
        <EmptyState title="在庫を読み込み中です" description="商品一覧を取得しています。少し待ってください。" />
      ) : !items.length ? (
        <EmptyState title="該当する在庫がありません" description="検索条件を変えるか、スキャン画面から入荷登録してください。" />
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const expiryMeta = item.earliestExpiry
              ? getExpiryStatusMeta(item.earliestExpiry)
              : null;
            const outOfStock = item.totalQuantity === 0;

            return (
              <Card className={`space-y-3 ${outOfStock ? "opacity-70" : ""}`} key={item.productId}>
              <Link
                className="block rounded-2xl transition hover:bg-slate-50/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                href={`/inventory/${item.productId}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>{item.name}</CardTitle>
                    <CardDescription>{item.spec}</CardDescription>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {outOfStock ? (
                      <Badge tone="neutral">在庫切れ</Badge>
                    ) : (
                      <Badge tone={expiryMeta?.tone ?? "success"}>
                        {expiryMeta?.shortLabel ?? "正常"}
                      </Badge>
                    )}
                    {!outOfStock && expiryMeta ? (
                      <span className="text-xs font-medium text-slate-500">{expiryMeta.relativeLabel}</span>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
                  <span className={`font-semibold ${outOfStock ? "text-slate-400" : "text-[var(--color-text)]"}`}>{outOfStock ? "在庫なし" : `${formatQuantity(item.totalQuantity)}個`}</span>
                  <span className="text-slate-400">|</span>
                  <span>期限 {item.earliestExpiry ?? "-"}</span>
                  <span className="text-slate-400">|</span>
                  <span>{item.activeLotCount}ロット</span>
                  <span className="text-slate-400">|</span>
                  <span className="text-xs tabular-nums text-slate-500">JAN {item.janCode}</span>
                </div>
              </Link>
              <div className="grid gap-2 sm:grid-cols-2">
                <Link
                  aria-label={`${item.name}のスキャン入荷を開く`}
                  className={`inline-flex h-12 w-full items-center justify-center rounded-full px-4 py-3 text-sm font-semibold text-white shadow-lg transition active:scale-[0.99] ${outOfStock ? "bg-amber-600 shadow-amber-900/15" : "bg-[var(--color-brand)] shadow-emerald-900/15"}`}
                  href={buildScanHref({
                    janCode: item.janCode,
                    name: item.name,
                    spec: item.spec,
                  })}
                >
                  {outOfStock ? "入荷登録" : "スキャン入荷"}
                </Link>
                {(item.bucket === "expired" || item.bucket === "today") ? (
                  <Link
                    aria-label={`${item.name}の廃棄登録を開く`}
                    className="inline-flex h-12 w-full items-center justify-center rounded-full bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 ring-1 ring-rose-200 transition active:scale-[0.99]"
                    href={item.earliestLotId ? `/inventory/${item.productId}#lot-${item.earliestLotId}` : `/inventory/${item.productId}`}
                  >
                    廃棄登録
                  </Link>
                ) : (
                  <Link
                    aria-label={`${item.name}の在庫詳細を開く`}
                    className="inline-flex h-12 w-full items-center justify-center rounded-full bg-white/85 px-4 py-3 text-sm font-semibold text-[var(--color-text)] ring-1 ring-slate-200 transition active:scale-[0.99]"
                    href={`/inventory/${item.productId}`}
                  >
                    詳細・売上
                  </Link>
                )}
              </div>
              </Card>
            );
          })}
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

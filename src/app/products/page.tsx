"use client";

import Link from "next/link";
import { Suspense, startTransition, useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { FormLabel } from "@/components/ui/form-label";
import { Input } from "@/components/ui/input";
import { fetchJson, postJson } from "@/lib/client";
import { receiptExpiryPresets, quantityPresets } from "@/lib/presets";
import { addDaysToDateKey, getBucketMeta, todayJstKey } from "@/lib/date";
import {
  clearStoredReceiptDefaults,
  readStoredReceiptDefaults,
  writeStoredReceiptDefaults,
} from "@/lib/receipt-defaults";
import {
  janInputProps,
  parsePositiveIntegerInput,
  positiveIntegerInputProps,
  sanitizeJanInput,
} from "@/lib/mobile-input";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useRefreshOnForeground } from "@/hooks/use-refresh-on-foreground";
import { buildScanHref, formatQuantity } from "@/lib/utils";

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
  canDelete: boolean;
  bucket: "expired" | "today" | "within7" | "within30" | "safe" | "outOfStock";
};

type ProductCreateResult = {
  id: string;
  name: string;
  spec: string;
  janCode: string;
  action: "created" | "created-with-lot" | "existing" | "received-on-existing";
};

type ExistingProductLookup = {
  id: string;
  name: string;
  spec: string;
  janCode: string;
  alertDays: number[];
};

type LastSubmittedProductDraft = {
  name: string;
  spec: string;
};

const productFilters = [
  { key: "all", label: "全件" },
  { key: "attention", label: "期限注意" },
  { key: "stocked", label: "在庫あり" },
  { key: "outOfStock", label: "在庫なし" },
] as const;



type ProductFilterKey = (typeof productFilters)[number]["key"];

function normalizeProductFilter(value: string | null): ProductFilterKey {
  return productFilters.some((filter) => filter.key === value)
    ? (value as ProductFilterKey)
    : "all";
}

function buildProductSearchParams(query: string, filter: ProductFilterKey) {
  const params = new URLSearchParams();

  if (query.trim()) {
    params.set("q", query.trim());
  }

  if (filter !== "all") {
    params.set("filter", filter);
  }

  return params;
}

function ProductsPageContent({
  initialQuery,
  initialFilter,
}: {
  initialQuery: string;
  initialFilter: ProductFilterKey;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isOnline = useOnlineStatus();
  const [items, setItems] = useState<ProductMasterSummary[]>([]);
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<ProductFilterKey>(initialFilter);
  const [name, setName] = useState("");
  const [spec, setSpec] = useState("");
  const [janCode, setJanCode] = useState("");
  const [expiryDate, setExpiryDate] = useState(() => readStoredReceiptDefaults().expiryDate);
  const [quantity, setQuantity] = useState(() => String(readStoredReceiptDefaults().quantity));
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDeleteProductId, setPendingDeleteProductId] = useState<string | null>(null);
  const [existingProduct, setExistingProduct] = useState<ExistingProductLookup | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lastSubmittedDraft, setLastSubmittedDraft] = useState<LastSubmittedProductDraft | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const handledHashRef = useRef<string | null>(null);
  const deferredQuery = useDeferredValue(query);
  const deferredJanCode = useDeferredValue(janCode);
  const initialLotQuantity = parsePositiveIntegerInput(quantity);
  const janCodeValid = /^\d{8,14}$/.test(janCode);

  async function loadProducts(search: string, nextFilter: ProductFilterKey, signal?: AbortSignal) {
    setLoadingItems(true);

    try {
      const data = await fetchJson<ProductMasterSummary[]>(
        `/api/products?mode=master&q=${encodeURIComponent(search)}&filter=${nextFilter}`,
        { signal },
      );
      if (signal?.aborted) return;
      setItems(data);
      setError("");
    } catch (cause) {
      if (signal?.aborted) return;
      setError((cause as Error).message);
    } finally {
      if (!signal?.aborted) setLoadingItems(false);
    }
  }

  function keepFocusOn(targetId: string) {
    if (typeof window === "undefined") {
      return;
    }

    const nextHash = `#${encodeURIComponent(targetId)}`;
    handledHashRef.current = null;

    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", nextHash);
    }
  }

  const scrollToCurrentHash = useCallback(() => {
    if (typeof window === "undefined") {
      return false;
    }

    const hash = window.location.hash;

    if (!hash || hash.length < 2) {
      handledHashRef.current = null;
      return false;
    }

    const targetId = decodeURIComponent(hash.slice(1));
    const target = document.getElementById(targetId);

    if (!target) {
      return false;
    }

    target.scrollIntoView({ block: "start" });
    handledHashRef.current = hash;
    return true;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadProducts(deferredQuery, filter, controller.signal);
    return () => controller.abort();
  }, [deferredQuery, filter]);

  useRefreshOnForeground(() => {
    const controller = new AbortController();
    void loadProducts(query.trim(), filter, controller.signal);
    return () => controller.abort();
  });

  useEffect(() => {
    const nextParams = buildProductSearchParams(query, filter);
    const currentParams = buildProductSearchParams(
      searchParams.get("q") ?? "",
      normalizeProductFilter(searchParams.get("filter")),
    );

    if (nextParams.toString() === currentParams.toString()) {
      return;
    }

    const nextUrl = nextParams.toString() ? `${pathname}?${nextParams.toString()}` : pathname;

    startTransition(() => {
      router.replace(nextUrl, { scroll: false });
    });
  }, [filter, pathname, query, router, searchParams]);

  useEffect(() => {
    writeStoredReceiptDefaults(expiryDate, initialLotQuantity ?? 1);
  }, [expiryDate, initialLotQuantity]);

  useEffect(() => {
    const normalizedJan = sanitizeJanInput(deferredJanCode);

    if (!/^\d{8,14}$/.test(normalizedJan)) {
      setExistingProduct(null);
      setLookupLoading(false);
      return;
    }

    const controller = new AbortController();
    setLookupLoading(true);

    fetchJson<ExistingProductLookup | null>(`/api/products/jan/${normalizedJan}`, {
      signal: controller.signal,
    })
      .then((data) => {
        setExistingProduct(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setExistingProduct(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLookupLoading(false);
        }
      });

    return () => controller.abort();
  }, [deferredJanCode]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

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
  }, [items, scrollToCurrentHash]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

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

  function resetInitialLotDraft(options?: { clearStored?: boolean; message?: string }) {
    setExpiryDate("");
    setQuantity("1");

    if (options?.clearStored) {
      clearStoredReceiptDefaults();
    }

    if (options?.message) {
      setMessage(options.message);
    }

    setError("");
  }

  function clearReceiptDefaults() {
    resetInitialLotDraft({
      clearStored: true,
      message: "入荷条件の保持をクリアしました。",
    });
  }

  function restoreLastSubmittedDraft() {
    if (!lastSubmittedDraft) {
      return;
    }

    setName(lastSubmittedDraft.name);
    setSpec(lastSubmittedDraft.spec);
    setJanCode("");
    setExistingProduct(null);
    setMessage("前回の商品名と規格を戻しました。JANを入れて続けて登録できます。");
    setError("");
  }

  async function createProduct() {
    if (existingProduct && !expiryDate) {
      setError("");
      setMessage("既存商品を開きます。");
      router.push(`/inventory/${existingProduct.id}`);
      return;
    }

    if (expiryDate && initialLotQuantity === null) {
      setError("初回数量は1以上の整数で入力してください。");
      setMessage("");
      return;
    }

    const submittedName = name.trim();
    const submittedSpec = spec.trim();

    try {
      setCreating(true);
      setError("");
      setMessage("");

      const result = await postJson<ProductCreateResult>("/api/products", {
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
      setExistingProduct(null);
      setLastSubmittedDraft(
        submittedName && submittedSpec
          ? { name: submittedName, spec: submittedSpec }
          : null,
      );
      setQuery("");
      setFilter("all");
      setMessage(
        result.action === "created-with-lot"
          ? "商品と初回ロットを登録しました。"
          : result.action === "received-on-existing"
            ? "既存商品へ初回在庫を追加しました。"
            : result.action === "existing"
              ? "同じJANの商品があるため、既存商品を表示しました。"
              : "商品マスタを登録しました。",
      );

      if (result.action === "existing") {
        router.push(`/inventory/${result.id}`);
        return;
      }

      setShowAddForm(false);
      keepFocusOn(`product-${result.id}`);
      await loadProducts("", "all");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function deleteProduct(item: ProductMasterSummary) {
    if (!item.canDelete) {
      setError("ロットが存在する商品は削除できません。");
      return;
    }

    try {
      setDeletingId(item.productId);
      setError("");
      setMessage("");
      await fetchJson(`/api/products/${item.productId}`, {
        method: "DELETE",
      });
      keepFocusOn("products-search");
      setMessage("商品マスタを削除しました。");
      setPendingDeleteProductId(null);
      await loadProducts(query.trim(), filter);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setDeletingId(null);
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
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>商品検索</CardTitle>
            <CardDescription>名前・規格・JANで商品マスタを絞り込みます。</CardDescription>
          </div>
          <Badge tone="neutral">{loadingItems ? "更新中..." : `${items.length}件`}</Badge>
        </div>
        <div className="space-y-3">
          <div className="space-y-2">
            <FormLabel htmlFor="products-search">商品を検索</FormLabel>
            <Input
              aria-label="商品を検索"
              enterKeyHint="search"
              id="products-search"
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
          {productFilters.map((item) => (
            <button
              aria-pressed={filter === item.key}
              className={`rounded-full px-4 py-2 text-sm font-medium ${
                filter === item.key
                  ? "bg-[var(--color-brand)] text-white"
                  : "bg-slate-100 text-slate-600"
              }`}
              key={item.key}
              onClick={() => setFilter(item.key)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
        {filter !== "all" ? (
          <button
            type="button"
            className="inline-flex h-10 items-center justify-center rounded-full bg-slate-100 px-4 text-sm font-medium text-slate-700 transition active:scale-[0.99]"
            onClick={() => setFilter("all")}
          >
            絞り込みを解除
          </button>
        ) : null}
      </Card>

      <button
        type="button"
        className="flex h-14 w-full items-center justify-center rounded-full bg-[var(--color-brand)] px-4 text-base font-semibold text-white shadow-lg shadow-emerald-900/15 transition active:scale-[0.99]"
        onClick={() => setShowAddForm((v) => !v)}
      >
        {showAddForm ? "登録フォームを閉じる" : "＋ 商品を追加"}
      </button>

      {showAddForm ? (
      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>新規商品を追加</CardTitle>
            <CardDescription>商品名・規格・JANを入力。初回在庫もまとめて登録できます。</CardDescription>
          </div>
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
          {janCodeValid ? (
            lookupLoading ? (
              <p className="text-xs text-slate-500">既存JANを確認中です。</p>
            ) : existingProduct ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/90 p-3 text-sm text-amber-950">
                <p className="font-semibold">このJANはすでに登録されています</p>
                <p className="mt-1">
                  {existingProduct.name} / {existingProduct.spec}
                </p>
                <p className="mt-1 text-xs text-amber-900">
                  重複登録せず、そのまま既存商品への在庫追加として扱えます。
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <Link
                    className="inline-flex h-11 w-full items-center justify-center rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-amber-950 ring-1 ring-amber-200 transition active:scale-[0.99]"
                    href={`/inventory/${existingProduct.id}`}
                  >
                    在庫詳細を開く
                  </Link>
                  <Link
                    className="inline-flex h-11 w-full items-center justify-center rounded-full bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition active:scale-[0.99]"
                    href={buildScanHref({
                      janCode: existingProduct.janCode,
                      name: existingProduct.name,
                      spec: existingProduct.spec,
                    })}
                  >
                    スキャン入荷へ
                  </Link>
                </div>
              </div>
            ) : (
              <p className="text-xs text-emerald-700">このJANは未登録です。新規商品として追加できます。</p>
            )
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Input
                disabled={!isOnline || creating}
                type="date"
                value={expiryDate}
                onChange={(event) => setExpiryDate(event.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!isOnline || creating}
                  className="rounded-full bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 disabled:opacity-50"
                  onClick={() => resetInitialLotDraft({ message: "商品マスタのみ登録に切り替えました。" })}
                >
                  期限なし
                </button>
                {receiptExpiryPresets.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    disabled={!isOnline || creating}
                    className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
                    onClick={() => setExpiryDate(addDaysToDateKey(todayJstKey(), preset.days))}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Input
                {...positiveIntegerInputProps}
                enterKeyHint="done"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                placeholder="初回数量（期限入力時のみ）"
                disabled={!isOnline || creating || !expiryDate}
              />
              <div className="flex flex-wrap gap-2">
                {quantityPresets.map((preset) => (
                  <button
                    key={`product-qty-${preset}`}
                    type="button"
                    disabled={!isOnline || creating || !expiryDate}
                    className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
                    onClick={() => setQuantity(String(preset))}
                  >
                    {preset}個
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            期限を入れない場合は商品マスタのみ登録します。初回在庫を同時登録したいときだけ期限日と数量を入力してください。
          </p>
          {(expiryDate || (initialLotQuantity ?? 1) > 1) ? (
            <div className="rounded-2xl bg-emerald-50/80 p-3 text-sm text-emerald-900">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">前回の入荷条件を保持中</p>
                  <p className="mt-1">
                    期限日 {expiryDate || "未設定"} / 数量 {initialLotQuantity ?? 1}個
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!isOnline || creating}
                  className="rounded-full bg-white/80 px-3 py-1.5 text-xs font-medium text-emerald-900 ring-1 ring-emerald-200 disabled:opacity-50"
                  onClick={clearReceiptDefaults}
                >
                  保持をクリア
                </button>
              </div>
            </div>
          ) : null}
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-3 text-xs leading-5 text-slate-600">
            <p>入力規則</p>
            <p className="mt-1">商品名・規格: 1〜120文字</p>
            <p className="mt-1">JANコード: 数字のみ8〜14桁。ハイフンは自動除去</p>
            <p className="mt-1">初回数量: 1以上の整数</p>
            <p className="mt-1">期限日: YYYY-MM-DD</p>
          </div>
        </div>
        <Button
          className="w-full"
          disabled={
            !isOnline ||
            creating ||
            !janCode.trim() ||
            !janCodeValid ||
            (existingProduct
              ? Boolean(expiryDate) && initialLotQuantity === null
              : !name.trim() || !spec.trim() || (Boolean(expiryDate) && initialLotQuantity === null))
          }
          onClick={createProduct}
        >
          {creating
            ? "登録中..."
            : existingProduct
              ? expiryDate
                ? "既存商品へ在庫追加"
                : "既存商品を開くか在庫追加"
              : expiryDate
                ? "商品と初回ロットを追加"
                : "商品マスタを追加"}
        </Button>
        {lastSubmittedDraft && !name && !spec && !janCode ? (
          <Button className="w-full" variant="secondary" disabled={creating} onClick={restoreLastSubmittedDraft}>
            同じ規格でもう一件
          </Button>
        ) : null}
        {!isOnline ? (
          <p className="text-sm text-[var(--color-danger)]">
            オフライン中は商品登録を停止しています。接続回復後に登録してください。
          </p>
        ) : null}
        {!janCodeValid && janCode.trim() ? (
          <p className="text-sm text-[var(--color-danger)]">JANコードは数字8〜14桁で入力してください。</p>
        ) : null}
        {message ? <p className="text-sm text-[var(--color-success)]">{message}</p> : null}
        {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
      </Card>
      ) : null}

      {loadingItems && items.length ? (
        <div className="flex items-center gap-2 rounded-2xl bg-slate-50 px-4 py-2 text-sm text-slate-500">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-transparent" />
          商品を再取得しています…
        </div>
      ) : null}
      {error && !items.length ? (
        <Card className="space-y-3">
          <CardTitle>商品一覧を取得できませんでした</CardTitle>
          <CardDescription>
            通信や API の応答に失敗しています。検索条件を変えるか、再試行してください。
          </CardDescription>
          <p className="text-sm text-[var(--color-danger)]">{error}</p>
          <Button disabled={loadingItems} variant="secondary" onClick={() => void loadProducts(query.trim(), filter)}>
            {loadingItems ? "再試行中..." : "再試行"}
          </Button>
        </Card>
      ) : loadingItems && !items.length ? (
        <EmptyState title="商品を読み込み中です" description="検索結果を取得しています。少し待ってください。" />
      ) : !items.length ? (
        <EmptyState
          title="商品が見つかりません"
          description="検索条件を変えるか、新規商品マスタを登録してください。"
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const deleteConfirmOpen = pendingDeleteProductId === item.productId;

            return (
              <Card className="space-y-3 scroll-mt-24" id={`product-${item.productId}`} key={item.productId}>
                <Link
                  className="block rounded-2xl transition hover:bg-slate-50/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                  href={`/inventory/${item.productId}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <CardTitle>{item.name}</CardTitle>
                      <CardDescription>{item.spec}</CardDescription>
                    </div>
                    <Badge tone={getBucketMeta(item.bucket).tone}>
                      {getBucketMeta(item.bucket).label}
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
                    <span className="font-semibold text-[var(--color-text)]">{formatQuantity(item.totalQuantity)}個</span>
                    <span className="text-slate-400">|</span>
                    <span>期限 {item.earliestExpiry ?? "-"}</span>
                    <span className="text-slate-400">|</span>
                    <span className="text-xs tabular-nums text-slate-500">JAN {item.janCode}</span>
                  </div>
                </Link>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Link
                    aria-label={`${item.name}の入荷登録を開く`}
                    className="inline-flex h-12 w-full items-center justify-center rounded-full bg-[var(--color-brand)] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-900/15 transition active:scale-[0.99]"
                    href={buildScanHref({
                      janCode: item.janCode,
                      name: item.name,
                      spec: item.spec,
                    })}
                  >
                    入荷する
                  </Link>
                  <Link
                    aria-label={`${item.name}の在庫詳細を開く`}
                    className="inline-flex h-12 w-full items-center justify-center rounded-full bg-white/85 px-4 py-3 text-sm font-semibold text-[var(--color-text)] ring-1 ring-slate-200 transition active:scale-[0.99]"
                    href={`/inventory/${item.productId}`}
                  >
                    在庫詳細
                  </Link>
                  {item.canDelete ? (
                    <button
                      className="inline-flex h-12 w-full items-center justify-center rounded-full bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 ring-1 ring-rose-200 transition active:scale-[0.99] sm:col-span-2"
                      disabled={deletingId === item.productId}
                      onClick={() =>
                        setPendingDeleteProductId((current) =>
                          current === item.productId ? null : item.productId,
                        )
                      }
                      type="button"
                    >
                      {deletingId === item.productId
                        ? "削除中..."
                        : deleteConfirmOpen
                          ? "削除確認を閉じる"
                          : "商品を削除"}
                    </button>
                  ) : null}
                </div>
                {deleteConfirmOpen ? (
                  <div className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50/80 p-3">
                    <p className="text-sm text-rose-900">
                      「{item.name}」を削除します。未入荷の商品だけ削除できます。
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Button
                        className="w-full"
                        disabled={deletingId === item.productId}
                        variant="danger"
                        onClick={() => void deleteProduct(item)}
                      >
                        {deletingId === item.productId ? "削除中..." : "この商品を削除する"}
                      </Button>
                      <Button
                        className="w-full"
                        disabled={deletingId === item.productId}
                        variant="secondary"
                        onClick={() => setPendingDeleteProductId(null)}
                      >
                        キャンセル
                      </Button>
                    </div>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProductsPageShell() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";
  const initialFilter = normalizeProductFilter(searchParams.get("filter"));

  return (
    <ProductsPageContent
      key={`${initialQuery}:${initialFilter}`}
      initialFilter={initialFilter}
      initialQuery={initialQuery}
    />
  );
}

export default function ProductsPage() {
  return (
    <Suspense fallback={<div className="space-y-6" />}>
      <ProductsPageShell />
    </Suspense>
  );
}

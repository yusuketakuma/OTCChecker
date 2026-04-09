"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { PwaInstallCard } from "@/components/app/pwa-install-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { usePwaInstallState } from "@/hooks/use-pwa-install-state";
import { useRefreshOnForeground } from "@/hooks/use-refresh-on-foreground";
import { fetchJson } from "@/lib/client";
import { getExpiryStatusMeta } from "@/lib/date";
import { buildScanHref } from "@/lib/utils";

type DashboardSummary = {
  expiredCount: number;
  within7Count: number;
  within30Count: number;
  unmatchedCount: number;
  alertLots: Array<{
    lotId: string;
    productId: string;
    productName: string;
    spec: string;
    expiryDate: string;
    quantity: number;
    bucket: string;
    janCode: string;
  }>;
};

const cardConfig = [
  {
    key: "expiredCount",
    label: "期限切れ",
    detail: "営業日超過",
    tone: "danger",
    href: "/inventory?bucket=expired",
  },
  {
    key: "within7Count",
    label: "7日以内",
    detail: "本日を含む",
    tone: "warning",
    href: "/inventory?bucket=7d",
  },
  {
    key: "within30Count",
    label: "30日以内",
    detail: "8-30日",
    tone: "info",
    href: "/inventory?bucket=30d",
  },
  {
    key: "unmatchedCount",
    label: "未割当",
    detail: "CSV要確認",
    tone: "neutral",
    href: "/import#unmatched-list",
  },
] as const;

const quickActions = [
  {
    href: "/scan",
    title: "バーコード登録",
    description: "入荷をすぐ記録",
    className: "bg-[var(--color-brand)] text-white shadow-lg shadow-emerald-900/15",
  },
  {
    href: "/import",
    title: "CSV取込",
    description: "売上CSVをまとめて処理",
    className: "bg-white/92 text-[var(--color-text)] ring-1 ring-slate-200",
  },
  {
    href: "/products",
    title: "商品管理",
    description: "SKUを先に登録",
    className: "bg-white/92 text-[var(--color-text)] ring-1 ring-slate-200",
  },
] as const;

export default function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const { showInstallPrompt, dismissInstallPrompt } = usePwaInstallState();

  const loadSummary = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) {
      setRefreshing(true);
    }

    try {
      const summary = await fetchJson<DashboardSummary>("/api/dashboard/summary");
      setData(summary);
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      if (showRefreshing) {
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useRefreshOnForeground(() => {
    void loadSummary();
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Dashboard"
        title="OTC-Checker"
        description="薬局のOTC商品の管理"
      />

      {showInstallPrompt ? <PwaInstallCard onDismiss={dismissInstallPrompt} /> : null}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--color-text)]">今日のクイック操作</h2>
          <span className="text-sm text-slate-500">iPhone向けの最短導線</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {quickActions.map((action) => (
            <Link
              href={action.href}
              key={action.href}
              className={`rounded-3xl px-5 py-4 transition active:scale-[0.99] ${action.className}`}
            >
              <p className="text-base font-semibold">{action.title}</p>
              <p className="mt-1 text-sm opacity-80">{action.description}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cardConfig.map((item) => (
          <Link href={item.href} key={item.key}>
            <Card className="flex h-full min-h-36 flex-col bg-white/95 transition hover:-translate-y-0.5">
              <div className="flex items-start justify-between gap-3">
                <Badge tone={item.tone as "danger" | "warning" | "info" | "neutral"}>{item.label}</Badge>
                <span className="text-right text-xs font-medium text-slate-500">{item.detail}</span>
              </div>
              <div className="mt-auto space-y-1 pt-6">
                <CardTitle className="text-3xl sm:text-4xl">
                  {data ? data[item.key] : "--"}
                </CardTitle>
                <div>
                  <CardDescription>タップして一覧へ</CardDescription>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-[var(--color-text)]">直近アラート対象</h2>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="text-sm font-medium text-[var(--color-brand)] disabled:opacity-50"
              disabled={refreshing}
              onClick={() => void loadSummary(true)}
            >
              {refreshing ? "更新中..." : "最新に更新"}
            </button>
            <Link className="text-sm font-medium text-[var(--color-brand)]" href="/inventory">
              在庫一覧を見る
            </Link>
          </div>
        </div>
        {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
        {!data?.alertLots.length ? (
          <EmptyState title="アラート対象はありません" description="安全圏の在庫のみです。" />
        ) : (
          <div className="space-y-3">
            {data.alertLots.map((lot) => {
              const expiryMeta = getExpiryStatusMeta(lot.expiryDate);

              return (
                <Card className="space-y-3 bg-white/92" key={lot.lotId}>
                <Link
                  href={`/inventory/${lot.productId}`}
                  className="block rounded-2xl transition hover:bg-slate-50/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <CardTitle>{lot.productName}</CardTitle>
                      <CardDescription>{lot.spec}</CardDescription>
                      <p className="text-sm text-slate-600">
                        期限 {lot.expiryDate} ({expiryMeta.relativeLabel}) / 残 {lot.quantity}個
                      </p>
                      <p className="text-xs text-slate-500">JAN {lot.janCode}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Badge tone={expiryMeta.tone}>{expiryMeta.shortLabel}</Badge>
                      <span className="text-xs font-medium text-slate-500">{expiryMeta.relativeLabel}</span>
                    </div>
                  </div>
                </Link>
                <div className="grid gap-2 sm:grid-cols-3">
                  {lot.bucket === "expired" || lot.bucket === "today" ? (
                    <Link
                      href={`/inventory/${lot.productId}#lot-${lot.lotId}`}
                      className="inline-flex h-12 w-full items-center justify-center rounded-full bg-[var(--color-danger)] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-red-900/15 transition active:scale-[0.99]"
                    >
                      廃棄登録へ
                    </Link>
                  ) : (
                    <Link
                      href={buildScanHref({
                        janCode: lot.janCode,
                        name: lot.productName,
                        spec: lot.spec,
                      })}
                      className="inline-flex h-12 w-full items-center justify-center rounded-full bg-[var(--color-brand)] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-900/15 transition active:scale-[0.99]"
                    >
                      スキャン入荷
                    </Link>
                  )}
                  <Link
                    href={`/inventory/${lot.productId}#manual-sale`}
                    className="inline-flex h-12 w-full items-center justify-center rounded-full bg-white/85 px-4 py-3 text-sm font-semibold text-[var(--color-text)] ring-1 ring-slate-200 transition active:scale-[0.99]"
                  >
                    売上登録
                  </Link>
                  <Link
                    href={`/inventory/${lot.productId}`}
                    className="inline-flex h-12 w-full items-center justify-center rounded-full bg-white/85 px-4 py-3 text-sm font-semibold text-[var(--color-text)] ring-1 ring-slate-200 transition active:scale-[0.99]"
                  >
                    在庫詳細
                  </Link>
                </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { fetchJson } from "@/lib/client";

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
  { key: "expiredCount", label: "期限切れ", tone: "danger", href: "/inventory?bucket=expired" },
  { key: "within7Count", label: "7日以内", tone: "warning", href: "/inventory?bucket=7d" },
  { key: "within30Count", label: "30日以内", tone: "info", href: "/inventory?bucket=30d" },
  { key: "unmatchedCount", label: "未割当", tone: "neutral", href: "/import" },
] as const;

export default function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchJson<DashboardSummary>("/api/dashboard/summary")
      .then(setData)
      .catch((cause) => setError(cause.message));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Dashboard"
        title="賞味期限を先回りして管理"
        description="期限切れ、7日以内、30日以内を最初に確認し、期限の近いロットから処理します。"
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cardConfig.map((item) => (
          <Link href={item.href} key={item.key}>
            <Card className="h-full bg-white/95 transition hover:-translate-y-0.5">
              <Badge tone={item.tone as "danger" | "warning" | "info" | "neutral"}>{item.label}</Badge>
              <div className="mt-4 flex items-end justify-between">
                <div>
                  <CardTitle className="text-4xl">
                    {data ? data[item.key] : "--"}
                  </CardTitle>
                  <CardDescription>タップして在庫一覧へ</CardDescription>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--color-text)]">直近アラート対象</h2>
          <Link className="text-sm font-medium text-[var(--color-brand)]" href="/inventory">
            在庫一覧を見る
          </Link>
        </div>
        {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
        {!data?.alertLots.length ? (
          <EmptyState title="アラート対象はありません" description="安全圏の在庫のみです。" />
        ) : (
          <div className="space-y-3">
            {data.alertLots.map((lot) => (
              <Link href={`/inventory/${lot.productId}`} key={lot.lotId}>
                <Card className="bg-white/92">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <CardTitle>{lot.productName}</CardTitle>
                      <CardDescription>{lot.spec}</CardDescription>
                      <p className="text-sm text-slate-600">
                        期限 {lot.expiryDate} / 残 {lot.quantity}個
                      </p>
                    </div>
                    <Badge
                      tone={
                        lot.bucket === "expired"
                          ? "danger"
                          : lot.bucket === "within30"
                            ? "info"
                            : "warning"
                      }
                    >
                      {lot.bucket === "expired"
                        ? "期限切れ"
                        : lot.bucket === "within30"
                          ? "30日以内"
                          : "7日以内"}
                    </Badge>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

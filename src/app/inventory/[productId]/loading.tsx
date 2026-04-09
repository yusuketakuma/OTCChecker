import { PageHeader } from "@/components/app/page-header";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-2xl bg-slate-200/80 ${className}`} />;
}

export default function InventoryDetailLoading() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Detail"
        title="在庫詳細を読み込み中"
        description="ロット、履歴、操作パネルを準備しています。"
      />

      <Card className="space-y-4">
        <CardTitle>商品マスタ</CardTitle>
        <div className="space-y-3">
          <div className="space-y-2">
            <CardDescription>商品名</CardDescription>
            <SkeletonBlock className="h-12 w-full" />
          </div>
          <div className="space-y-2">
            <CardDescription>規格</CardDescription>
            <SkeletonBlock className="h-12 w-full" />
          </div>
          <div className="space-y-2">
            <CardDescription>アラート日数</CardDescription>
            <SkeletonBlock className="h-12 w-full" />
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <SkeletonBlock className="h-8 w-16 rounded-full" key={`alert-skeleton-${index}`} />
              ))}
            </div>
          </div>
          <SkeletonBlock className="h-12 w-full" />
        </div>
      </Card>

      <Card className="space-y-4">
        <CardTitle>手動入荷登録</CardTitle>
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <SkeletonBlock className="h-28 w-full" />
          <SkeletonBlock className="h-28 w-full" />
          <SkeletonBlock className="h-12 w-full sm:col-span-2" />
        </div>
      </Card>

      <Card className="space-y-4">
        <CardTitle>手動売上登録</CardTitle>
        <SkeletonBlock className="h-20 w-full" />
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <SkeletonBlock className="h-28 w-full" />
          <SkeletonBlock className="h-28 w-full" />
          <SkeletonBlock className="h-12 w-full sm:col-span-2" />
        </div>
      </Card>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--color-text)]">ロット一覧</h2>
          <SkeletonBlock className="h-7 w-14 rounded-full" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, index) => (
            <Card className="space-y-4" key={`lot-skeleton-${index}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <SkeletonBlock className="h-6 w-40" />
                  <SkeletonBlock className="h-4 w-32" />
                </div>
                <SkeletonBlock className="h-7 w-24 rounded-full" />
              </div>
              <SkeletonBlock className="h-48 w-full" />
              <SkeletonBlock className="h-48 w-full" />
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

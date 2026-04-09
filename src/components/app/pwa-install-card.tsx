"use client";

import Link from "next/link";

import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type PwaInstallCardProps = {
  onDismiss: () => void;
};

export function PwaInstallCard({ onDismiss }: PwaInstallCardProps) {
  return (
    <Card className="space-y-4 border-emerald-200/80 bg-emerald-50/80">
      <div className="flex items-start justify-between gap-3">
        <div>
          <CardTitle>ホーム画面に追加すると使いやすくなります</CardTitle>
          <CardDescription className="mt-1 text-emerald-950/75">
            iPhoneではホーム画面起動にすると、再開が速くなり、Safariのアドレスバーも出ません。
          </CardDescription>
        </div>
        <button
          type="button"
          className="rounded-full bg-white/80 px-3 py-1.5 text-xs font-medium text-emerald-900 ring-1 ring-emerald-200"
          onClick={onDismiss}
        >
          あとで
        </button>
      </div>

      <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-emerald-950/80">
        <li>Safariでこのアプリを開く</li>
        <li>下部の共有ボタンを押す</li>
        <li>「ホーム画面に追加」を選ぶ</li>
        <li>追加後はホーム画面のアイコンから開く</li>
      </ol>

      <div className="grid gap-2 sm:grid-cols-2">
        <Link
          href="/settings#pwa-install"
          className="inline-flex h-12 w-full items-center justify-center rounded-full bg-[var(--color-brand)] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-900/15 transition active:scale-[0.99]"
        >
          手順を詳しく見る
        </Link>
        <Button className="w-full" variant="secondary" onClick={onDismiss}>
          今は閉じる
        </Button>
      </div>
    </Card>
  );
}

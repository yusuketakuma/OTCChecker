"use client";

import { useEffect, useState } from "react";

import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { fetchJson, putJson } from "@/lib/client";

type Settings = {
  defaultAlertDays: number[];
};

export default function SettingsPage() {
  const isOnline = useOnlineStatus();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [alertDays, setAlertDays] = useState("30,7,0");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetchJson<Settings>("/api/settings")
      .then((data) => {
        setSettings(data);
        setAlertDays(data.defaultAlertDays.join(","));
      })
      .catch((cause) => setError(cause.message));
  }, []);

  async function save() {
    if (!settings) {
      return;
    }

    try {
      const updated = await putJson<Settings>("/api/settings", {
        defaultAlertDays: alertDays
          .split(",")
          .map((item) => Number(item.trim()))
          .filter((item) => Number.isFinite(item)),
      });
      setSettings(updated);
      setMessage("設定を保存しました。");
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="運用設定"
        description="既定アラート日数、CSV 取込前提、PWA インストール導線を店舗運用に合わせて調整します。"
      />

      <Card className="space-y-4">
        <CardTitle>既定アラート閾値</CardTitle>
        <CardDescription>新規 SKU にだけ適用されます。カンマ区切りで入力してください。</CardDescription>
        <Input disabled={!isOnline} value={alertDays} onChange={(event) => setAlertDays(event.target.value)} />
        <Button className="w-full" disabled={!isOnline} onClick={save}>
          設定を保存
        </Button>
      </Card>

      <Card className="space-y-4">
        <CardTitle>CSV 取込ルール</CardTitle>
        <CardDescription>POS 連携なしの前提で、売上 CSV を日次または随時で取り込みます。</CardDescription>
        <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
          <p>受入ヘッダ: `JANコード, 商品名, 数量, 取引日, 取引ID`</p>
          <p className="mt-2">文字コード: UTF-8 / Shift_JIS</p>
          <p className="mt-2">重複行は自動検知し、未一致や在庫不足は未割当一覧へ残ります。</p>
        </div>
      </Card>

      <Card className="space-y-4">
        <CardTitle>運用メモ</CardTitle>
        <CardDescription>OTC 商品管理の優先運用に絞っています。</CardDescription>
        <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
          <p>1. 入荷は `/scan` または在庫詳細の手動登録から行う</p>
          <p className="mt-2">2. 日々の確認はダッシュボードの期限切れ・7日以内・30日以内を使う</p>
          <p className="mt-2">3. 売上 CSV 実行後は未割当一覧を確認して手動解決する</p>
        </div>
        {!isOnline ? (
          <p className="text-sm text-[var(--color-danger)]">
            オフライン中は設定変更を停止しています。
          </p>
        ) : null}
      </Card>

      <Card className="space-y-3">
        <CardTitle>PWA インストール手順</CardTitle>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600">
          <li>Safari でこのアプリを開く</li>
          <li>共有ボタンを押す</li>
          <li>「ホーム画面に追加」を選ぶ</li>
        </ol>
      </Card>

      {message ? <p className="text-sm text-[var(--color-success)]">{message}</p> : null}
      {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
    </div>
  );
}

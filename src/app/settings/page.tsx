"use client";

import { useEffect, useState } from "react";

import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { fetchJson, putJson } from "@/lib/client";
import { parseAlertDaysInput } from "@/lib/utils";

type Settings = {
  defaultAlertDays: number[];
};

type BuildInfo = {
  appName: string;
  appVersion: string;
  gitSha: string;
  builtAt: string;
  deployUrl: string;
};

const alertDayPresets = [30, 14, 7, 3, 0] as const;

export default function SettingsPage() {
  const isOnline = useOnlineStatus();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);
  const [alertDays, setAlertDays] = useState("30,7,0");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isInstalled, setIsInstalled] = useState(false);
  const alertDaysInput = parseAlertDaysInput(alertDays);

  useEffect(() => {
    fetchJson<Settings>("/api/settings")
      .then((data) => {
        setSettings(data);
        setAlertDays(data.defaultAlertDays.join(","));
      })
      .catch((cause) => setError(cause.message));
  }, []);

  useEffect(() => {
    fetchJson<BuildInfo>("/api/version")
      .then(setBuildInfo)
      .catch(() => {
        // Keep settings usable even if version metadata cannot be loaded.
      });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(display-mode: standalone)");
    const syncInstalled = () => {
      const iosStandalone = Boolean(
        (window.navigator as Navigator & { standalone?: boolean }).standalone,
      );
      setIsInstalled(mediaQuery.matches || iosStandalone);
    };

    syncInstalled();
    mediaQuery.addEventListener("change", syncInstalled);

    return () => mediaQuery.removeEventListener("change", syncInstalled);
  }, []);

  function toggleAlertDay(day: number) {
    const next = alertDaysInput.values.includes(day)
      ? alertDaysInput.values.filter((value) => value !== day)
      : [...alertDaysInput.values, day];

    setAlertDays(next.length ? next.sort((a, b) => b - a).join(",") : "");
    setMessage("");
  }

  async function save() {
    if (!settings) {
      return;
    }

    try {
      if (alertDaysInput.error) {
        setError(alertDaysInput.error);
        setMessage("");
        return;
      }

      const updated = await putJson<Settings>("/api/settings", {
        defaultAlertDays: alertDaysInput.values,
      });
      setSettings(updated);
      setAlertDays(updated.defaultAlertDays.join(","));
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
        <div className="flex flex-wrap gap-2">
          {alertDayPresets.map((day) => {
            const selected = alertDaysInput.values.includes(day);

            return (
              <button
                key={day}
                type="button"
                disabled={!isOnline}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                  selected
                    ? "bg-[var(--color-brand)] text-white"
                    : "bg-slate-100 text-slate-700"
                }`}
                onClick={() => toggleAlertDay(day)}
              >
                {day === 0 ? "当日" : `${day}日前`}
              </button>
            );
          })}
        </div>
        <p className={`text-sm ${alertDaysInput.error ? "text-[var(--color-danger)]" : "text-slate-500"}`}>
          {alertDaysInput.error || `保存時は ${alertDaysInput.normalizedText} に整えて反映します。全角カンマも使えます。`}
        </p>
        <Button className="w-full" disabled={!isOnline || Boolean(alertDaysInput.error)} onClick={save}>
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

      <Card className="space-y-4">
        <CardTitle>稼働バージョン</CardTitle>
        <CardDescription>本番反映の確認に使う情報です。</CardDescription>
        {buildInfo ? (
          <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
            <p>アプリ名: {buildInfo.appName}</p>
            <p className="mt-2">バージョン: {buildInfo.appVersion}</p>
            <p className="mt-2">コミット: {buildInfo.gitSha}</p>
            <p className="mt-2">ビルド時刻: {buildInfo.builtAt || "未設定"}</p>
            <a
              className="mt-3 inline-block font-medium text-[var(--color-brand)]"
              href={buildInfo.deployUrl}
              rel="noreferrer"
              target="_blank"
            >
              本番 URL を開く
            </a>
          </div>
        ) : (
          <CardDescription>バージョン情報を取得中です。</CardDescription>
        )}
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>PWA インストール手順</CardTitle>
            <CardDescription>iPhone のホーム画面から直接開けるようにします。</CardDescription>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              isInstalled
                ? "bg-emerald-100 text-emerald-800"
                : "bg-slate-100 text-slate-700"
            }`}
          >
            {isInstalled ? "インストール済み" : "Safariで利用中"}
          </span>
        </div>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600">
          <li>Safari でこのアプリを開く</li>
          <li>画面下の共有ボタンを押す</li>
          <li>「ホーム画面に追加」を選ぶ</li>
          <li>追加後はホーム画面のアイコンから開く</li>
        </ol>
        <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
          <p>確認ポイント</p>
          <p className="mt-2">- ホーム画面起動だと Safari のアドレスバーが出ません。</p>
          <p className="mt-2">- 店頭運用ではホーム画面起動を固定すると再開が速くなります。</p>
          <p className="mt-2">- 共有メニューに追加項目が出ない場合は Safari で開き直してください。</p>
        </div>
      </Card>

      {message ? <p className="text-sm text-[var(--color-success)]">{message}</p> : null}
      {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
    </div>
  );
}

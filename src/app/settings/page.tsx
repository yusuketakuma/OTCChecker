"use client";

import { useEffect, useState } from "react";

import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { fetchJson, putJson } from "@/lib/client";

type Settings = {
  defaultAlertDays: number[];
  lineTargetType: "NONE" | "USER" | "GROUP" | "ROOM";
  lineTargetId: string | null;
  lineEnabled: boolean;
};

export default function SettingsPage() {
  const isOnline = useOnlineStatus();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [alertDays, setAlertDays] = useState("30,7,0");
  const [lineTargetId, setLineTargetId] = useState("");
  const [lineEnabled, setLineEnabled] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetchJson<Settings>("/api/settings")
      .then((data) => {
        setSettings(data);
        setAlertDays(data.defaultAlertDays.join(","));
        setLineTargetId(data.lineTargetId ?? "");
        setLineEnabled(data.lineEnabled);
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
        lineTargetType: lineTargetId
          ? settings.lineTargetType === "NONE"
            ? "USER"
            : settings.lineTargetType
          : "NONE",
        lineTargetId: lineTargetId || null,
        lineEnabled,
      });
      setSettings(updated);
      setMessage("設定を保存しました。");
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function testLine() {
    const response = await fetch("/api/line/test", { method: "POST" });
    const payload = await response.json();

    if (!response.ok) {
      setError(payload.error ?? "テスト通知に失敗しました");
      return;
    }

    setMessage("LINE テスト通知を送信しました。");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="運用設定"
        description="既定アラート、LINE 通知、PWA インストール導線を店舗運用に合わせて調整します。"
      />

      <Card className="space-y-4">
        <CardTitle>既定アラート閾値</CardTitle>
        <CardDescription>新規 SKU にだけ適用されます。カンマ区切りで入力してください。</CardDescription>
        <Input disabled={!isOnline} value={alertDays} onChange={(event) => setAlertDays(event.target.value)} />
      </Card>

      <Card className="space-y-4">
        <CardTitle>LINE 通知</CardTitle>
        <CardDescription>
          Webhook で取得した通知先 ID を保存します。アクセストークンは環境変数管理です。
        </CardDescription>
        <div className="flex flex-wrap gap-2">
          <Badge tone={settings?.lineEnabled ? "success" : "neutral"}>
            {settings?.lineEnabled ? "通知有効" : "通知無効"}
          </Badge>
          <Badge tone={settings?.lineTargetId ? "info" : "warning"}>
            {settings?.lineTargetId ? `通知先: ${settings.lineTargetType}` : "通知先未設定"}
          </Badge>
        </div>
        <Input
          disabled={!isOnline}
          value={lineTargetId}
          onChange={(event) => setLineTargetId(event.target.value)}
          placeholder="通知先 ID"
        />
        <p className="text-sm text-slate-500">
          保存中の種別: {settings?.lineTargetType ?? "NONE"} / ID: {settings?.lineTargetId ?? "-"}
        </p>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            checked={lineEnabled}
            disabled={!isOnline}
            onChange={(event) => setLineEnabled(event.target.checked)}
            type="checkbox"
          />
          LINE 通知を有効化
        </label>
        <div className="flex gap-3">
          <Button className="flex-1" disabled={!isOnline} onClick={save}>
            設定を保存
          </Button>
          <Button className="flex-1" disabled={!isOnline} variant="secondary" onClick={testLine}>
            テスト通知
          </Button>
        </div>
        {!isOnline ? (
          <p className="text-sm text-[var(--color-danger)]">
            オフライン中は設定変更と通知テストを停止しています。
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

# OTCChecker API 契約 v1

この文書は [spec-v1.2.md](/Users/yusuke/workspace/OTCChecker/docs/spec-v1.2.md) の補助資料であり、`Route Handler` 実装と画面実装の間で共有する入出力契約を定義する。

## 共通規約

### 成功レスポンス

```json
{
  "data": {},
  "meta": {}
}
```

- `meta` は任意
- 一覧系では集計情報やページ補助情報を格納してよい

### 失敗レスポンス

```json
{
  "error": "表示用メッセージ",
  "code": "MACHINE_READABLE_CODE",
  "details": {}
}
```

- `details` は任意
- バリデーションエラーでは `zod` の `flatten()` 相当を格納する

### 共通ルール

- 日付入力は `YYYY-MM-DD`
- 文字列 JAN は API 受信後に数字のみへ正規化する
- 更新系 API は原則として `application/json`
- CSV プレビューだけ `multipart/form-data`
- 楽観ロック対象 API は `version` 必須

## エンドポイント一覧

| Method | Path | 用途 |
| --- | --- | --- |
| `GET` | `/api/products` | 商品一覧 |
| `POST` | `/api/products` | 商品新規作成 |
| `GET` | `/api/products/[id]` | 商品詳細 |
| `PUT` | `/api/products/[id]` | 商品更新 |
| `GET` | `/api/products/jan/[code]` | JAN 検索 |
| `GET` | `/api/lots` | 商品単位ロット一覧 |
| `POST` | `/api/lots` | ロット作成または同期限 ACTIVE ロットへの加算 |
| `PUT` | `/api/lots/[id]` | 数量上書き |
| `DELETE` | `/api/lots/[id]` | 論理削除 |
| `POST` | `/api/lots/[id]/adjust` | 差分調整 |
| `POST` | `/api/lots/[id]/dispose` | 廃棄 |
| `GET` | `/api/dashboard/summary` | ダッシュボード集計 |
| `POST` | `/api/import/preview` | CSV プレビュー生成 |
| `POST` | `/api/import/execute` | CSV 実行 |
| `GET` | `/api/unmatched` | 未割当一覧 |
| `PUT` | `/api/unmatched/[id]/resolve` | 未割当解決 |
| `GET` | `/api/settings` | 設定取得 |
| `PUT` | `/api/settings` | 設定更新 |
| `POST` | `/api/alerts/check` | Cron 実行 |
| `GET` | `/api/alerts/log` | 通知履歴取得 |
| `POST` | `/api/line/test` | テスト通知 |
| `POST` | `/api/line/webhook` | LINE 通知先捕捉 |

## 商品 API

### `GET /api/products`

クエリ:

- `q?: string`
- `bucket?: all | expired | 7d | 30d`

成功レスポンス:

```json
{
  "data": [
    {
      "productId": "uuid",
      "name": "ビタミンC",
      "spec": "1000mg 60粒",
      "janCode": "4901234567890",
      "earliestExpiry": "2026/04/15",
      "totalQuantity": 24,
      "bucket": "within7"
    }
  ]
}
```

### `POST /api/products`

リクエスト:

```json
{
  "name": "ビタミンC",
  "spec": "1000mg 60粒",
  "janCode": "4901234567890",
  "alertDays": [30, 7, 0]
}
```

ルール:

- `alertDays` 未指定時は `AppSettings.defaultAlertDays` を使用
- `janCode` は正規化後に一意判定

失敗コード:

- `INVALID_PRODUCT`
- `PRODUCT_CREATE_FAILED`

### `GET /api/products/[id]`

成功レスポンスには以下を含める:

- 商品本体
- `lots`
- 各 lot の `salesRecords / disposalRecords / adjustmentRecords / receiptRecords`

### `PUT /api/products/[id]`

リクエスト:

```json
{
  "name": "ビタミンC",
  "spec": "1000mg 60粒",
  "alertDays": [45, 14, 7, 0]
}
```

失敗コード:

- `INVALID_PRODUCT`
- `PRODUCT_UPDATE_FAILED`

## ロット API

### `GET /api/lots?productId=...`

成功レスポンス:

```json
{
  "data": [
    {
      "id": "uuid",
      "productId": "uuid",
      "expiryDate": "2026-05-01T00:00:00.000Z",
      "quantity": 10,
      "initialQuantity": 12,
      "status": "ACTIVE",
      "version": 3
    }
  ]
}
```

失敗コード:

- `PRODUCT_ID_REQUIRED`
- `LOTS_FETCH_FAILED`

### `POST /api/lots`

リクエスト:

```json
{
  "productId": "uuid",
  "expiryDate": "2026-05-01",
  "quantity": 12,
  "initialQuantity": 12
}
```

ルール:

- 同じ `productId + expiryDate + ACTIVE` が存在する場合は加算
- `receipt_records` を必ず記録

失敗コード:

- `INVALID_LOT`
- `LOT_CREATE_FAILED`

### `PUT /api/lots/[id]`

用途:

- 在庫数の直接上書き
- 理由付きの棚卸修正

リクエスト:

```json
{
  "quantity": 8,
  "reason": "棚卸修正",
  "version": 3
}
```

ルール:

- `version` 不一致時は `409`
- 数量が 0 の場合は `ARCHIVED`
- 数量変更があった場合のみ `adjustment_records` を生成

失敗コード:

- `INVALID_LOT_UPDATE`
- `LOT_NOT_FOUND`
- `STALE_VERSION`
- `LOT_UPDATE_FAILED`

### `POST /api/lots/[id]/adjust`

用途:

- 差分入力での在庫調整

リクエスト:

```json
{
  "delta": -2,
  "reason": "棚卸差異",
  "version": 3
}
```

ルール:

- `afterQty < 0` は `422 NEGATIVE_STOCK`
- 調整成功時は `adjustment_records` を必ず生成

### `POST /api/lots/[id]/dispose`

リクエスト:

```json
{
  "quantity": 2,
  "reason": "破損",
  "version": 3
}
```

ルール:

- 廃棄数が在庫を超える場合は `422 INSUFFICIENT_STOCK`
- 成功時は `disposal_records` を生成
- 在庫 0 で `ARCHIVED`

### `DELETE /api/lots/[id]`

ルール:

- 履歴なしロットのみ削除可
- 実体削除ではなく `DELETED` へ更新

失敗コード:

- `LOT_NOT_FOUND`
- `LOT_DELETE_BLOCKED`
- `LOT_DELETE_FAILED`

## ダッシュボード API

### `GET /api/dashboard/summary`

成功レスポンス:

```json
{
  "data": {
    "expiredCount": 2,
    "within7Count": 3,
    "within30Count": 5,
    "alertLots": [
      {
        "lotId": "uuid",
        "productId": "uuid",
        "productName": "ビタミンC",
        "spec": "1000mg 60粒",
        "expiryDate": "2026/04/15",
        "quantity": 12,
        "bucket": "within7",
        "janCode": "4901234567890"
      }
    ]
  }
}
```

## CSV API

### `POST /api/import/preview`

リクエスト:

- `multipart/form-data`
- フィールド名は `file`

成功レスポンス:

```json
{
  "data": {
    "previewId": "uuid",
    "rows": [
      {
        "rowNo": 2,
        "janCode": "4901234567890",
        "productName": "ビタミンC",
        "quantity": 3,
        "transactionDate": "2026-04-08",
        "transactionId": "TX-001",
        "rawRow": {},
        "status": "MATCHED",
        "appliedQuantity": 3,
        "remainingQuantity": 0,
        "productId": "uuid",
        "matchedProductName": "ビタミンC"
      }
    ],
    "meta": {
      "rowCount": 10,
      "matchedCount": 8,
      "unmatchedCount": 2,
      "duplicateCount": 1
    }
  }
}
```

ルール:

- 同じ `fileHash` が `EXECUTED` の場合は `409 CSV_ALREADY_EXECUTED`
- 既存 `PREVIEWED` バッチがあれば内容を更新して再利用してよい

### `POST /api/import/execute`

リクエスト:

```json
{
  "previewId": "uuid"
}
```

ルール:

- `PREVIEWED` バッチのみ実行可
- 実行はトランザクションで行う
- 成功時は `import_batches.status = EXECUTED`
- 実行後は `previewPayload` を破棄してよい

失敗コード:

- `INVALID_EXECUTE_REQUEST`
- `PREVIEW_NOT_FOUND`
- `PREVIEW_ALREADY_EXECUTED`
- `PREVIEW_PAYLOAD_MISSING`

## 未割当 API

### `GET /api/unmatched`

用途:

- 未割当一覧の取得
- `resolved` 状態で絞り込める実装を推奨

### `PUT /api/unmatched/[id]/resolve`

リクエスト:

```json
{
  "resolutionNote": "商品マスタ追加後に再取込"
}
```

ルール:

- 手動解決時は `resolved = true`
- 監査のため `resolutionNote` 必須

## 設定 API

### `GET /api/settings`

成功レスポンス:

```json
{
  "data": {
    "id": "singleton",
    "defaultAlertDays": [30, 7, 0],
    "timezone": "Asia/Tokyo",
    "lineTargetType": "USER",
    "lineTargetId": "Uxxxxxxxx",
    "lineEnabled": true
  }
}
```

### `PUT /api/settings`

リクエスト:

```json
{
  "defaultAlertDays": [30, 7, 0],
  "lineTargetType": "USER",
  "lineTargetId": "Uxxxxxxxx",
  "lineEnabled": true
}
```

ルール:

- `timezone` は v1 では固定で UI 更新対象外
- `defaultAlertDays` は保存前に重複除去・降順正規化する

失敗コード:

- `INVALID_SETTINGS`
- `SETTINGS_UPDATE_FAILED`

## 通知 API

### `POST /api/alerts/check`

ヘッダ:

- `x-cron-secret: <CRON_SECRET>`

ルール:

- `CRON_SECRET` 設定時は一致必須
- `ACTIVE` かつ `quantity > 0` のロットだけを対象にする
- 閾値一致ロットまたは当日未通知の期限切れロットだけ送る
- `settings.lineEnabled && settings.lineTargetId` の場合のみ送信実行
- 送信の有無に関わらず、成功時は `alert_log` を作成する

成功レスポンス:

```json
{
  "data": {
    "sent": 3
  }
}
```

失敗コード:

- `INVALID_CRON_SECRET`
- `ALERT_CHECK_FAILED`

### `GET /api/alerts/log`

用途:

- 通知履歴一覧の表示
- `sentAt desc` を推奨

## LINE API

### `POST /api/line/test`

用途:

- 現設定の通知先にテストメッセージを送る

失敗条件:

- `lineEnabled = false`
- `lineTargetId` 未設定
- 資格情報不足

### `POST /api/line/webhook`

ヘッダ:

- `x-line-signature`

ルール:

- 署名検証失敗時は `401 INVALID_LINE_SIGNATURE`
- 初回イベントから `source.type` と `source userId/groupId/roomId` を取り出す
- `app_settings` に `lineTargetType`, `lineTargetId`, `lineEnabled = true` を upsert する

成功レスポンス:

```json
{
  "data": {
    "captured": true,
    "lineTargetType": "USER",
    "lineTargetId": "Uxxxxxxxx"
  }
}
```

## 実装メモ

- 文書上の API は v1 の契約であり、レスポンスに補助フィールドを追加する場合も既存フィールドの意味を変えない。
- `404` と `409` と `422` の使い分けを固定し、画面側ではコード単位で分岐する。
- CSV 系は `preview` と `execute` を厳密に分け、プレビュー段階で永続更新しない。

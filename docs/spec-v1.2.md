# OTCChecker 仕様 v1.3

## 1. 目的

- 単一店舗・単一業務主体で、健康食品の賞味期限と在庫を `iPhone` 中心に管理する。
- v1 の対象は `入荷登録 / 在庫可視化 / FIFO 消し込み / 廃棄記録 / CSV 取込 / LINE 通知 / PWA 化`。
- v1 の非対象は `多店舗 / 権限管理 / POS 双方向同期 / オフライン書込 / ロット番号追跡 / 棚卸ワークフロー / 発注最適化`。
- 運用目安は `500 SKU 未満`、単一店舗、単一担当者または少人数の共有利用。

## 2. 前提と設計原則

- フロントエンドは `Next.js 16 App Router + React 19 + TypeScript + Tailwind CSS 4`。
- DB は `PostgreSQL (Supabase) + Prisma`。
- 更新系の唯一の入口は `Route Handler` とし、クライアントから DB を直接更新しない。
- 時刻と日付判定の基準は常に `Asia/Tokyo` とする。
- v1 は `オンライン前提` とし、オフライン時は閲覧のみ許可する。
- iPhone Safari を主対象とするため、カメラ読取は `getUserMedia + @zxing/browser` を主経路、`BarcodeDetector` は feature detect 時の最適化として扱う。
- PWA は `src/app/manifest.ts` を起点に構成し、iOS の導線は「Safari の共有メニューからホーム画面に追加」を明示する。
- 認証機能は未導入だが、公開制御の差し込み位置として `proxy.ts` を維持する。

## 3. スコープ

### 3.1 v1 で提供する業務

- JAN スキャンまたは手入力による商品登録と入荷登録
- 商品別・ロット別の在庫一覧と期限可視化
- CSV 取込による FIFO 消し込み
- 廃棄登録
- 在庫数量調整と監査ログ保存
- 閾値通知と期限切れ通知の LINE 送信
- iPhone ホーム画面追加前提の PWA 利用

### 3.2 v1 で提供しない業務

- ユーザー認証、権限管理、操作承認フロー
- 複数店舗在庫の横断管理
- POS への書き戻しやリアルタイム連携
- 完全オフライン動作や更新キュー
- ロット番号、製造番号、仕入先単位の追跡

## 4. 用語定義

- `SKU`: 商品マスタ単位。JAN コードで一意に識別する。
- `ロット`: 同一 SKU のうち、同一賞味期限で管理する在庫単位。
- `ACTIVE`: 販売・廃棄・通知対象となる有効ロット。
- `ARCHIVED`: 在庫 0 または運用上閉じたロット。履歴参照対象だが通常操作対象外。
- `DELETED`: 誤登録の論理削除状態。
- `期限バケット`: UI 表示用の固定分類。`expired / today / within7 / within30 / safe`。
- `通知閾値`: SKU ごとに保持する通知日数。UI バケットとは別概念。
- `プレビュー`: CSV を検証し、実行結果を予測した非更新状態。
- `実行`: プレビュー済み CSV を確定反映する処理。

## 5. 業務ルール

### 5.1 日付と期限判定

- 基準日はすべて `JST` の営業日で扱う。
- `expiryDate` と `businessDate` は date-only 値として保存し、時刻比較をしない。
- 期限バケットは以下で固定する。
  - `expired`: `expiryDate < 今日`
  - `today`: `expiryDate = 今日`
  - `within7`: `1..7日`
  - `within30`: `8..30日`
  - `safe`: `31日以上`
- ダッシュボードの「7日以内件数」は `today + within7` を含む。
- ダッシュボードの「30日以内件数」は `within30` のみを示し、`expired` と `7日以内` は二重計上しない。

### 5.2 商品とアラート

- `Product.janCode` は数字のみ・先頭ゼロ保持で正規化して一意管理する。
- `Product.alertDays` は `0..365` の整数配列とし、重複除去・降順ソートして保存する。
- `AppSettings.defaultAlertDays` は新規 SKU 作成時の初期値にのみ適用し、既存 SKU は自動更新しない。
- 通知の閾値管理は `alert_log.alertType` の固定 enum ではなく、`alertKind + thresholdDays + businessDate` で表現する。

### 5.3 ロット管理

- 同一 `productId + expiryDate` の `ACTIVE` ロットは 1 行に集約する。
- FIFO 消し込み順は `expiryDate asc -> createdAt asc -> id asc` とする。
- 在庫数は常に `0 以上`。負在庫になる更新は受け付けない。
- ロット削除は履歴のない誤登録に限定し、`sales_records / disposal_records / adjustment_records` のいずれかが存在するロットは削除不可とする。
- 在庫 0 になったロットは `ARCHIVED` に遷移する。
- 数量修正は直接上書きではなく、`adjustment_records` に必ず理由付きで記録する。

### 5.4 CSV 取込と消し込み

- CSV は `UTF-8` と `Shift_JIS` を受理する。
- JAN は `数字のみ / ハイフン除去 / 先頭ゼロ保持` で正規化する。
- CSV プレビューでは DB を更新しない。
- CSV 実行は `previewId` を必須とし、同一プレビューの再実行は `409` を返す。
- 同一 CSV の二重実行防止には `import_batches.fileHash` を使う。
- 同一 CSV 行の重複判定には `sourceRowKey` を使う。
- `sales_records.dedupeKey` は「1入力行 x 1引当先ロット」単位で一意にする。
- 在庫不足時は適用可能分だけ引当て、不足分を `unmatched_sales(reason=INSUFFICIENT_STOCK)` として保存する。
- JAN 未一致行は `unmatched_sales(reason=NO_PRODUCT)` に保存する。
- 既実行と判定した行は `unmatched_sales(reason=DUPLICATE_ROW)` として保存する。

### 5.5 通知

- v1 の通知実行は `1日1回・固定時刻` とする。
- 閾値通知は `各 lot x thresholdDays` ごとに 1 回だけ送る。
- 期限切れ通知は在庫が残る限り、営業日ごとに 1 回送る。
- 通知対象の抽出は `status = ACTIVE` のロットに限定する。
- LINE 通知先は `Webhook で取得した targetId` を `app_settings.lineTargetId` に保存して管理する。

## 6. データモデル

### 6.1 products

- `id`: UUID
- `name`: 商品名
- `spec`: 規格
- `janCode`: JAN コード、一意
- `alertDays`: 通知閾値日数配列
- `createdAt`, `updatedAt`

制約:

- `janCode` は一意
- `alertDays` は `0..365` の整数のみ

### 6.2 inventory_lots

- `id`: UUID
- `productId`: FK
- `expiryDate`: date-only
- `quantity`: 現在庫数
- `initialQuantity`: 入荷時数量
- `status`: `ACTIVE / ARCHIVED / DELETED`
- `version`: 楽観ロック用
- `archivedAt`, `deletedAt`
- `createdAt`, `updatedAt`

制約:

- `quantity >= 0`
- `initialQuantity > 0`
- 運用上、`ACTIVE` ロットの `productId + expiryDate` は一意
- `version` は更新ごとにインクリメント

### 6.3 sales_records

- `id`: UUID
- `lotId`: FK
- `quantity`
- `source`: `CSV_IMPORT / MANUAL`
- `posTransactionId`
- `transactionDate`
- `importBatchId`
- `sourceRowNo`
- `sourceRowKey`
- `dedupeKey`
- `createdAt`

制約:

- `quantity > 0`
- `dedupeKey` は一意

### 6.4 disposal_records

- `id`: UUID
- `lotId`: FK
- `quantity`
- `reason`
- `createdAt`

制約:

- `quantity > 0`
- 廃棄数量は対象ロット残数を超えてはならない

### 6.5 adjustment_records

- `id`: UUID
- `lotId`: FK
- `beforeQty`
- `afterQty`
- `delta`
- `reason`
- `createdAt`

制約:

- `beforeQty + delta = afterQty`
- `afterQty >= 0`
- 数量修正理由は必須

### 6.6 receipt_records

- `id`: UUID
- `lotId`: FK
- `quantity`
- `importBatchId`
- `createdAt`

用途:

- 入荷履歴の監査
- CSV 以外の手動入荷も記録対象にする

### 6.7 alert_log

- `id`: UUID
- `lotId`: FK
- `alertKind`: `THRESHOLD / EXPIRED`
- `thresholdDays`: 閾値通知時のみ設定
- `businessDate`: 期限切れ通知日
- `sentAt`

制約:

- 閾値通知は `lotId + thresholdDays + alertKind` で一意
- 期限切れ通知は `lotId + businessDate + alertKind` で一意

### 6.8 unmatched_sales

- `id`: UUID
- `rawProductName`
- `janCode`
- `quantity`
- `requestedQuantity`
- `appliedQuantity`
- `remainingQuantity`
- `reason`: `NO_PRODUCT / INSUFFICIENT_STOCK / DUPLICATE_ROW / MANUAL_RESOLUTION`
- `transactionDate`
- `importBatchId`
- `sourceRowNo`
- `rawRow`
- `resolutionNote`
- `resolved`
- `importedAt`

用途:

- 未一致データの保留
- 在庫不足時の不足量記録
- 手動解決の監査

### 6.9 import_batches

- `id`: UUID
- `fileName`
- `fileHash`
- `status`: `PREVIEWED / EXECUTED / FAILED`
- `rowCount`
- `matchedCount`
- `unmatchedCount`
- `duplicateCount`
- `previewPayload`
- `createdAt`, `updatedAt`, `executedAt`

用途:

- プレビュー結果の保持
- 二重実行防止
- 取込監査ログ

### 6.10 app_settings

- `id`: singleton
- `defaultAlertDays`
- `timezone`
- `lineTargetType`: `NONE / USER / GROUP / ROOM`
- `lineTargetId`
- `lineEnabled`
- `createdAt`, `updatedAt`

## 7. 状態遷移

### 7.1 ロット

- 新規入荷時: `ACTIVE`
- 販売または廃棄で在庫 0: `ARCHIVED`
- 誤登録削除: `DELETED`
- `DELETED` は通常一覧に表示しない

### 7.2 ImportBatch

- プレビュー完了: `PREVIEWED`
- 実行成功: `EXECUTED`
- 実行失敗: `FAILED`
- `EXECUTED` の再実行は不可

### 7.3 UnmatchedSale

- 生成時: `resolved = false`
- 手動解決後: `resolved = true`, `resolutionNote` 必須

## 8. 画面仕様

### 8.1 ダッシュボード `/`

- カード表示:
  - 期限切れ件数
  - 7日以内件数
  - 30日以内件数
- アラート対象ロット上位 10 件を期限昇順で表示
- カードタップで `/inventory?bucket=...` に遷移
- ロット行には `商品名 / 規格 / 期限 / 数量 / バケット色` を表示

### 8.2 スキャン `/scan`

- カメラ起動と JAN 読取
- 主経路は `zxing`、対応環境で `BarcodeDetector` を補助利用
- カメラ非利用時の JAN 手入力欄を常設
- 既存 SKU:
  - 商品名・規格を自動表示
  - 賞味期限と数量を入力してロット登録
- 新規 SKU:
  - 商品名・規格・JAN を確認して商品作成
  - そのまま初回ロット登録へ遷移
- 補助 UX:
  - 読取成功時のバイブ
  - トーチ切替
  - 直近読取履歴

### 8.3 在庫一覧 `/inventory`

- 検索対象は `商品名 / JAN コード`
- フィルタは `all / expired / 7d / 30d`
- デフォルトソートは最短期限昇順
- 商品カード表示項目:
  - 商品名
  - 規格
  - 最短期限
  - 合計在庫数

### 8.4 在庫詳細 `/inventory/[productId]`

- ロット一覧を期限昇順で表示
- 各ロットの表示項目:
  - 期限
  - 現在庫
  - 初期在庫
  - ステータス
- ロット操作:
  - 数量修正
  - 廃棄登録
  - 誤登録削除
- 商品マスタ編集:
  - 商品名
  - 規格
  - アラート閾値
- 履歴タブ:
  - 入荷
  - 販売
  - 廃棄
  - 調整

### 8.5 CSV 取込 `/import`

- `iPhone` の「ファイル」アプリから CSV を選択
- 受入ヘッダは当面 `JANコード, 商品名, 数量, 取引日, 取引ID`
- プレビューで `MATCHED / UNMATCHED / INSUFFICIENT_STOCK / DUPLICATE` を色分け表示
- 実行前に件数サマリを表示
- 実行後は未割当一覧を表示

### 8.6 設定 `/settings`

- 既定アラート閾値の変更
- LINE 接続状態の表示
- 通知先 ID の保存状態表示
- テスト通知ボタン
- PWA インストール手順の表示

## 9. API 仕様

### 9.1 返却規約

- 成功: `{ data, meta? }`
- 失敗: `{ error, code, details? }`

HTTP ステータス:

- `400`: リクエスト不正
- `404`: 対象なし
- `409`: 二重実行 / 競合 / stale version / 削除不可
- `422`: 業務ルール違反
- `500`: 想定外エラー

### 9.2 商品

- `GET /api/products`
  - 検索と在庫バケット絞り込みを受け付ける
- `GET /api/products/[id]`
- `POST /api/products`
- `PUT /api/products/[id]`
- `GET /api/products/jan/[code]`

### 9.3 ロット

- `GET /api/lots?productId=...`
- `POST /api/lots`
- `PUT /api/lots/[id]`
  - `quantity`, `reason`, `version` を受ける数量上書き API
- `POST /api/lots/[id]/adjust`
  - `delta`, `reason`, `version` を受ける差分調整 API
- `DELETE /api/lots/[id]`
  - 論理削除
- `POST /api/lots/[id]/dispose`

### 9.4 ダッシュボード

- `GET /api/dashboard/summary`

### 9.5 CSV 取込

- `POST /api/import/preview`
  - CSV アップロードとプレビュー生成
- `POST /api/import/execute`
  - `previewId` を受けて確定反映

### 9.6 未割当

- `GET /api/unmatched`
- `PUT /api/unmatched/[id]/resolve`

### 9.7 通知

- `POST /api/alerts/check`
  - Cron から呼び出す
- `GET /api/alerts/log`

### 9.8 設定

- `GET /api/settings`
- `PUT /api/settings`

### 9.9 LINE

- `POST /api/line/test`
- `POST /api/line/webhook`
  - 署名検証必須

## 10. バリデーションと競合制御

- `janCode` は数字のみ、8〜14 桁を許可する。
- 商品名と規格は `1..120` 文字。
- 調整理由、廃棄理由、手動解決理由は `1..200` 文字。
- `alertDays` は `1..10` 件まで、各値は `0..365`。
- ロット更新系 API は `version` を必須とし、stale update は `409` を返す。
- 数量変更、廃棄、CSV 実行はいずれもトランザクションで処理する。

## 11. 通知・Cron・LINE

- Cron は `vercel.json` から `1日1回` 実行する。
- エンドポイントは `CRON_SECRET` で保護する。
- LINE 資格情報は環境変数で保持し、設定画面から直接編集しない。
- Webhook は署名検証に失敗した場合 `401` で拒否する。
- v1 の設定画面では「通知時刻変更」は提供しない。
- 通知メッセージは `期限切れ / 7日以内 / 30日以内` ごとに束ねて 1 通で送る。

## 12. セキュリティと運用

- 公開 URL と「認証なし」は同義ではないため、最低限の公開制御を `proxy.ts` に置く。
- DB への直接アクセスはサーバー側に限定する。
- Supabase では全テーブルで `RLS` を有効にする。
- 書込系 API のログには `requestId` または `batchId` を残し、追跡可能にする。
- 監視対象:
  - Cron 実行ログ
  - 取込バッチログ
  - 通知送信ログ
  - 未割当件数の推移

## 13. 受入条件

- 同じ CSV を 2 回 `execute` しても、2 回目は `409` で在庫が変わらない。
- iPhone Safari で `BarcodeDetector` が使えなくても `zxing` 経由でスキャン登録できる。
- `defaultAlertDays` を変更しても既存 SKU の `alertDays` は変わらない。
- 販売履歴、廃棄履歴、調整履歴のいずれかがあるロットは削除できない。
- 在庫不足の CSV 行は `unmatched_sales(reason=INSUFFICIENT_STOCK)` に残る。
- JAN 不一致の CSV 行は `unmatched_sales(reason=NO_PRODUCT)` に残る。
- 既実行行は `DUPLICATE_ROW` として記録される。
- 期限判定は JST 日付だけで変化し、UTC の日跨ぎでは誤判定しない。
- 期限切れ通知は在庫が残る限り、営業日単位で 1 日 1 回送られる。
- 通知先が未設定または LINE 資格情報不足の場合、通知処理は失敗を記録して送信しない。

## 14. 実装優先順

1. Prisma スキーマとマイグレーション
2. 商品 API と商品作成導線
3. ロット CRUD と在庫詳細
4. 在庫一覧とダッシュボード
5. スキャン導線
6. CSV プレビューと実行
7. 通知バッチと LINE Webhook
8. PWA と設定画面

## 15. 未確定事項

- POS 実 CSV の列名差異が出た場合の ParserStrategy の具体的な差し替え単位
- `MANUAL` 売上消し込み UI を v1 に含めるか
- 公開制御を Basic 認証、IP 制限、独自 PIN のどれで行うか
- LINE 通知先を `USER` のみに絞るか、`GROUP / ROOM` まで許容するか

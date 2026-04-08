# OTCChecker 受入試験マトリクス v1

この文書は [spec-v1.2.md](/Users/yusuke/workspace/OTCChecker/docs/spec-v1.2.md) と [api-contract-v1.md](/Users/yusuke/workspace/OTCChecker/docs/api-contract-v1.md) をもとにした受入試験の基準である。  
優先度は `P0` が必須、`P1` が初回リリース前推奨、`P2` が余力対応。

## 1. 商品管理

| ID | 優先度 | 観点 | 前提 | 手順 | 期待結果 |
| --- | --- | --- | --- | --- | --- |
| `PRD-01` | `P0` | 商品新規作成 | `app_settings.defaultAlertDays = [30,7,0]` | `POST /api/products` で `alertDays` 未指定作成 | 作成成功し、保存値が `[30,7,0]` |
| `PRD-02` | `P0` | JAN 正規化 | なし | ハイフン付き JAN で作成 | 数字のみで保存され、同一 JAN の再登録は失敗 |
| `PRD-03` | `P1` | 既定閾値非波及 | 既存商品あり | `PUT /api/settings` で `defaultAlertDays` を変更 | 既存商品の `alertDays` は変化しない |
| `PRD-04` | `P1` | 商品更新 | 商品あり | `PUT /api/products/[id]` | 名称・規格・閾値が更新される |

## 2. ロット管理

| ID | 優先度 | 観点 | 前提 | 手順 | 期待結果 |
| --- | --- | --- | --- | --- | --- |
| `LOT-01` | `P0` | ロット新規登録 | 商品あり | `POST /api/lots` | `ACTIVE` ロットと `receipt_record` が作成される |
| `LOT-02` | `P0` | 同期限集約 | 同一商品・同一期限 ACTIVE ロットあり | 同条件で再度 `POST /api/lots` | 新規ロットは増えず、既存ロットに数量加算される |
| `LOT-03` | `P0` | 数量上書き | lot.version = 3 | `PUT /api/lots/[id]` に `version=3` 送信 | 数量更新、`version` インクリメント、差分があれば `adjustment_record` 生成 |
| `LOT-04` | `P0` | stale version 防止 | lot.version = 4 | `version=3` で `PUT /api/lots/[id]` | `409 STALE_VERSION` |
| `LOT-05` | `P0` | 差分調整 | 在庫 10 | `POST /api/lots/[id]/adjust` で `delta=-2` | 在庫 8、`adjustment_record` 作成 |
| `LOT-06` | `P0` | 負在庫防止 | 在庫 1 | `delta=-2` で調整 | `422 NEGATIVE_STOCK` |
| `LOT-07` | `P0` | 廃棄 | 在庫 5 | `POST /api/lots/[id]/dispose` で 2 廃棄 | 在庫 3、`disposal_record` 作成 |
| `LOT-08` | `P0` | 廃棄超過防止 | 在庫 1 | 2 個廃棄 | `422 INSUFFICIENT_STOCK` |
| `LOT-09` | `P0` | 履歴あり削除禁止 | 売上または廃棄または調整履歴あり | `DELETE /api/lots/[id]` | `409 LOT_DELETE_BLOCKED` |
| `LOT-10` | `P1` | 在庫 0 の archive 化 | 在庫 1 | 1 個廃棄または数量 0 更新 | `status = ARCHIVED` になる |

## 3. 在庫一覧・ダッシュボード

| ID | 優先度 | 観点 | 前提 | 手順 | 期待結果 |
| --- | --- | --- | --- | --- | --- |
| `INV-01` | `P0` | 商品一覧検索 | 複数商品あり | `GET /api/products?q=...` | 商品名または JAN で絞り込まれる |
| `INV-02` | `P0` | バケットフィルタ | 期限差の異なるロットあり | `GET /api/products?bucket=expired/7d/30d` | 仕様どおりの集合が返る |
| `INV-03` | `P1` | ダッシュボード件数 | 期限切れ、当日、7日以内、30日以内のロットあり | `GET /api/dashboard/summary` | 件数が仕様どおり集計される |
| `INV-04` | `P1` | アラート上位順 | 複数対象ロットあり | ダッシュボード取得 | `alertLots` が期限昇順で最大 10 件 |

## 4. スキャン

| ID | 優先度 | 観点 | 前提 | 手順 | 期待結果 |
| --- | --- | --- | --- | --- | --- |
| `SCN-01` | `P0` | iPhone Safari フォールバック | iPhone Safari、`BarcodeDetector` 非対応 | スキャン画面で読取 | `zxing` で読取できる |
| `SCN-02` | `P0` | 手入力代替 | カメラ不許可 | JAN 手入力で登録 | 商品検索または新規作成へ進める |
| `SCN-03` | `P1` | 既存 SKU 導線 | 該当 JAN 商品あり | 読取後に登録 | 商品名・規格が自動表示される |
| `SCN-04` | `P1` | 新規 SKU 導線 | 該当 JAN 商品なし | 読取後に登録 | 新規商品フォームが表示される |

## 5. CSV 取込

| ID | 優先度 | 観点 | 前提 | 手順 | 期待結果 |
| --- | --- | --- | --- | --- | --- |
| `CSV-01` | `P0` | プレビュー非更新 | 商品・在庫あり | `POST /api/import/preview` | DB 在庫が変化しない |
| `CSV-02` | `P0` | 実行成功 | preview 作成済み | `POST /api/import/execute` | FIFO で在庫減算、`sales_records` 作成 |
| `CSV-03` | `P0` | 二重実行防止 | 同一 preview 実行済み | 再度 execute | `409 PREVIEW_ALREADY_EXECUTED` |
| `CSV-04` | `P0` | 同一 CSV 再取込防止 | 同じ `fileHash` の batch が `EXECUTED` | preview 送信 | `409 CSV_ALREADY_EXECUTED` |
| `CSV-05` | `P0` | JAN 未一致 | 商品未登録 JAN を含む CSV | preview -> execute | `unmatched_sales.reason = NO_PRODUCT` が残る |
| `CSV-06` | `P0` | 在庫不足 | 要求数が在庫超過 | preview -> execute | 可能分だけ引当、残りが `INSUFFICIENT_STOCK` |
| `CSV-07` | `P0` | 重複行検出 | 既実行 sourceRowKey あり | preview | `DUPLICATE` と表示される |
| `CSV-08` | `P1` | 文字コード | Shift_JIS CSV | preview | 正常に読める |
| `CSV-09` | `P1` | 監査ログ | execute 成功 | import batch 詳細確認 | `import_batches`, `sales_records`, `unmatched_sales` が整合する |

## 6. 通知・LINE

| ID | 優先度 | 観点 | 前提 | 手順 | 期待結果 |
| --- | --- | --- | --- | --- | --- |
| `ALT-01` | `P0` | Cron secret 検証 | `CRON_SECRET` 設定済み | 誤った secret で `POST /api/alerts/check` | `401 INVALID_CRON_SECRET` |
| `ALT-02` | `P0` | 閾値通知一回性 | 閾値一致ロットあり | 当日 2 回 `alerts/check` 実行 | 初回のみ `alert_log` 作成、2 回目追加なし |
| `ALT-03` | `P0` | 期限切れ日次通知 | 期限切れロットと在庫あり | 営業日をまたいで 2 日実行 | 日ごとに 1 回ずつ `EXPIRED` 記録 |
| `ALT-04` | `P1` | 通知先未設定 | `lineEnabled=true`, `lineTargetId=null` | `alerts/check` 実行 | 送信処理は走らず、失敗で落ちない設計を確認 |
| `ALT-05` | `P1` | LINE Webhook 捕捉 | 署名付き webhook | `POST /api/line/webhook` | `lineTargetType`, `lineTargetId`, `lineEnabled=true` が保存される |
| `ALT-06` | `P1` | 署名エラー | 不正署名 | webhook 実行 | `401 INVALID_LINE_SIGNATURE` |

## 7. 設定

| ID | 優先度 | 観点 | 前提 | 手順 | 期待結果 |
| --- | --- | --- | --- | --- | --- |
| `SET-01` | `P0` | singleton upsert | app_settings なし | `GET /api/settings` | 初期値で自動作成される |
| `SET-02` | `P0` | 閾値正規化 | 重複や昇順配列を送信 | `PUT /api/settings` | 重複除去・降順で保存される |
| `SET-03` | `P1` | LINE 状態更新 | line 設定あり | `PUT /api/settings` | `lineTargetType`, `lineTargetId`, `lineEnabled` が更新される |

## 8. JST 判定

| ID | 優先度 | 観点 | 前提 | 手順 | 期待結果 |
| --- | --- | --- | --- | --- | --- |
| `TZ-01` | `P0` | 期限バケット | `expiryDate` が JST 当日境界にある | JST と UTC の日付差がある時刻で集計 | 判定が JST 基準でのみ変化する |
| `TZ-02` | `P1` | 通知 businessDate | JST 日付変更直後 | `alerts/check` 実行 | `alert_log.businessDate` が JST 日付になる |

## 9. 非機能

| ID | 優先度 | 観点 | 前提 | 手順 | 期待結果 |
| --- | --- | --- | --- | --- | --- |
| `NFR-01` | `P1` | iPhone レイアウト | `iPhone SE` と `iPhone 15 Pro Max` | 主要画面表示 | 横スクロールせず操作できる |
| `NFR-02` | `P1` | オフライン保護 | ネットワーク遮断 | 更新画面を開く | 更新系 UI が無効化またはエラー案内される |
| `NFR-03` | `P2` | PWA 導線 | iPhone Safari | 設定画面確認 | 「ホーム画面に追加」手順が確認できる |

## 10. リリース判定

- `P0` は全件合格必須
- `P1` は未合格項目がある場合、運用影響と回避策を明記して判断する
- `P2` は初回リリースの阻害条件にしない

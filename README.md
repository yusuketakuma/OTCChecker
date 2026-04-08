# OTCChecker

健康食品の賞味期限と在庫を、単一店舗向けに iPhone 中心で運用する Next.js アプリです。

## スタック

- Next.js 16 App Router
- TypeScript
- Tailwind CSS
- Prisma
- PostgreSQL / Supabase
- Cloudflare Workers + OpenNext
- PWA manifest

## セットアップ

1. `.env.example` を `.env.local` にコピー
2. PostgreSQL 接続先を `DATABASE_URL` に設定
3. 依存関係をインストール
4. Prisma Client を生成
5. 必要なら `prisma db push` でテーブル作成
6. `npm run dev` で起動

```bash
npm install
npm run db:generate
npm run db:push
npm run dev
```

Cloudflare Workers でローカル確認する場合は `.dev.vars.example` を `.dev.vars` にコピーして `wrangler` 用の環境変数を設定します。

```bash
cp .dev.vars.example .dev.vars
npm run cf:preview
```

## 主な画面

- `/` ダッシュボード
- `/scan` バーコード登録
- `/inventory` 在庫一覧
- `/inventory/[productId]` 在庫詳細
- `/import` CSV 取込
- `/settings` 運用設定

## 優先運用

- ダッシュボードで期限切れ、7日以内、30日以内を確認
- `/scan` または在庫詳細から入荷登録
- `/import` で売上 CSV を FIFO 消し込み
- 未割当一覧を確認して手動解決
- 在庫詳細で廃棄、調整、入荷、売上履歴を監査

## API

- `GET /api/dashboard/summary`
- `GET/POST /api/products`
- `GET/PUT /api/products/[id]`
- `GET /api/products/jan/[code]`
- `GET/POST /api/lots`
- `PUT/DELETE /api/lots/[id]`
- `POST /api/lots/[id]/adjust`
- `POST /api/lots/[id]/dispose`
- `POST /api/import/preview`
- `POST /api/import/execute`
- `GET /api/unmatched`
- `PUT /api/unmatched/[id]/resolve`
- `GET/PUT /api/settings`
## 検証

```bash
npm run lint
npm run typecheck
npm run build
```

## Cloudflare デプロイ

```bash
npx wrangler login
npx wrangler secret put DATABASE_URL
npm run cf:deploy
```

Cloudflare 向け設定ファイル:

- `wrangler.jsonc`
- `open-next.config.ts`

## 設計資料

- `docs/spec-v1.2.md`
- `prisma/schema.prisma`

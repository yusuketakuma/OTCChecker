# OTCChecker

健康食品の賞味期限と在庫を、単一店舗向けに iPhone 中心で運用する Next.js アプリです。

## スタック

- Next.js 16 App Router
- TypeScript
- Tailwind CSS
- Prisma
- PostgreSQL / Supabase
- LINE Messaging API
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

## 主な画面

- `/` ダッシュボード
- `/scan` バーコード登録
- `/inventory` 在庫一覧
- `/inventory/[productId]` 在庫詳細
- `/import` CSV 取込
- `/settings` 運用設定

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
- `POST /api/alerts/check`
- `GET /api/alerts/log`
- `POST /api/line/test`
- `POST /api/line/webhook`

## 検証

```bash
npm run lint
npm run typecheck
npm run build
```

## 設計資料

- `docs/spec-v1.2.md`
- `prisma/schema.prisma`

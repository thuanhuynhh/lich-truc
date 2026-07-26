# Lịch trực

Ứng dụng quản lý lịch trực, nhân sự, đổi lịch, nghỉ phép và báo cáo trực.

Repository: <https://github.com/thuanhuynhh/lich-truc>

## Công nghệ

- React + Vite + TypeScript
- Cloudflare Workers phục vụ API và static assets
- Cloudflare Hyperdrive kết nối PostgreSQL trong cấu hình hiện tại
- SQL migrations trong `migrations/`
- Vitest cho unit tests

## Yêu cầu

- Node.js 20 LTS trở lên
- npm
- Tài khoản Cloudflare nếu muốn deploy
- Wrangler 4.x (đã có trong `devDependencies`)

## Cài đặt

```bash
git clone https://github.com/thuanhuynhh/lich-truc.git
cd lich-truc
npm install
```

`node_modules/` không được commit. Chỉ cần chạy `npm install` để tải lại module từ `package-lock.json`.

## Chạy và kiểm thử local

```bash
npm run build       # TypeScript + Vite build
npm test            # Unit tests
npm run dev         # Frontend: http://127.0.0.1:5173
npm run worker:dev  # Worker: http://localhost:8787
```

Secret local đặt trong `.dev.vars`; không commit file này.

## Deploy Cloudflare Worker

```bash
npx wrangler login
npx wrangler whoami
npm run worker:types
npm run build
npm run deploy:dry
npm run deploy
```

Cấu hình Worker nằm ở [`wrangler.jsonc`](./wrangler.jsonc). Cấu hình hiện tại đã bật SPA assets, `nodejs_compat`, observability và binding Hyperdrive.

## Database hiện tại: Hyperdrive + PostgreSQL

Worker hiện tại đọc `env.HYPERDRIVE.connectionString` và dùng adapter PostgreSQL trong `src/worker/database.ts`. Vì vậy production cần PostgreSQL và một Cloudflare Hyperdrive config trỏ đến database đó.

Schema PostgreSQL nằm ở [`postgres/schema.sql`](./postgres/schema.sql). Tạo Hyperdrive bằng Wrangler, không ghi password vào Git:

```bash
npx wrangler hyperdrive create lich-truc-db \
  --connection-string "$HYPERDRIVE_CONNECTION_STRING"
```

Sau đó cập nhật `hyperdrive[0].id` trong `wrangler.jsonc` và chạy `npm run worker:types`.

## Dùng Cloudflare D1

> Lưu ý: migration trong `migrations/` có định dạng SQLite/D1, nhưng Worker hiện tại đang chạy PostgreSQL qua Hyperdrive. Chỉ thêm D1 binding chưa đủ để chuyển production sang D1; cần thay adapter trong `src/worker/index.ts` và `src/worker/database.ts` sang `D1Database`.

Chuẩn bị database và migration D1:

```bash
npx wrangler d1 create lich-truc-cdha
npx wrangler d1 migrations apply lich-truc-cdha --local
npx wrangler d1 migrations list lich-truc-cdha --remote
# Chỉ chạy dòng dưới sau khi Worker đã chuyển sang D1:
npx wrangler d1 migrations apply lich-truc-cdha --remote
```

Binding D1 mẫu trong `wrangler.jsonc`:

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "lich-truc-cdha",
      "database_id": "<DATABASE_ID>",
      "migrations_dir": "./migrations"
    }
  ]
}
```

Sau mỗi thay đổi binding, chạy:

```bash
npm run worker:types
```

## Skill AI cho Cloudflare

AI skills không phải dependency runtime. Chúng giúp Codex, Claude Code hoặc coding agent hiểu đúng Workers, D1 và Wrangler. Danh sách skill của project nằm ở [`skills-lock.json`](./skills-lock.json).

Cài các skill Cloudflare:

```bash
npx skills add https://github.com/cloudflare/skills \
  --skill cloudflare \
  --skill wrangler \
  --skill workers-best-practices \
  --skill agents-sdk
```

- `cloudflare`: chọn đúng sản phẩm Cloudflare như Workers, D1 và Hyperdrive.
- `wrangler`: lệnh CLI, binding, migration và deploy.
- `workers-best-practices`: kiểm tra secret, binding và cấu hình production.
- `agents-sdk`: dùng khi bổ sung AI agent stateful hoặc workflow vào Worker.

## Cấu trúc chính

```text
src/app/          Frontend React
src/worker/       Worker API và database adapter
src/shared/       TypeScript types và business rules
migrations/       Migration SQLite/D1
postgres/         Schema PostgreSQL
tests/            Unit tests
wrangler.jsonc    Cấu hình Cloudflare Worker
```

## An toàn

- Không commit `node_modules/`, `.dev.vars`, log, file tạm hoặc password.
- Không đưa connection string PostgreSQL vào `wrangler.jsonc` hay source code.
- Dùng `wrangler secret put` cho secret production.
- Chạy `npm run deploy:dry` trước khi deploy production.

## Tài liệu

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/)
- [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Cloudflare Hyperdrive](https://developers.cloudflare.com/hyperdrive/)
- [Cloudflare AI skills](https://github.com/cloudflare/skills)

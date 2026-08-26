# Lịch khám sức khỏe toàn dân

Ứng dụng quản lý lịch khám sức khỏe toàn dân: mở ngày làm việc theo buổi, phân công khoa phòng theo tua, khoa phòng tự điền người đi làm kèm số điện thoại, và báo cáo làm việc có điểm danh, ký tên.

Repository: <https://github.com/thuanhuynhh/lich-truc> (branch `lich-ksktd`)

## Mô hình nghiệp vụ

- **Ngày làm việc**: lịch không chạy liên tục T2–CN. Quản lý hoặc điều phối mở từng ngày khám và chọn buổi làm: **Sáng**, **Chiều** hoặc **Cả buổi**. Chỉ những ngày đã mở mới thành cột trong bảng lịch.
- **Bảng lịch**: hàng đầu là **hàng điều phối** (ai phụ trách buổi khám hôm đó). Các hàng tiếp theo là **vị trí khám** (ví dụ Khám nội, Khám ngoại), gom theo **mục** do quản lý tự thêm trong trang Cấu hình. Mỗi ô chứa một hoặc nhiều khoa phòng, kèm họ tên và số điện thoại người đi làm.
- **Tua khám**: mỗi vị trí khám có cấu hình tua riêng, mở từ nút "Tua" ngay trên hàng của vị trí đó. Một tua có thể gồm nhiều khoa phòng cùng đứng vị trí đó trong ngày. Tua xoay theo thứ tự **ngày làm việc**, không theo ngày dương lịch. Áp tua vẫn giữ lại họ tên và số điện thoại khoa phòng đã điền.
- **Đổi ngày làm của điều phối**: điều phối xin đổi ngày làm với một điều phối khác; yêu cầu chỉ có hiệu lực khi người kia đồng ý (qua thông báo trong app hoặc link xác nhận). Quản lý xếp lịch trực tiếp, không cần duyệt.
- **Báo cáo làm việc**: mỗi ngày làm có một báo cáo. Điều phối phụ trách nhập số liệu buổi khám; từng khoa phòng điểm danh và ký tên; điều phối ký chốt. Sau khi ký chốt chỉ quản lý còn sửa được số liệu.

## Ba vai trò

| Vai trò | Quyền |
| --- | --- |
| `admin` (Quản lý) | Toàn quyền: mục và vị trí khám, khoa phòng, tài khoản, cấu hình, ngày làm, phân công, hàng điều phối, tua, báo cáo |
| `dieu_phoi` (Điều phối) | Mở/sửa ngày làm, phân công khoa phòng vào vị trí, cấu hình và áp tua, nhập và ký chốt báo cáo ngày mình phụ trách, xin đổi ngày làm. Không thêm/sửa mục, vị trí khám, khoa phòng, tài khoản hay cấu hình |
| `khoa_phong` (Khoa phòng) | Xem lịch; điền và sửa họ tên + số điện thoại người đi làm của khoa phòng mình; điểm danh và ký tên trong báo cáo làm việc |

Khoa phòng sửa được người đi làm khi ngày làm **chưa qua**. Cấu hình `lock_person_on_workday` cho phép siết lại: phải điền xong **trước** ngày khám.

## Công nghệ

- React + Vite + TypeScript
- Cloudflare Workers phục vụ API và static assets
- Cloudflare Hyperdrive kết nối PostgreSQL
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
git checkout lich-ksktd
npm install
```

## Chạy và kiểm thử local

```bash
npm run build       # TypeScript + Vite build
npm test            # Unit tests
npm run dev         # Frontend: http://127.0.0.1:5173
npm run worker:dev  # Worker: http://localhost:8787
```

Chạy cả `npm run dev` và `npm run worker:dev` mới có API. Secret local đặt trong `.dev.vars`, không commit file này.

## Database

Schema nằm ở [`postgres/schema.sql`](./postgres/schema.sql), dùng schema PostgreSQL `lich_ksktd`. Đây là **schema mới hoàn toàn**, không nâng cấp từ dữ liệu lịch trực cũ vì nghiệp vụ đã khác (nhân sự → khoa phòng, lịch tuần → ngày làm việc).

Khởi tạo:

```bash
psql "$DATABASE_URL" -f postgres/schema.sql
DATABASE_URL="$DATABASE_URL" npm run db:create-admin -- admin 'MatKhauManh' 'Nguyễn Văn A'
```

Sau đó đăng nhập bằng tài khoản quản lý vừa tạo để thêm mục và vị trí khám (trang Cấu hình), khoa phòng, rồi tài khoản điều phối và khoa phòng.

> Hyperdrive mặc định bật cache truy vấn 60 giây. Ứng dụng đọc lại dữ liệu ngay sau khi ghi nên phải tắt cache:
> `npx wrangler hyperdrive update <id> --caching-disabled`.

Tạo Hyperdrive trỏ tới database này, không ghi password vào Git:

```bash
npx wrangler hyperdrive create lich-ksktd-db \
  --connection-string "$HYPERDRIVE_CONNECTION_STRING"
```

Cập nhật `hyperdrive[0].id` trong `wrangler.jsonc` rồi chạy `npm run worker:types`.

## Deploy Cloudflare Worker

```bash
npx wrangler login
npx wrangler whoami
npm run worker:types
npm run build
npm run deploy:dry
npm run deploy
```

## Cấu trúc chính

```text
src/app/          Frontend React (lịch, ngày làm, báo cáo, quản trị)
src/worker/       Worker API và adapter PostgreSQL
src/shared/       TypeScript types và business rules dùng chung
postgres/         Schema PostgreSQL
scripts/          Script tạo tài khoản quản lý đầu tiên
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
- [Cloudflare Hyperdrive](https://developers.cloudflare.com/hyperdrive/)

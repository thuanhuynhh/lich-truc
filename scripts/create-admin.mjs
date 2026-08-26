/**
 * Tạo tài khoản quản lý đầu tiên cho lịch khám sức khỏe toàn dân.
 *
 * Cách dùng:
 *   DATABASE_URL=postgres://... node scripts/create-admin.mjs <username> <password> ["Họ và tên"]
 *
 * Mật khẩu được băm giống hệt worker: SHA-256 của chuỗi `${salt}:${password}`.
 */
import { randomUUID, webcrypto } from "node:crypto";
import pg from "pg";

const [username, password, fullName = ""] = process.argv.slice(2);
const connectionString = process.env.DATABASE_URL;

if (!connectionString || !username || !password) {
  throw new Error(
    "Usage: DATABASE_URL=postgres://... node scripts/create-admin.mjs <username> <password> [\"Họ và tên\"]"
  );
}
if (password.length < 6) throw new Error("Mật khẩu cần ít nhất 6 ký tự.");

async function hashPassword(salt, plain) {
  const input = new TextEncoder().encode(`${salt}:${plain}`);
  const digest = await webcrypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const client = new pg.Client({ connectionString });
await client.connect();

try {
  await client.query("SET search_path TO lich_ksktd, public");
  const salt = randomUUID();
  const passwordHash = await hashPassword(salt, password);

  const result = await client.query(
    `INSERT INTO users (username, password_salt, password_hash, role, full_name)
     VALUES ($1, $2, $3, 'admin', $4)
     ON CONFLICT (username) DO UPDATE
       SET password_salt = EXCLUDED.password_salt,
           password_hash = EXCLUDED.password_hash,
           role = 'admin',
           disabled = 0,
           updated_at = CURRENT_TIMESTAMP
     RETURNING id`,
    [username, salt, passwordHash, fullName]
  );

  console.log(`Đã tạo/cập nhật tài khoản quản lý "${username}" (id=${result.rows[0].id}).`);
} finally {
  await client.end();
}

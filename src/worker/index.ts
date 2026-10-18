import type {
  Assignment,
  AuditLog,
  DutyReport,
  LeaveDay,
  NotificationItem,
  Role,
  ScheduleResponse,
  ScheduleUnit,
  Staff,
  StaffType,
  UnitRotation,
  User,
  SystemSettings,
  PendingLeave
} from "../shared/types";
import { acceptsStaffTypeForUnit, addDays, conflictsWithDutyLeave, getWeekDays, normalizeWeekStart, postDutyOffDate, shouldSyncPostDutyOffDate, getDayOfWeekLabel, formatDate, isIsoDate, rotationTurnIndex, todayInVietnam, workRotationAssignmentsForDates, workRotationAssignmentsForStaff } from "../shared/schedule";
import { getAuditActionValues } from "../shared/audit";
import { isReportRole, resolveReportSignerName, validateAssignmentInput, validateLeaveInput } from "../shared/validation";
import { PostgresDatabase, type PostgresPreparedStatement, createPostgresClient } from "./database";

interface Env {
  DB: PostgresDatabase;
}

interface SessionUser extends User {
  sessionId: string;
}

const SESSION_COOKIE = "lt_session";
const SESSION_DAYS = 14;

export function dutyReportUpdateWhere(_role: Role): string {
  return "date = ?";
}

export function rotationStaffLookup(staffIds: number[]): { sql: string; bindings: number[] } {
  return {
    sql: `SELECT id, family_middle_name, name, type, active FROM staff WHERE id IN (${staffIds.map(() => "?").join(", ")})`,
    bindings: staffIds
  };
}

export function rotationMembersInsert(unitId: number, turns: number[][]): { sql: string; bindings: number[] } {
  const bindings: number[] = [];
  const values = turns.flatMap((turn, turnIndex) =>
    turn.map((staffId, memberOrder) => {
      bindings.push(unitId, turnIndex, staffId, memberOrder);
      return "(?, ?, ?, ?)";
    })
  );
  return {
    sql: `INSERT INTO unit_rotation_members (unit_id, turn_index, staff_id, member_order) VALUES ${values.join(", ")}`,
    bindings
  };
}

export default {
  async fetch(request: Request, bindings: Cloudflare.Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return bindings.ASSETS.fetch(request);

    const client = createPostgresClient(bindings.HYPERDRIVE.connectionString);
    try {
      await client.connect();
      return await routeApi(request, { DB: new PostgresDatabase(client) }, url);
    } catch (error) {
      const message = error instanceof HttpError ? error.message : "Có lỗi hệ thống.";
      const status = error instanceof HttpError ? error.status : 500;
      if (!(error instanceof HttpError)) console.error({ event: "api_request_failed", error });
      return json({ error: message }, status);
    } finally {
      await client.end().catch((error) => console.error({ event: "postgres_disconnect_failed", error }));
    }
  }
} satisfies ExportedHandler<Cloudflare.Env>;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function routeApi(request: Request, env: Env, url: URL): Promise<Response> {
  const method = request.method.toUpperCase();
  const path = url.pathname;

  if (path === "/api/auth/login" && method === "POST") return login(request, env);
  if (path === "/api/auth/logout" && method === "POST") return logout(request, env);

  const user = await requireUser(request, env);

  if (path === "/api/swap/request" && method === "GET") return getSwapRequestPublic(env, url, user);
  if (path === "/api/swap/accept" && method === "POST") return acceptSwapPublic(env, url, user);
  if (path === "/api/swap/reject" && method === "POST") return rejectSwapPublic(env, url, user);

  if (path === "/api/auth/me" && method === "GET") return json({ user: publicUser(user) });
  if (path === "/api/notifications" && method === "GET") return getNotifications(env, user);
  if (path === "/api/notifications/read" && method === "POST") return markNotificationsRead(request, env, user);
  if (path === "/api/profile" && method === "PATCH") return updateProfile(request, env, user);
  if (path === "/api/staff" && method === "GET") return json({ staff: await listStaff(env) });
  if (path === "/api/staff" && method === "POST") return createStaff(request, env, user);
  if (path.startsWith("/api/staff/") && method === "PATCH") return updateStaff(request, env, user, idFromPath(path));
  if (path.startsWith("/api/staff/") && method === "DELETE") return deleteStaff(env, user, idFromPath(path));

  if (path === "/api/users" && method === "GET") return listUsers(env, user);
  if (path === "/api/users" && method === "POST") return createUser(request, env, user);
  if (path.startsWith("/api/users/") && method === "PATCH") return updateUser(request, env, user, idFromPath(path));
  if (path.startsWith("/api/users/") && method === "DELETE") return deleteUser(env, user, idFromPath(path));

  // Admin configuration settings
  if (path === "/api/settings" && method === "GET") return getSettingsEndpoint(env, user);
  if (path === "/api/settings" && method === "POST") return saveSettingsEndpoint(request, env, user);
  if (path === "/api/settings/blocked-days" && method === "POST") return addBlockedDay(request, env, user);
  if (path.startsWith("/api/settings/blocked-days/") && method === "DELETE") {
    return deleteBlockedDay(env, user, path.split("/").pop() || "");
  }

  if (path === "/api/schedule" && method === "GET") return getSchedule(env, url, user);
  if (path === "/api/schedule/assignment" && method === "PUT") return putAssignment(request, env, user);
  if (path.match(/^\/api\/schedule\/assignment\/\d+\/move$/) && method === "PATCH") {
    return moveAssignment(request, env, user, Number(path.split("/").at(-2)));
  }
  if (path.startsWith("/api/schedule/assignment/") && method === "DELETE") {
    return deleteAssignment(env, user, idFromPath(path));
  }
  if (path === "/api/schedule/confirm" && method === "POST") return confirmSchedule(request, env, user);
  if (path === "/api/schedule/clear" && method === "POST") return clearSchedule(request, env, user);
  if (path === "/api/schedule/recalculate-work" && method === "POST") return recalculateWorkSchedule(request, env, user);
  if (path.match(/^\/api\/rotations\/\d+$/) && method === "PUT") return saveRotation(request, env, user, idFromPath(path));
  if (path.match(/^\/api\/rotations\/\d+\/apply$/) && method === "POST") {
    return applyRotation(request, env, user, Number(path.split("/").at(-2)));
  }
  if (path === "/api/units/reorder" && method === "POST") return reorderUnits(request, env, user);
  if (path === "/api/units" && method === "POST") return createUnit(request, env, user);
  if (path.match(/^\/api\/units\/\d+$/) && method === "PATCH") return updateUnit(request, env, user, idFromPath(path));
  if (path.match(/^\/api\/units\/\d+$/) && method === "DELETE") return deleteUnit(env, user, idFromPath(path));

  if (path === "/api/leave/month" && method === "GET") return getLeaveMonth(env, url, user);
  if (path === "/api/leave" && method === "GET") return getLeave(env, url);
  if (path === "/api/leave" && method === "POST") return createLeave(request, env, user);
  if (path.startsWith("/api/leave-day/") && method === "DELETE") return cancelLeaveDay(env, user, idFromPath(path));
  if (path.startsWith("/api/leave/") && method === "DELETE") return cancelLeave(env, user, idFromPath(path));

  // Leave approvals
  if (path.match(/^\/api\/leave\/\d+\/approve$/) && method === "POST") {
    return approveLeave(env, user, Number(path.split("/").at(-2)));
  }
  if (path.match(/^\/api\/leave\/\d+\/reject$/) && method === "POST") {
    return rejectLeave(env, user, Number(path.split("/").at(-2)));
  }

  if (path === "/api/audit" && method === "GET") return getAudit(env, url, user);
  if (path === "/api/audit" && method === "DELETE") return deleteAuditEndpoint(env, user);

  // Duty reports
  if (path === "/api/reports" && method === "GET") return getReportEndpoint(env, url, user);
  if (path === "/api/reports/list" && method === "GET") return listReportsEndpoint(env);
  if (path === "/api/reports" && method === "POST") return saveReportEndpoint(request, env, user);
  if (path === "/api/reports" && method === "DELETE") return deleteReportEndpoint(env, url, user);
  if (path === "/api/reports/sign" && method === "POST") return signReportEndpoint(request, env, user);

  throw new HttpError(404, "Không tìm thấy API.");
}

async function login(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ username?: string; password?: string }>(request);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!username || !password) throw new HttpError(400, "Thiếu tên đăng nhập hoặc mật khẩu.");

  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.password_salt, u.password_hash, u.role, u.staff_id, s.name AS staff_name,
            TRIM(COALESCE(s.family_middle_name, '') || ' ' || COALESCE(s.name, '')) AS staff_full_name, u.signature
     FROM users u LEFT JOIN staff s ON s.id = u.staff_id
     WHERE lower(u.username) = lower(?) AND u.disabled = 0`
  ).bind(username).first<UserRow & { password_salt: string; password_hash: string }>();

  if (!row) throw new HttpError(401, "Sai tên đăng nhập hoặc mật khẩu.");
  const hash = await hashPassword(row.password_salt, password);
  if (hash !== row.password_hash) throw new HttpError(401, "Sai tên đăng nhập hoặc mật khẩu.");

  const sessionId = crypto.randomUUID();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await env.DB.prepare("INSERT INTO user_sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(sessionId, row.id, expires)
    .run();
  await audit(env, row.id, "login", "user", row.id, `Đăng nhập: ${row.username}`);

  return json(
    { user: publicUser(mapUserRow(row)) },
    200,
    { "Set-Cookie": cookie(request, SESSION_COOKIE, sessionId, SESSION_DAYS * 86400) }
  );
}

async function logout(request: Request, env: Env): Promise<Response> {
  const sessionId = parseCookies(request.headers.get("Cookie")).get(SESSION_COOKIE);
  if (sessionId) {
    await env.DB.prepare("DELETE FROM user_sessions WHERE id = ?").bind(sessionId).run();
  }
  return json({ ok: true }, 200, { "Set-Cookie": cookie(request, SESSION_COOKIE, "", 0) });
}

async function requireUser(request: Request, env: Env): Promise<SessionUser> {
  const sessionId = parseCookies(request.headers.get("Cookie")).get(SESSION_COOKIE);
  if (!sessionId) throw new HttpError(401, "Chưa đăng nhập.");
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.role, u.staff_id, s.name AS staff_name,
            TRIM(COALESCE(s.family_middle_name, '') || ' ' || COALESCE(s.name, '')) AS staff_full_name,
            us.id AS session_id, u.signature
     FROM user_sessions us
     JOIN users u ON u.id = us.user_id
     LEFT JOIN staff s ON s.id = u.staff_id
     WHERE us.id = ? AND us.expires_at > CURRENT_TIMESTAMP AND u.disabled = 0`
  ).bind(sessionId).first<UserRow & { session_id: string }>();
  if (!row) throw new HttpError(401, "Phiên đăng nhập đã hết hạn.");
  return { ...mapUserRow(row), sessionId: row.session_id };
}

function requireAdmin(user: User): void {
  if (user.role !== "admin") throw new HttpError(403, "Chỉ admin được thực hiện thao tác này.");
}

async function updateProfile(request: Request, env: Env, user: SessionUser): Promise<Response> {
  const body = await readJson<{ currentPassword?: string; newPassword?: string; signature?: string | null }>(request);
  const changesSignature = Object.prototype.hasOwnProperty.call(body, "signature");
  const newPassword = String(body.newPassword || "");

  if (!changesSignature && !newPassword) throw new HttpError(400, "Không có thay đổi để lưu.");
  if (changesSignature && body.signature && !isSignatureDataUrl(body.signature)) {
    throw new HttpError(400, "Chữ ký mẫu không hợp lệ.");
  }

  if (newPassword) {
    if (newPassword.length < 6) throw new HttpError(400, "Mật khẩu mới cần ít nhất 6 ký tự.");
    const password = await env.DB.prepare("SELECT password_salt, password_hash FROM users WHERE id = ?")
      .bind(user.id)
      .first<{ password_salt: string; password_hash: string }>();
    if (!password || await hashPassword(password.password_salt, String(body.currentPassword || "")) !== password.password_hash) {
      throw new HttpError(400, "Mật khẩu hiện tại không đúng.");
    }
    const salt = crypto.randomUUID();
    const passwordHash = await hashPassword(salt, newPassword);
    try {
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET password_salt = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind(salt, passwordHash, user.id),
        env.DB.prepare("DELETE FROM user_sessions WHERE user_id = ? AND id <> ?")
          .bind(user.id, user.sessionId),
        env.DB.prepare(
          "INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, summary, payload) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(user.id, "update", "user", user.id, "Tự đổi mật khẩu", null)
      ]);
    } catch (error) {
      console.error({ event: "profile_password_update_failed", userId: user.id, error });
      throw new HttpError(503, "Hệ thống tạm thời không thể lưu mật khẩu. Vui lòng thử lại.");
    }
  }

  if (changesSignature) {
    await env.DB.prepare("UPDATE users SET signature = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(body.signature ?? null, user.id)
      .run();
    await audit(env, user.id, "update", "user", user.id, body.signature ? "Cập nhật chữ ký mẫu" : "Xóa chữ ký mẫu");
  }

  const updated = await env.DB.prepare(
    `SELECT u.id, u.username, u.role, u.staff_id, s.name AS staff_name,
            TRIM(COALESCE(s.family_middle_name, '') || ' ' || COALESCE(s.name, '')) AS staff_full_name, u.signature
     FROM users u LEFT JOIN staff s ON s.id = u.staff_id WHERE u.id = ?`
  ).bind(user.id).first<UserRow>();
  if (!updated) throw new HttpError(404, "Không tìm thấy tài khoản.");
  return json({ user: publicUser(mapUserRow(updated)) });
}

async function listStaff(env: Env): Promise<Staff[]> {
  const { results } = await env.DB.prepare(
    "SELECT id, family_middle_name, name, type, active FROM staff ORDER BY active DESC, type, name"
  ).all<StaffRow>();
  return results.map(mapStaffRow);
}

async function createStaff(request: Request, env: Env, user: User): Promise<Response> {
  requireAdmin(user);
  const body = await readJson<{ familyMiddleName?: string; name?: string; type?: StaffType }>(request);
  const familyMiddleName = String(body.familyMiddleName || "").trim();
  const name = String(body.name || "").trim();
  const type = body.type;
  if (!name || !isStaffType(type)) {
    throw new HttpError(400, "Tên và loại nhân sự không hợp lệ.");
  }
  const result = await env.DB.prepare("INSERT INTO staff (family_middle_name, name, type, active) VALUES (?, ?, ?, 1)")
    .bind(familyMiddleName, name, type)
    .run();
  await audit(env, user.id, "create", "staff", result.meta.last_row_id, `Thêm nhân sự ${type}: ${name}`);
  return json({ staff: await listStaff(env) }, 201);
}

async function updateStaff(request: Request, env: Env, user: User, id: number): Promise<Response> {
  requireAdmin(user);
  const body = await readJson<{ familyMiddleName?: string; name?: string; type?: StaffType; active?: boolean }>(request);
  const current = await getStaffById(env, id);
  const familyMiddleName = String(body.familyMiddleName ?? current.familyMiddleName).trim();
  const name = String(body.name ?? current.name).trim();
  const type = body.type ?? current.type;
  const active = body.active === undefined ? current.active : !!body.active;
  if (!name || !isStaffType(type)) throw new HttpError(400, "Dữ liệu nhân sự không hợp lệ.");
  await env.DB.prepare("UPDATE staff SET family_middle_name = ?, name = ?, type = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(familyMiddleName, name, type, active ? 1 : 0, id)
    .run();
  await audit(env, user.id, "update", "staff", id, `Cập nhật nhân sự: ${name}`);
  return json({ staff: await listStaff(env) });
}

async function deleteStaff(env: Env, user: User, id: number): Promise<Response> {
  requireAdmin(user);
  const staff = await getStaffById(env, id);
  await env.DB.prepare("DELETE FROM staff WHERE id = ?").bind(id).run();
  await audit(env, user.id, "delete", "staff", id, `Xóa nhân sự: ${staff.name}`);
  return json({ staff: await listStaff(env) });
}

async function listUsers(env: Env, user: User): Promise<Response> {
  requireAdmin(user);
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.username, u.role, u.staff_id, s.name AS staff_name, u.signature
     FROM users u LEFT JOIN staff s ON s.id = u.staff_id
     WHERE u.disabled = 0
     ORDER BY u.username`
  ).all<UserRow>();
  return json({ users: results.map(mapUserRow) });
}

async function createUser(request: Request, env: Env, user: User): Promise<Response> {
  requireAdmin(user);
  const body = await readJson<{ username?: string; password?: string; role?: Role; staffId?: number | null; signature?: string | null }>(request);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const role = body.role;
  if (!username || password.length < 6 || !isRole(role)) {
    throw new HttpError(400, "Tài khoản cần username, mật khẩu ít nhất 6 ký tự và role hợp lệ.");
  }
  if (body.signature && !isSignatureDataUrl(body.signature)) throw new HttpError(400, "Chữ ký mẫu không hợp lệ.");
  await assertUsernameAvailable(env, username);
  const staffId = body.staffId ?? null;
  if ((role === "bs" || role === "ktv" || role === "tkyk") && !staffId) {
    throw new HttpError(400, "Tài khoản BS/KTV/TKYK cần chọn nhân sự liên kết.");
  }
  if (staffId) await assertStaffMatchesRole(env, staffId, role);
  const salt = crypto.randomUUID();
  const passwordHash = await hashPassword(salt, password);
  const result = await env.DB.prepare(
    "INSERT INTO users (username, password_salt, password_hash, role, staff_id, signature) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(username, salt, passwordHash, role, staffId, body.signature || null).run();
  await audit(env, user.id, "create", "user", result.meta.last_row_id, `Tạo tài khoản: ${username}`);
  return listUsers(env, user);
}

export function passwordResetSessionCleanup(
  actorId: number,
  targetId: number,
  currentSessionId: string
): { sql: string; bindings: Array<number | string> } {
  return actorId === targetId
    ? {
        sql: "DELETE FROM user_sessions WHERE user_id = ? AND id <> ?",
        bindings: [targetId, currentSessionId]
      }
    : {
        sql: "DELETE FROM user_sessions WHERE user_id = ?",
        bindings: [targetId]
      };
}

async function updateUser(request: Request, env: Env, user: SessionUser, id: number): Promise<Response> {
  requireAdmin(user);
  const body = await readJson<{ username?: string; password?: string; role?: Role; staffId?: number | null; signature?: string | null }>(request);
  const current = await env.DB.prepare("SELECT id, username, role, staff_id, signature FROM users WHERE id = ?").bind(id).first<UserRow>();
  if (!current) throw new HttpError(404, "Không tìm thấy tài khoản.");
  const username = String(body.username ?? current.username).trim();
  const role = body.role ?? current.role;
  const staffId = body.staffId === undefined ? current.staff_id : body.staffId;
  const signature = body.signature === undefined ? current.signature : body.signature;
  if (!username) throw new HttpError(400, "Username không hợp lệ.");
  if (!isRole(role)) throw new HttpError(400, "Role không hợp lệ.");
  if (signature && !isSignatureDataUrl(signature)) throw new HttpError(400, "Chữ ký mẫu không hợp lệ.");
  await assertUsernameAvailable(env, username, id);
  if (staffId) await assertStaffMatchesRole(env, staffId, role);
  if ((role === "bs" || role === "ktv" || role === "tkyk") && !staffId) throw new HttpError(400, "Tài khoản BS/KTV/TKYK cần liên kết nhân sự.");
  const statements: PostgresPreparedStatement[] = [
    env.DB.prepare("UPDATE users SET username = ?, role = ?, staff_id = ?, signature = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(username, role, staffId ?? null, signature ?? null, id)
  ];
  if (body.password) {
    if (body.password.length < 6) throw new HttpError(400, "Mật khẩu mới cần ít nhất 6 ký tự.");
    const salt = crypto.randomUUID();
    const passwordHash = await hashPassword(salt, body.password);
    statements.push(
      env.DB.prepare("UPDATE users SET password_salt = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(salt, passwordHash, id)
    );
    const cleanup = passwordResetSessionCleanup(user.id, id, user.sessionId);
    statements.push(env.DB.prepare(cleanup.sql).bind(...cleanup.bindings));
  }
  statements.push(
    env.DB.prepare(
      "INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, summary, payload) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(user.id, "update", "user", id, `Cập nhật tài khoản: ${current.username}`, null)
  );
  try {
    await env.DB.batch(statements);
  } catch (error) {
    console.error({ event: "admin_user_update_failed", actorUserId: user.id, targetUserId: id, error });
    throw new HttpError(503, "Hệ thống tạm thời không thể cập nhật tài khoản. Vui lòng thử lại.");
  }
  return listUsers(env, user);
}

async function deleteUser(env: Env, user: User, id: number): Promise<Response> {
  requireAdmin(user);
  if (user.id === id) throw new HttpError(400, "Không thể xóa tài khoản đang đăng nhập.");
  const current = await env.DB.prepare("SELECT id, username FROM users WHERE id = ?").bind(id).first<{ id: number; username: string }>();
  if (!current) throw new HttpError(404, "Không tìm thấy tài khoản.");
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
  await audit(env, user.id, "delete", "user", id, `Xóa tài khoản: ${current.username}`);
  return listUsers(env, user);
}

async function getNotifications(env: Env, user: User): Promise<Response> {
  const notifications = await listNotifications(env, user);
  if (notifications.length === 0) return json({ notifications });
  const placeholders = notifications.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT notification_id FROM notification_reads
     WHERE user_id = ? AND notification_id IN (${placeholders})`
  ).bind(user.id, ...notifications.map((item) => item.id)).all<{ notification_id: string }>();
  const readIds = new Set(results.map((row) => row.notification_id));
  return json({ notifications: notifications.map((item) => ({ ...item, read: readIds.has(item.id) })) });
}

async function markNotificationsRead(request: Request, env: Env, user: User): Promise<Response> {
  const body = await readJson<{ notificationId?: string; all?: boolean }>(request);
  const notifications = await listNotifications(env, user);
  const ids = body.all
    ? notifications.map((item) => item.id)
    : notifications.some((item) => item.id === body.notificationId)
      ? [body.notificationId as string]
      : [];
  if (!body.all && ids.length === 0) throw new HttpError(404, "Không tìm thấy thông báo.");
  if (ids.length > 0) {
    await env.DB.batch(ids.map((id) => env.DB.prepare(
      `INSERT INTO notification_reads (user_id, notification_id, read_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, notification_id) DO UPDATE SET read_at = CURRENT_TIMESTAMP`
    ).bind(user.id, id)));
  }
  return getNotifications(env, user);
}

async function listNotifications(env: Env, user: User): Promise<Array<Omit<NotificationItem, "read">>> {
  const notifications: Array<Omit<NotificationItem, "read">> = [];

  if (user.staffId) {
    const { results: swaps } = await env.DB.prepare(
      `SELECT sr.id, sr.token, sr.created_at, sr.staff_id_1, sr.staff_id_2,
              creator.staff_id AS creator_staff_id,
              s1.name AS staff_name_1, s2.name AS staff_name_2,
              sr.date_1, sr.date_2
       FROM swap_requests sr
       LEFT JOIN users creator ON creator.id = sr.created_by
       JOIN staff s1 ON s1.id = sr.staff_id_1
       JOIN staff s2 ON s2.id = sr.staff_id_2
       WHERE sr.status = 'pending'
         AND (sr.expires_at IS NULL OR sr.expires_at > CURRENT_TIMESTAMP)
         AND (sr.staff_id_1 = ? OR sr.staff_id_2 = ?)
       ORDER BY sr.created_at DESC
       LIMIT 20`
    ).bind(user.staffId, user.staffId).all<{
      id: number; token: string; created_at: string;
      staff_id_1: number; staff_id_2: number; creator_staff_id: number | null;
      staff_name_1: string; staff_name_2: string; date_1: string; date_2: string;
    }>();

    for (const row of swaps) {
      const recipientId = row.creator_staff_id === row.staff_id_1
        ? row.staff_id_2
        : row.creator_staff_id === row.staff_id_2
          ? row.staff_id_1
          : null;
      const isRecipient = recipientId === user.staffId;
      notifications.push({
        id: `swap-${row.id}`,
        type: "swap",
        title: isRecipient ? "Yêu cầu đổi trực" : "Đổi trực đang chờ xác nhận",
        message: `${row.staff_name_1} (${formatDate(row.date_1)}) ↔ ${row.staff_name_2} (${formatDate(row.date_2)})`,
        createdAt: row.created_at,
        ...(isRecipient ? { swapToken: row.token } : { actionView: "schedule" as const })
      });
    }
  }

  if (user.role === "admin") {
    const { results: leaves } = await env.DB.prepare(
      `SELECT lr.id, lr.created_at, s.name AS staff_name, STRING_AGG(ld.date::text, ',') AS dates
       FROM leave_requests lr
       JOIN staff s ON s.id = lr.staff_id
       JOIN leave_days ld ON ld.request_id = lr.id
       WHERE lr.status = 'pending'
       GROUP BY lr.id, lr.created_at, s.name
       ORDER BY lr.created_at DESC
       LIMIT 20`
    ).all<{ id: number; created_at: string; staff_name: string; dates: string }>();
    for (const row of leaves) {
      const dates = row.dates.split(",").sort().map(formatDate).join(", ");
      notifications.push({
        id: `leave-pending-${row.id}`,
        type: "leave",
        title: "Nghỉ phép chờ duyệt",
        message: `${row.staff_name}: ${dates}`,
        createdAt: row.created_at,
        actionView: "leave"
      });
    }
  } else if (user.staffId) {
    const { results: leaves } = await env.DB.prepare(
      `SELECT lr.id, lr.status, lr.decision, lr.updated_at, lr.decided_at, lr.reason,
              lr.requested_dates, STRING_AGG(ld.date::text, ',') AS active_dates
       FROM leave_requests lr
       LEFT JOIN leave_days ld ON ld.request_id = lr.id
       WHERE lr.staff_id = ?
         AND (
           lr.status = 'pending'
           OR (lr.status = 'approved' AND EXISTS (
             SELECT 1 FROM leave_days upcoming
             WHERE upcoming.request_id = lr.id
               AND upcoming.date >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
           ))
           OR (lr.decision IN ('approved', 'rejected') AND lr.decided_at >= CURRENT_TIMESTAMP - INTERVAL '30 days')
         )
       GROUP BY lr.id, lr.status, lr.decision, lr.updated_at, lr.decided_at, lr.reason, lr.requested_dates
       ORDER BY lr.updated_at DESC
       LIMIT 10`
    ).bind(user.staffId).all<{
      id: number; status: string; decision: string | null; updated_at: string; decided_at: string | null;
      reason: string | null; requested_dates: string | null; active_dates: string | null;
    }>();
    for (const row of leaves) {
      const dates = (row.requested_dates || row.active_dates || "").split(",").filter(Boolean).sort();
      const range = dates.length <= 1
        ? formatDate(dates[0] || "")
        : `${formatDate(dates[0])} – ${formatDate(dates[dates.length - 1])}`;
      const state = row.status === "pending" ? "pending" : row.decision || row.status;
      const title = state === "pending"
        ? "Nghỉ phép đang chờ duyệt"
        : state === "rejected"
          ? "Nghỉ phép đã bị từ chối"
          : "Nghỉ phép đã được duyệt";
      notifications.push({
        id: `leave-${row.id}-${state}-${row.updated_at}`,
        type: "leave",
        title,
        message: row.reason ? `${range} · ${row.reason}` : range,
        createdAt: row.decided_at || row.updated_at,
        actionView: "leave"
      });
    }
  }

  const reportRole = user.role === "bs" ? "bs" : user.role === "ktv" ? "ktv" : user.role === "admin" ? "lanhdao" : null;
  if (reportRole) {
    const signatureColumn = reportRole === "bs" ? "signature_bs" : reportRole === "ktv" ? "signature_ktv" : "signature_lanhdao";
    const userIdColumn = reportRole === "bs" ? "signature_bs_user_id" : reportRole === "ktv" ? "signature_ktv_user_id" : "signature_lanhdao_user_id";
    const dutyFilter = reportRole === "lanhdao"
      ? "1 = 1"
      : `EXISTS (
          SELECT 1 FROM schedule_assignments sa
          JOIN schedule_units su ON su.id = sa.unit_id
          WHERE sa.date = dr.date AND sa.staff_id = ? AND su.type = ?
        )`;
    const reportStatement = env.DB.prepare(
      `SELECT dr.date, dr.updated_at
       FROM duty_reports dr
       WHERE dr.date <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
         AND dr.date >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 30
         AND dr.${signatureColumn} IS NULL
         AND dr.${userIdColumn} IS NULL
         AND ${dutyFilter}
       ORDER BY dr.date DESC
       LIMIT 20`
    );
    const reportResult = reportRole === "lanhdao"
      ? await reportStatement.all<{ date: string; updated_at: string }>()
      : await reportStatement.bind(user.staffId, reportRole === "bs" ? "duty_bs" : "duty_ktv").all<{ date: string; updated_at: string }>();
    for (const row of reportResult.results) {
      notifications.push({
        id: `report-${reportRole}-${row.date}`,
        type: "report",
        title: "Báo cáo trực chưa ký",
        message: `Báo cáo ngày ${formatDate(row.date)} đang chờ chữ ký ${reportRole === "lanhdao" ? "Lãnh đạo" : reportRole.toUpperCase()}.`,
        createdAt: row.updated_at,
        actionView: "report",
        actionDate: row.date
      });
    }
  }

  notifications.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return notifications.slice(0, 30);
}

async function getSchedule(env: Env, url: URL, user: User): Promise<Response> {
  const weekStart = normalizeWeekStart(url.searchParams.get("weekStart"));
  const days = getWeekDays(weekStart);
  const nextWeekDays = getWeekDays(addDays(weekStart, 7));
  const [year, month] = weekStart.split("-").map(Number);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
  const settings = await getSettings(env);
  const canViewMonthCalendar = user.role === "admin" || settings.show_leave_month_calendar;
  const [units, staff, assignments, leaveDays, nextWeekLeaveDays, monthLeaveDays, rotations, pendingLeaves] = await Promise.all([
    listUnits(env),
    listStaff(env),
    listAssignments(env, days),
    listLeaveDays(env, days),
    listLeaveDays(env, nextWeekDays),
    canViewMonthCalendar ? listLeaveDays(env, [monthStart, monthEnd], true) : Promise.resolve([]),
    listRotations(env),
    listPendingLeaves(env, user)
  ]);
  const visibleLeaveDays = (items: LeaveDay[]) => user.role === "admin"
    ? items
    : items.map((day) => ({ ...day, reason: day.staffId === user.staffId ? day.reason : null }));
  const response: ScheduleResponse = {
    weekStart,
    days,
    units,
    staff,
    assignments,
    leaveDays: visibleLeaveDays(leaveDays),
    nextWeekLeaveDays: visibleLeaveDays(nextWeekLeaveDays),
    monthLeaveDays: visibleLeaveDays(monthLeaveDays),
    rotations,
    pendingLeaves,
    approveLeaveBs: settings.approve_leave_bs,
    approveLeaveKtv: settings.approve_leave_ktv,
    approveSwap: settings.approve_swap,
    showStaffRail: settings.show_staff_rail,
    showLeaveMonthCalendar: settings.show_leave_month_calendar
  };
  return json(response);
}

async function getLeaveMonth(env: Env, url: URL, user: User): Promise<Response> {
  const value = url.searchParams.get("month") || "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new HttpError(400, "Tháng không hợp lệ.");
  }
  const settings = await getSettings(env);
  if (user.role !== "admin" && !settings.show_leave_month_calendar) {
    throw new HttpError(403, "Lịch phép tháng chưa được bật.");
  }
  const [year, month] = value.split("-").map(Number);
  const monthStart = `${value}-01`;
  const monthEnd = `${value}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
  const leaveDays = await listLeaveDays(env, [monthStart, monthEnd], true);
  return json({
    month: value,
    leaveDays: user.role === "admin"
      ? leaveDays
      : leaveDays.map((day) => ({ ...day, reason: day.staffId === user.staffId ? day.reason : null }))
  });
}

async function putAssignment(request: Request, env: Env, user: User): Promise<Response> {
  requireAdmin(user);
  const body = await readJson<{ unitId?: number; date?: string; staffId?: number; slot?: number }>(request);
  if (!body.unitId || !body.date || !body.staffId) throw new HttpError(400, "Thiếu hàng lịch, ngày hoặc nhân sự.");
  const unit = await getUnitById(env, body.unitId);
  const staff = await getStaffById(env, body.staffId);
  const dayWindow = [body.date];
  const assignments = await listAssignments(env, dayWindow);
  const leaveDays = await listLeaveDays(env, dayWindow);
  const message = validateAssignmentInput({ unit, staff, date: body.date, assignments, leaveDays });
  if (message) throw new HttpError(400, message);
  const slot = body.slot ?? nextSlot(assignments, unit.id, body.date);
  await env.DB.prepare(
    `INSERT INTO schedule_assignments (unit_id, date, staff_id, slot, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(unit_id, date, slot) DO UPDATE SET
       staff_id = excluded.staff_id,
       updated_by = excluded.updated_by,
       updated_at = CURRENT_TIMESTAMP,
       confirmed = 0`
  ).bind(unit.id, body.date, staff.id, slot, user.id, user.id).run();
  await audit(env, user.id, "upsert", "assignment", unit.id, `${unit.label} ${body.date}: ${staff.name}`);
  return json({ ok: true });
}

async function moveAssignment(request: Request, env: Env, user: User, id: number): Promise<Response> {
  const body = await readJson<{ unitId?: number; date?: string; slot?: number }>(request);
  if (!body.unitId || !body.date) throw new HttpError(400, "Thiếu hàng lịch hoặc ngày đích.");
  const current = await env.DB.prepare(
    `SELECT a.id, a.staff_id, a.unit_id, a.date, a.slot, s.name AS staff_name
     FROM schedule_assignments a JOIN staff s ON s.id = a.staff_id
     WHERE a.id = ?`
  ).bind(id).first<{ id: number; staff_id: number; unit_id: number; date: string; slot: number; staff_name: string }>();
  if (!current) throw new HttpError(404, "Không tìm thấy phân công.");
  const unit = await getUnitById(env, body.unitId);
  const staff = await getStaffById(env, current.staff_id);
  const assignments = await listAssignments(env, [body.date]);
  const leaveDays = await listLeaveDays(env, [body.date]);
  const targetAssignments = assignments
    .filter((assignment) => assignment.unitId === unit.id && assignment.date === body.date && assignment.id !== id)
    .sort((a, b) => a.slot - b.slot);
  const fullTarget = unit.maxPerDay !== null && targetAssignments.length >= unit.maxPerDay;
  const targetSlot = body.slot ?? (fullTarget ? targetAssignments[0]?.slot ?? 0 : nextSlot(assignments, unit.id, body.date));
  const swapAssignmentId = fullTarget ? targetAssignments.find((assignment) => assignment.slot === targetSlot)?.id ?? targetAssignments[0]?.id : null;
  const message = validateAssignmentInput({
    unit,
    staff,
    date: body.date,
    assignments: swapAssignmentId ? assignments.filter((assignment) => assignment.id !== swapAssignmentId) : assignments,
    leaveDays,
    replacingAssignmentId: id
  });
  if (message) throw new HttpError(400, message);
  const occupant = await env.DB.prepare(
    "SELECT id, staff_id, unit_id, date, slot FROM schedule_assignments WHERE unit_id = ? AND date = ? AND slot = ? AND id <> ?"
  ).bind(unit.id, body.date, targetSlot, id).first<{ id: number; staff_id: number; unit_id: number; date: string; slot: number }>();
  if (occupant) {
    const sourceUnit = await getUnitById(env, current.unit_id);
    const occupantStaff = await getStaffById(env, occupant.staff_id);
    const sourceAssignments = await listAssignments(env, [current.date]);
    const sourceLeaveDays = await listLeaveDays(env, [current.date]);
    const occupantMessage = validateAssignmentInput({
      unit: sourceUnit,
      staff: occupantStaff,
      date: current.date,
      assignments: sourceAssignments.filter((assignment) => assignment.id !== id),
      leaveDays: sourceLeaveDays,
      replacingAssignmentId: occupant.id
    });
    if (occupantMessage) throw new HttpError(400, occupantMessage);
  }
  if (user.role !== "admin") {
    if (!user.staffId) throw new HttpError(403, "Tài khoản chưa liên kết nhân sự.");
    if (!occupant) throw new HttpError(403, "Tài khoản BS/KTV chỉ được đổi lịch với người khác, không được chuyển vào ô trống.");
    const involvesSelf = current.staff_id === user.staffId || occupant.staff_id === user.staffId;
    if (!involvesSelf) throw new HttpError(403, "Bạn chỉ được đổi lịch có đúng tên mình, không được đổi giữa hai người khác.");
  }

  // Swap approval check
  const settings = await getSettings(env);
  const isSwap = occupant && occupant.staff_id !== current.staff_id;
  const needApproval = settings.approve_swap && user.role !== "admin" && isSwap;

  if (needApproval && occupant) {
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    await env.DB.prepare(
      `INSERT INTO swap_requests (
        token, status, created_by, expires_at,
        assignment_id_1, staff_id_1, unit_id_1, date_1, slot_1,
        assignment_id_2, staff_id_2, unit_id_2, date_2, slot_2
      ) VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      token,
      user.id,
      expiresAt,
      current.id,
      current.staff_id,
      current.unit_id,
      current.date,
      current.slot,
      occupant.id,
      occupant.staff_id,
      occupant.unit_id,
      occupant.date,
      occupant.slot
    ).run();

    return json({
      pending: true,
      token,
      message: "Yêu cầu đổi trực đã được tạo. Vui lòng gửi link sau cho đối phương đồng ý."
    });
  }

  const moveStatements: PostgresPreparedStatement[] = [];
  if (occupant) {
    moveStatements.push(env.DB.prepare(
      "UPDATE schedule_assignments SET slot = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP, confirmed = 0 WHERE id = ?"
    ).bind(-100000 - occupant.id, user.id, occupant.id));
  }
  moveStatements.push(env.DB.prepare(
    "UPDATE schedule_assignments SET unit_id = ?, date = ?, slot = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP, confirmed = 0 WHERE id = ?"
  ).bind(unit.id, body.date, targetSlot, user.id, id));
  if (occupant) {
    moveStatements.push(env.DB.prepare(
      "UPDATE schedule_assignments SET unit_id = ?, date = ?, slot = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP, confirmed = 0 WHERE id = ?"
    ).bind(current.unit_id, current.date, current.slot, user.id, occupant.id));
  }
  await env.DB.batch(moveStatements);
  if (occupant) {
    await syncWorkScheduleAfterDutySwap(env, {
      staffId1: current.staff_id,
      dutyDate1: current.date,
      staffId2: occupant.staff_id,
      dutyDate2: occupant.date,
      updatedBy: user.id
    });
  }
  const dowCurrent = getDayOfWeekLabel(current.date);
  const formattedDateCurrent = formatDate(current.date);
  const dowTarget = getDayOfWeekLabel(body.date);
  const formattedDateTarget = formatDate(body.date);
  const staffTypeStr = staff.type ? `${staff.type}. ` : "";

  await audit(
    env,
    user.id,
    "move",
    "assignment",
    id,
    `Đổi lịch ${staffTypeStr}${current.staff_name} trực ${dowCurrent} ngày ${formattedDateCurrent} sang ${unit.label} ${dowTarget} ngày ${formattedDateTarget}`
  );
  return json({ ok: true });
}

async function deleteAssignment(env: Env, user: User, id: number): Promise<Response> {
  requireAdmin(user);
  const assignment = await env.DB.prepare(
    `SELECT a.id, a.date, u.label, s.name
     FROM schedule_assignments a
     JOIN schedule_units u ON u.id = a.unit_id
     JOIN staff s ON s.id = a.staff_id
     WHERE a.id = ?`
  ).bind(id).first<{ id: number; date: string; label: string; name: string }>();
  if (!assignment) throw new HttpError(404, "Không tìm thấy phân công.");
  await env.DB.prepare("DELETE FROM schedule_assignments WHERE id = ?").bind(id).run();
  await audit(env, user.id, "delete", "assignment", id, `Xóa ${assignment.label} ${assignment.date}: ${assignment.name}`);
  return json({ ok: true });
}

async function confirmSchedule(request: Request, env: Env, user: User): Promise<Response> {
  requireAdmin(user);
  const body = await readJson<{ weekStart?: string }>(request);
  const weekStart = normalizeWeekStart(body.weekStart);
  const days = getWeekDays(weekStart);
  await env.DB.prepare(
    `UPDATE schedule_assignments SET confirmed = 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP
     WHERE date BETWEEN ? AND ?`
  ).bind(user.id, days[0], days[6]).run();
  await audit(env, user.id, "confirm", "schedule", null, `Duyệt lịch tuần ${weekStart}`);
  return json({ ok: true });
}

async function clearSchedule(request: Request, env: Env, user: User): Promise<Response> {
  requireAdmin(user);
  const body = await readJson<{ weekStart?: string; scope?: string }>(request);
  const weekStart = normalizeWeekStart(body.weekStart);
  const days = getWeekDays(weekStart);
  const scopes: Record<string, { types: ScheduleUnit["type"][]; label: string; range: "week" | "month" }> = {
    duty_bs: { types: ["duty_bs"], label: "lịch trực BS", range: "week" },
    duty_ktv: { types: ["duty_ktv"], label: "lịch trực KTV", range: "week" },
    duty: { types: ["duty_bs", "duty_ktv"], label: "lịch trực", range: "week" },
    work_bs: { types: ["work_bs"], label: "lịch làm việc BS", range: "week" },
    work_ktv: { types: ["work_ktv"], label: "lịch làm việc KTV", range: "week" },
    all: { types: ["duty_bs", "duty_ktv", "work_bs", "work_ktv"], label: "toàn bộ lịch", range: "week" },
    month_all: { types: ["duty_bs", "duty_ktv", "work_bs", "work_ktv"], label: "toàn bộ lịch tháng", range: "month" }
  };
  const selected = body.scope ? scopes[body.scope] : null;
  if (!selected) throw new HttpError(400, "Chế độ xóa không hợp lệ.");
  const [year, month] = weekStart.split("-").map(Number);
  const rangeStart = selected.range === "month" ? `${year}-${String(month).padStart(2, "0")}-01` : days[0];
  const rangeEnd = selected.range === "month"
    ? `${year}-${String(month).padStart(2, "0")}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`
    : days[6];
  const placeholders = selected.types.map(() => "?").join(", ");
  const result = await env.DB.prepare(
    `DELETE FROM schedule_assignments
     WHERE date BETWEEN ? AND ?
     AND unit_id IN (SELECT id FROM schedule_units WHERE computed = 0 AND type IN (${placeholders}))`
  ).bind(rangeStart, rangeEnd, ...selected.types).run();
  const deleted = result.meta.changes || 0;
  const rangeLabel = selected.range === "month" ? `${String(month).padStart(2, "0")}/${year}` : `tuần ${weekStart}`;
  await audit(env, user.id, "delete", "schedule", null, `Xóa ${selected.label} ${rangeLabel}: ${deleted} phân công`);
  return json({ ok: true });
}

async function recalculateWorkSchedule(request: Request, env: Env, user: User): Promise<Response> {
  requireAdmin(user);
  const body = await readJson<{ weekStart?: string }>(request);
  const weekStart = normalizeWeekStart(body.weekStart);
  const days = getWeekDays(weekStart);
  const [units, rotations, leaveDays, bsOffDays, ktvOffDays] = await Promise.all([
    listUnits(env),
    listRotations(env),
    listLeaveDays(env, days),
    listPostDutyOffDays(env, { type: "work_bs" } as ScheduleUnit, days),
    listPostDutyOffDays(env, { type: "work_ktv" } as ScheduleUnit, days)
  ]);
  const unavailableStaffDays = new Set([
    ...bsOffDays,
    ...ktvOffDays,
    ...leaveDays.map((day) => `${day.staffId}:${day.date}`)
  ]);
  const statements: PostgresPreparedStatement[] = [];
  for (const key of bsOffDays) {
    const [staffId, date] = key.split(":");
    statements.push(
      env.DB.prepare(
        "DELETE FROM schedule_assignments WHERE staff_id = ? AND date = ? AND unit_id IN (SELECT id FROM schedule_units WHERE type = 'work_bs')"
      ).bind(Number(staffId), date)
    );
  }
  for (const key of ktvOffDays) {
    const [staffId, date] = key.split(":");
    statements.push(
      env.DB.prepare(
        "DELETE FROM schedule_assignments WHERE staff_id = ? AND date = ? AND unit_id IN (SELECT id FROM schedule_units WHERE type = 'work_ktv')"
      ).bind(Number(staffId), date)
    );
  }
  const deleteStatementCount = statements.length;
  const plannedAssignments = workRotationAssignmentsForDates(units, rotations, days, unavailableStaffDays);
  for (const assignment of plannedAssignments) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO schedule_assignments
         (unit_id, date, staff_id, slot, confirmed, created_by, updated_by)
         VALUES (?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT DO NOTHING`
      ).bind(assignment.unitId, assignment.date, assignment.staffId, assignment.slot, user.id, user.id)
    );
  }
  let deleted = 0;
  let restored = 0;
  if (statements.length) {
    const results = await env.DB.batch(statements);
    deleted = results.slice(0, deleteStatementCount).reduce((sum, result) => sum + (result.meta.changes || 0), 0);
    restored = results.slice(deleteStatementCount).reduce((sum, result) => sum + (result.meta.changes || 0), 0);
  }
  const repairedSwaps = await reconcileApprovedSwapWorkSchedules(env, days, user.id);
  await audit(
    env,
    user.id,
    "recalculate",
    "schedule",
    null,
    `Cập nhật lại lịch làm việc tuần ${weekStart}: bỏ ${deleted + repairedSwaps.removed} phân công sai/ngày ra trực, khôi phục ${restored + repairedSwaps.restored} phân công theo tua`
  );
  return json({ ok: true, deleted: deleted + repairedSwaps.removed, restored: restored + repairedSwaps.restored });
}

async function reconcileApprovedSwapWorkSchedules(
  env: Env,
  days: string[],
  updatedBy: number | null
): Promise<{ removed: number; restored: number }> {
  const rangeStart = addDays(days[0], -1);
  const rangeEnd = addDays(days[days.length - 1], 1);
  const swaps = await env.DB.prepare(
    `SELECT staff_id_1, date_1, staff_id_2, date_2
     FROM swap_requests
     WHERE status = 'approved'
       AND (date_1 BETWEEN ? AND ? OR date_2 BETWEEN ? AND ?)
     ORDER BY updated_at, id`
  ).bind(rangeStart, rangeEnd, rangeStart, rangeEnd)
    .all<{ staff_id_1: number; date_1: string; staff_id_2: number; date_2: string }>();

  const daySet = new Set(days);
  const affected = new Map<string, Set<number>>();
  for (const swap of swaps.results || []) {
    for (const date of [postDutyOffDate(swap.date_1), postDutyOffDate(swap.date_2)]) {
      if (!daySet.has(date)) continue;
      const staffIds = affected.get(date) || new Set<number>();
      staffIds.add(swap.staff_id_1);
      staffIds.add(swap.staff_id_2);
      affected.set(date, staffIds);
    }
  }
  if (affected.size === 0) return { removed: 0, restored: 0 };

  const [units, rotations, leaveDays, bsOffDays, ktvOffDays] = await Promise.all([
    listUnits(env),
    listRotations(env),
    listLeaveDays(env, days),
    listPostDutyOffDays(env, { type: "work_bs" } as ScheduleUnit, days),
    listPostDutyOffDays(env, { type: "work_ktv" } as ScheduleUnit, days)
  ]);
  const leaveSet = new Set(leaveDays.map((day) => `${day.staffId}:${day.date}`));
  const offDays = new Set([...bsOffDays, ...ktvOffDays]);
  const operations: Array<{ kind: "delete" | "insert"; statement: PostgresPreparedStatement }> = [];

  for (const [date, staffIds] of affected) {
    for (const staffId of staffIds) {
      operations.push({
        kind: "delete",
        statement: env.DB.prepare(
          `DELETE FROM schedule_assignments
           WHERE staff_id = ? AND date = ?
             AND unit_id IN (SELECT id FROM schedule_units WHERE type IN ('work_bs', 'work_ktv'))`
        ).bind(staffId, date)
      });
      if (offDays.has(`${staffId}:${date}`) || leaveSet.has(`${staffId}:${date}`)) continue;
      for (const assignment of workRotationAssignmentsForStaff(units, rotations, staffId, date)) {
        operations.push({
          kind: "insert",
          statement: env.DB.prepare(
            `INSERT INTO schedule_assignments
             (unit_id, date, staff_id, slot, confirmed, created_by, updated_by)
             VALUES (?, ?, ?, ?, 0, ?, ?)
             ON CONFLICT (unit_id, date, slot) DO NOTHING`
          ).bind(assignment.unitId, date, staffId, assignment.slot, updatedBy, updatedBy)
        });
      }
    }
  }

  const results = await env.DB.batch(operations.map((operation) => operation.statement));
  return operations.reduce(
    (totals, operation, index) => {
      const changes = results[index]?.meta.changes || 0;
      if (operation.kind === "delete") totals.removed += changes;
      else totals.restored += changes;
      return totals;
    },
    { removed: 0, restored: 0 }
  );
}

async function saveRotation(request: Request, env: Env, user: User, unitId: number): Promise<Response> {
  requireAdmin(user);
  const unit = await getUnitById(env, unitId);
  if (unit.computed) throw new HttpError(400, "Hàng tự động không thể tạo tua.");
  const body = await readJson<{ startDate?: string; mode?: "daily" | "weekly"; turns?: number[][] }>(request);
  const startDate = String(body.startDate || "").slice(0, 10);
  const mode = body.mode === "weekly" ? "weekly" : "daily";
  const turns = body.turns || [];
  if (!isIsoDate(startDate) || !Array.isArray(turns) || turns.length === 0 || turns.some((turn) => !Array.isArray(turn) || turn.length === 0)) {
    throw new HttpError(400, "Cần ngày bắt đầu và ít nhất một tua.");
  }
  if (turns.some((turn) => turn.some((staffId) => !Number.isInteger(staffId) || staffId <= 0))) {
    throw new HttpError(400, "Nhân sự trong tua không hợp lệ.");
  }
  const staffIds = [...new Set(turns.flat())];
  const staffLookup = rotationStaffLookup(staffIds);
  const { results: staffRows } = await env.DB.prepare(staffLookup.sql).bind(...staffLookup.bindings).all<StaffRow>();
  const staffById = new Map(staffRows.map((row) => [row.id, mapStaffRow(row)]));
  const missingStaffId = staffIds.find((staffId) => !staffById.has(staffId));
  if (missingStaffId !== undefined) throw new HttpError(404, "Không tìm thấy nhân sự.");
  for (const turn of turns) {
    if (new Set(turn).size !== turn.length) throw new HttpError(400, "Một nhân sự không thể xuất hiện hai lần trong cùng một tua.");
    for (const staffId of turn) {
      const staff = staffById.get(staffId)!;
      if (!acceptsStaffTypeForUnit(unit.type, staff.type)) throw new HttpError(400, `${staff.name} không đúng loại nhân sự cho ${unit.label}.`);
    }
    if (unit.maxPerDay !== null && turn.length > unit.maxPerDay) {
      throw new HttpError(400, `${unit.label} tối đa ${unit.maxPerDay} người/tua.`);
    }
  }
  const rotationStatement = env.DB.prepare(
    `INSERT INTO unit_rotations (unit_id, start_date, mode, enabled, updated_by)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(unit_id) DO UPDATE SET start_date = excluded.start_date, mode = excluded.mode, enabled = 1, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`
  ).bind(unitId, startDate, mode, user.id);
  const deleteMembersStatement = env.DB.prepare("DELETE FROM unit_rotation_members WHERE unit_id = ?").bind(unitId);
  const membersInsert = rotationMembersInsert(unitId, turns);
  const membersStatement = env.DB.prepare(membersInsert.sql).bind(...membersInsert.bindings);
  await env.DB.batch([rotationStatement, deleteMembersStatement, membersStatement]);
  await audit(env, user.id, "save", "rotation", unitId, `Lưu tua trực: ${unit.label}`);
  return json({ ok: true });
}

async function applyRotation(request: Request, env: Env, user: User, unitId: number): Promise<Response> {
  requireAdmin(user);
  const unit = await getUnitById(env, unitId);
  const body = await readJson<{ weekStart?: string; weeks?: number }>(request);
  const weekStart = normalizeWeekStart(body.weekStart);
  const weekCount = Math.max(1, Math.min(12, Number(body.weeks) || 1));
  const rotation = (await listRotations(env)).find((item) => item.unitId === unitId);
  const turns = (rotation?.turns || []).filter((turn) => Array.isArray(turn) && turn.length > 0);
  if (!rotation || turns.length === 0) throw new HttpError(400, "Chưa có tua để áp dụng.");
  const days = Array.from({ length: weekCount * 7 }, (_, index) => addDays(weekStart, index));
  const statements: PostgresPreparedStatement[] = [];
  const allAssignments = await listAssignments(env, days);
  const requestedLeaveDays = await listRequestedLeaveStaffDays(env, days);
  const postDutyOffDays = await listPostDutyOffDays(env, unit, days);
  const skipped: string[] = [];
  let skippedLeaveDays = 0;
  for (const date of days) {
    const idx = rotationTurnIndex(rotation.startDate, date, rotation.mode, turns.length);
    const staffIds = turns[idx].map((member) => member.staffId);
    for (const [slot, staffId] of staffIds.entries()) {
      if (postDutyOffDays.has(`${staffId}:${date}`)) continue;
      if (requestedLeaveDays.has(`${staffId}:${date}`)) {
        skippedLeaveDays += 1;
        continue;
      }
      const staff = await getStaffById(env, staffId);
      // Leave is already owned by requestedLeaveDays above, so only the structural checks are left
      // here. A single unusable cell (inactive staff, wrong staff type, ...) must not abort the
      // whole rotation either: skip that day and report it, like leave and post-duty days.
      const msg = validateAssignmentInput({
        unit,
        staff,
        date,
        assignments: allAssignments.filter((a) => !(a.unitId === unitId && a.date === date)),
        leaveDays: []
      });
      if (msg) {
        skipped.push(`${formatDate(date)} ${staff.name}: ${msg}`);
        continue;
      }
      statements.push(
        env.DB.prepare(
          "INSERT INTO schedule_assignments (unit_id, date, staff_id, slot, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(unitId, date, staffId, slot, user.id, user.id)
      );
    }
  }
  const deleteStatement = env.DB.prepare("DELETE FROM schedule_assignments WHERE unit_id = ? AND date BETWEEN ? AND ?")
    .bind(unitId, days[0], days[days.length - 1]);
  await env.DB.batch([deleteStatement, ...statements]);
  const skipNote = [
    skippedLeaveDays ? `bỏ qua ${skippedLeaveDays} ngày nghỉ phép` : "",
    skipped.length ? `bỏ qua ${skipped.length} ngày không hợp lệ` : ""
  ].filter(Boolean).join(", ");
  await audit(
    env,
    user.id,
    "apply",
    "rotation",
    unitId,
    `Áp dụng tua ${unit.label} tuần ${weekStart}${skipNote ? ` (${skipNote})` : ""}`
  );
  return json({ ok: true, skippedLeaveDays, skipped });
}

async function listPostDutyOffDays(env: Env, unit: ScheduleUnit, days: string[]): Promise<Set<string>> {
  if (unit.type !== "work_bs" && unit.type !== "work_ktv") return new Set();
  const dutyCode = unit.type === "work_bs" ? "duty_bs" : "duty_ktv";
  const firstDutyDate = addDays(days[0], -1);
  const lastDutyDate = addDays(days[days.length - 1], 1);
  const rows = await env.DB.prepare(
    `SELECT a.date, a.staff_id
     FROM schedule_assignments a
     JOIN schedule_units u ON u.id = a.unit_id
     WHERE u.code = ? AND a.date BETWEEN ? AND ?`
  ).bind(dutyCode, firstDutyDate, lastDutyDate).all<{ date: string; staff_id: number }>();
  const daySet = new Set(days);
  const offDays = new Set<string>();
  for (const row of rows.results || []) {
    const offDate = postDutyOffDate(row.date);
    if (daySet.has(offDate)) offDays.add(`${row.staff_id}:${offDate}`);
  }
  return offDays;
}

interface DutySwapWorkSyncInput {
  staffId1: number;
  dutyDate1: string;
  staffId2: number;
  dutyDate2: string;
  updatedBy: number | null;
}

async function syncWorkScheduleAfterDutySwap(env: Env, input: DutySwapWorkSyncInput): Promise<void> {
  const oldOffDate1 = postDutyOffDate(input.dutyDate1);
  const oldOffDate2 = postDutyOffDate(input.dutyDate2);
  if (oldOffDate1 === oldOffDate2) return;

  const today = todayInVietnam();
  const changes = [
    {
      date: oldOffDate2,
      newOffStaffId: input.staffId1,
      returningStaffId: input.staffId2,
      shouldSync: shouldSyncPostDutyOffDate(input.dutyDate2, today)
    },
    {
      date: oldOffDate1,
      newOffStaffId: input.staffId2,
      returningStaffId: input.staffId1,
      shouldSync: shouldSyncPostDutyOffDate(input.dutyDate1, today)
    }
  ];

  for (const change of changes) {
    if (!change.shouldSync) continue;
    const [units, rotations, returningLeave] = await Promise.all([
      listUnits(env),
      listRotations(env),
      env.DB.prepare(
        `SELECT 1
         FROM leave_days ld
         JOIN leave_requests lr ON lr.id = ld.request_id
         WHERE ld.staff_id = ? AND ld.date = ? AND lr.status = 'approved'`
      ).bind(change.returningStaffId, change.date).first<{ exists: number }>()
    ]);
    const expectedAssignments = returningLeave
      ? []
      : workRotationAssignmentsForStaff(units, rotations, change.returningStaffId, change.date);

    const statements: PostgresPreparedStatement[] = [
      env.DB.prepare(
        `DELETE FROM schedule_assignments
         WHERE date = ? AND staff_id IN (?, ?)
         AND unit_id IN (SELECT id FROM schedule_units WHERE type IN ('work_bs', 'work_ktv'))`
      ).bind(change.date, change.newOffStaffId, change.returningStaffId)
    ];
    for (const assignment of expectedAssignments) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO schedule_assignments
           (unit_id, date, staff_id, slot, confirmed, created_by, updated_by)
           VALUES (?, ?, ?, ?, 0, ?, ?)
           ON CONFLICT (unit_id, date, slot) DO NOTHING`
        ).bind(assignment.unitId, change.date, change.returningStaffId, assignment.slot, input.updatedBy, input.updatedBy)
      );
    }
    await env.DB.batch(statements);
  }
}

async function reorderUnits(request: Request, env: Env, user: User): Promise<Response> {
  requireAdmin(user);
  const body = await readJson<{ unitIds?: number[] }>(request);
  const unitIds = body.unitIds || [];
  if (!unitIds.length) throw new HttpError(400, "Thiếu danh sách row.");
  const units = await listUnits(env);
  const allowed = new Set(units.filter((u) => u.section === "II" || u.section === "III").map((u) => u.id));
  if (unitIds.some((id) => !allowed.has(id))) throw new HttpError(400, "Chỉ được đổi vị trí row ở Phần II và III.");
  const first = units.find((u) => u.id === unitIds[0]);
  if (!first || unitIds.some((id) => units.find((u) => u.id === id)?.section !== first.section)) {
    throw new HttpError(400, "Chỉ đổi vị trí trong cùng một phần.");
  }
  const base = first.section === "II" ? 110 : 210;
  const statements = unitIds.map((id, index) => env.DB.prepare("UPDATE schedule_units SET sort_order = ? WHERE id = ?").bind(base + index * 10, id));
  await env.DB.batch(statements);
  await audit(env, user.id, "reorder", "schedule_unit", null, "Đổi vị trí row Phần II/III");
  return json({ ok: true });
}

async function createUnit(request: Request, env: Env, user: User): Promise<Response> {
  requireAdmin(user);
  const body = await readJson<{ label?: string; type?: string }>(request);
  const label = String(body.label || "").trim();
  const type = body.type;

  if (!label) throw new HttpError(400, "Thiếu tên phòng/việc.");
  if (type !== "work_bs" && type !== "work_ktv") {
    throw new HttpError(400, "Loại phòng/việc không hợp lệ.");
  }

  const section = type === "work_bs" ? "II" : "III";
  const code = `${type}_${Date.now()}`;

  // Find max sort_order for the section
  const row = await env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), ?) AS max_sort FROM schedule_units WHERE section = ?"
  ).bind(type === "work_bs" ? 100 : 200, section).first<{ max_sort: number }>();
  const sortOrder = (row?.max_sort ?? (type === "work_bs" ? 100 : 200)) + 10;

  const result = await env.DB.prepare(
    "INSERT INTO schedule_units (code, section, label, type, sort_order, computed) VALUES (?, ?, ?, ?, ?, 0)"
  ).bind(code, section, label, type, sortOrder).run();

  const newId = result.meta.last_row_id;
  await audit(env, user.id, "create", "schedule_unit", Number(newId), `Thêm phòng/việc ${type === "work_bs" ? "BS" : "KTV"}: ${label}`);

  return json({ ok: true, unit: { id: Number(newId), code, section, label, type, sortOrder, computed: 0 } });
}

async function updateUnit(request: Request, env: Env, user: User, id: number): Promise<Response> {
  requireAdmin(user);
  const body = await readJson<{ label?: string }>(request);
  const label = String(body.label || "").trim();
  if (!label) throw new HttpError(400, "Tên phòng/việc không được để trống.");

  const current = await env.DB.prepare(
    "SELECT id, label, type FROM schedule_units WHERE id = ?"
  ).bind(id).first<{ id: number; label: string; type: string }>();

  if (!current) throw new HttpError(404, "Không tìm thấy phòng/việc.");
  if (current.type !== "work_bs" && current.type !== "work_ktv") {
    throw new HttpError(403, "Không được sửa phòng/việc trực cố định.");
  }

  await env.DB.prepare(
    "UPDATE schedule_units SET label = ? WHERE id = ?"
  ).bind(label, id).run();

  await audit(env, user.id, "update", "schedule_unit", id, `Sửa phòng/việc ${current.type === "work_bs" ? "BS" : "KTV"}: ${current.label} thành ${label}`);

  return json({ ok: true });
}

async function deleteUnit(env: Env, user: User, id: number): Promise<Response> {
  requireAdmin(user);
  const current = await env.DB.prepare(
    "SELECT id, label, type FROM schedule_units WHERE id = ?"
  ).bind(id).first<{ id: number; label: string; type: string }>();

  if (!current) throw new HttpError(404, "Không tìm thấy phòng/việc.");
  if (current.type !== "work_bs" && current.type !== "work_ktv") {
    throw new HttpError(403, "Không được xóa phòng/việc trực cố định.");
  }

  await env.DB.prepare(
    "DELETE FROM schedule_units WHERE id = ?"
  ).bind(id).run();

  await audit(env, user.id, "delete", "schedule_unit", id, `Xóa phòng/việc ${current.type === "work_bs" ? "BS" : "KTV"}: ${current.label}`);

  return json({ ok: true });
}

async function getLeave(env: Env, url: URL): Promise<Response> {
  const weekStart = normalizeWeekStart(url.searchParams.get("weekStart"));
  return json({ leaveDays: await listLeaveDays(env, getWeekDays(weekStart)) });
}

async function createLeave(request: Request, env: Env, user: User): Promise<Response> {
  const body = await readJson<{ staffId?: number; dates?: string[]; reason?: string }>(request);
  const requestedStaffId = body.staffId ?? user.staffId;
  if (!requestedStaffId) throw new HttpError(400, "Tài khoản chưa liên kết nhân sự.");
  if (user.role !== "admin" && user.staffId !== requestedStaffId) {
    throw new HttpError(403, "Chỉ được xin nghỉ cho chính mình.");
  }
  const staff = await getStaffById(env, requestedStaffId);
  const dates = [...new Set((body.dates || []).map((date) => String(date).slice(0, 10)))].sort();
  if (dates.length === 0) throw new HttpError(400, "Chưa chọn ngày nghỉ phép.");

  // Prevent regular users from registering leave in the past
  if (user.role !== "admin") {
    const today = todayInVietnam();
    const pastDates = dates.filter((d) => d < today);
    if (pastDates.length > 0) {
      throw new HttpError(400, `Không thể xin nghỉ phép cho các ngày trong quá khứ: ${pastDates.join(", ")}`);
    }
  }

  // Check blocked leave dates (only for non-admin)
  if (user.role !== "admin") {
    const placeholders = dates.map(() => "?").join(",");
    const { results } = await env.DB.prepare(
      `SELECT date FROM blocked_leave_days WHERE date IN (${placeholders})`
    ).bind(...dates).all<{ date: string }>();

    if (results && results.length > 0) {
      const blockedList = results.map((r) => r.date).join(", ");
      throw new HttpError(400, `Không thể xin nghỉ phép vào ngày bị khóa: ${blockedList}`);
    }
  }

  const leaveDays = dates.length ? await listLeaveDays(env, [dates[0], dates[dates.length - 1]], true) : [];
  const message = validateLeaveInput({ staff, dates, leaveDays, limitPerType: 2 });
  if (message) throw new HttpError(400, message);
  await assertNoDutyLeaveConflicts(env, staff.id, dates);

  // Determine status based on settings
  const settings = await getSettings(env);
  const requireApproval = staff.type === "BS" ? settings.approve_leave_bs : (staff.type === "KTV" ? settings.approve_leave_ktv : false);
  const status = (user.role === "admin" || !requireApproval) ? "approved" : "pending";

  const result = await env.DB.prepare(
    `INSERT INTO leave_requests
     (staff_id, reason, status, created_by, requested_dates, decision, decided_at, decided_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    staff.id,
    body.reason || null,
    status,
    user.id,
    dates.join(","),
    status === "approved" ? "approved" : null,
    status === "approved" ? new Date().toISOString() : null,
    status === "approved" ? user.id : null
  ).run();
  const requestId = result.meta.last_row_id;

  const statements = dates.map((date) =>
    env.DB.prepare("INSERT INTO leave_days (request_id, staff_id, date, staff_type) VALUES (?, ?, ?, ?)")
      .bind(requestId, staff.id, date, staff.type)
  );

  if (status === "approved") {
    const placeholders = dates.map(() => "?").join(",");
    statements.push(
      env.DB.prepare(`
        DELETE FROM schedule_assignments
        WHERE staff_id = ?
          AND date IN (${placeholders})
          AND unit_id IN (SELECT id FROM schedule_units WHERE type IN ('work_bs', 'work_ktv'))
      `).bind(staff.id, ...dates)
    );
  }

  await env.DB.batch(statements);

  const summaryText = status === "pending" ? `Đăng ký nghỉ phép (chờ duyệt) ${staff.name}: ${dates.join(", ")}` : `Nghỉ phép ${staff.name}: ${dates.join(", ")}`;
  await audit(env, user.id, "create", "leave", requestId, summaryText);
  return json({ ok: true, pending: status === "pending" }, 201);
}

async function assertNoDutyLeaveConflicts(env: Env, staffId: number, dates: string[]): Promise<void> {
  if (dates.length === 0) return;
  const requestedDates = new Set(dates);
  const dutyAssignments = await env.DB.prepare(
    `SELECT sa.date, su.label
     FROM schedule_assignments sa
     JOIN schedule_units su ON su.id = sa.unit_id
     WHERE sa.staff_id = ?
       AND su.type IN ('duty_common', 'duty_bs', 'duty_ktv')
       AND sa.date BETWEEN ? AND ?`
  ).bind(staffId, addDays(dates[0], -1), addDays(dates[dates.length - 1], 1))
    .all<{ date: string; label: string }>();

  const onDuty = (dutyAssignments.results || []).filter((row) => requestedDates.has(row.date));
  if (onDuty.length > 0) {
    const details = onDuty.map((row) => `${formatDate(row.date)} (${row.label})`).join(", ");
    throw new HttpError(400, `Không thể xin nghỉ phép vì nhân sự có lịch trực vào ngày nghỉ đã chọn: ${details}`);
  }

  const postDuty = (dutyAssignments.results || []).filter((row) =>
    [...requestedDates].some((leaveDate) => row.date !== leaveDate && conflictsWithDutyLeave(row.date, leaveDate))
  );
  if (postDuty.length > 0) {
    const details = postDuty
      .map((row) => `${formatDate(postDutyOffDate(row.date))} (ra trực ca ngày ${formatDate(row.date)})`)
      .join(", ");
    throw new HttpError(400, `Không thể xin nghỉ phép vì nhân sự có lịch ra trực: ${details}`);
  }
}

async function cancelLeave(env: Env, user: User, id: number): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT lr.id, lr.staff_id, s.name
     FROM leave_requests lr JOIN staff s ON s.id = lr.staff_id
     WHERE lr.id = ? AND lr.status IN ('approved', 'pending')`
  ).bind(id).first<{ id: number; staff_id: number; name: string }>();
  if (!row) throw new HttpError(404, "Không tìm thấy đơn nghỉ phép.");
  if (user.role !== "admin" && user.staffId !== row.staff_id) {
    throw new HttpError(403, "Chỉ được hủy nghỉ phép của chính mình.");
  }
  await env.DB.prepare(
    `UPDATE leave_requests SET status = 'cancelled', decision = 'cancelled',
       decided_at = CURRENT_TIMESTAMP, decided_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  )
    .bind(user.id, id)
    .run();
  await env.DB.prepare("DELETE FROM leave_days WHERE request_id = ?").bind(id).run();
  await audit(env, user.id, "cancel", "leave", id, `Hủy nghỉ phép: ${row.name}`);
  return json({ ok: true });
}

async function cancelLeaveDay(env: Env, user: User, id: number): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT ld.id, ld.request_id, ld.staff_id, ld.date, s.name
     FROM leave_days ld
     JOIN leave_requests lr ON lr.id = ld.request_id
     JOIN staff s ON s.id = ld.staff_id
     WHERE ld.id = ? AND lr.status = 'approved'`
  ).bind(id).first<{ id: number; request_id: number; staff_id: number; date: string; name: string }>();
  if (!row) throw new HttpError(404, "Không tìm thấy ngày nghỉ phép.");
  if (user.role !== "admin" && user.staffId !== row.staff_id) {
    throw new HttpError(403, "Chỉ được hủy nghỉ phép của chính mình.");
  }
  if (user.role !== "admin" && row.date < todayInVietnam()) {
    throw new HttpError(400, "Ngày nghỉ đã qua, không thể tự hủy. Vui lòng liên hệ admin nếu cần chỉnh dữ liệu.");
  }
  await env.DB.prepare("DELETE FROM leave_days WHERE id = ?").bind(id).run();
  const remaining = await env.DB.prepare("SELECT COUNT(*) AS count FROM leave_days WHERE request_id = ?")
    .bind(row.request_id)
    .first<{ count: number }>();
  if ((remaining?.count || 0) === 0) {
    await env.DB.prepare(
      `UPDATE leave_requests SET status = 'cancelled', decision = 'cancelled',
       decided_at = CURRENT_TIMESTAMP, decided_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    )
      .bind(user.id, row.request_id)
      .run();
  }
  await audit(env, user.id, "cancel", "leave_day", id, `Hủy nghỉ phép ${row.name}: ${row.date}`);
  return json({ ok: true });
}

async function getAudit(env: Env, url: URL, user: User): Promise<Response> {
  const filters = auditFiltersForUser(user, url);
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 20));
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const { logs, total } = await listAuditLogs(env, filters, { limit, offset: (page - 1) * limit });
  return json({ auditLogs: logs, total, page, limit });
}

async function deleteAuditEndpoint(env: Env, user: User): Promise<Response> {
  requireAdmin(user);
  const result = await env.DB.prepare("DELETE FROM audit_logs").run();
  const deleted = result.meta.changes;
  // Logged after the wipe so the deletion itself stays on record.
  await audit(env, user.id, "delete", "audit_log", null, `Xóa toàn bộ lịch sử thay đổi (${deleted} dòng)`);
  return json({ ok: true, deleted });
}

function auditFiltersForUser(user: User, url?: URL): { actor?: string; action?: string; q?: string; actorUserId?: number; relatedUserId?: number; relatedStaffId?: number } {
  if (user.role !== "admin") return { relatedUserId: user.id, relatedStaffId: user.staffId ?? undefined };
  return {
    actor: url?.searchParams.get("actor")?.trim() || undefined,
    action: url?.searchParams.get("action")?.trim() || undefined,
    q: url?.searchParams.get("q")?.trim() || undefined
  };
}

async function listUnits(env: Env): Promise<ScheduleUnit[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, code, section, label, type, max_per_day, sort_order, computed
     FROM schedule_units ORDER BY sort_order`
  ).all<UnitRow>();
  return results.map(mapUnitRow);
}

async function listRotations(env: Env): Promise<UnitRotation[]> {
  const { results } = await env.DB.prepare(
    `SELECT ur.unit_id, ur.start_date, ur.mode, ur.enabled, urm.turn_index, urm.member_order,
            s.id AS staff_id, s.name AS staff_name, s.type AS staff_type
     FROM unit_rotations ur
     LEFT JOIN unit_rotation_members urm ON urm.unit_id = ur.unit_id
     LEFT JOIN staff s ON s.id = urm.staff_id
     WHERE ur.enabled = 1
     ORDER BY ur.unit_id, urm.turn_index, urm.member_order`
  ).all<RotationRow>();
  const map = new Map<number, UnitRotation>();
  for (const row of results) {
    if (!map.has(row.unit_id)) {
      map.set(row.unit_id, { unitId: row.unit_id, startDate: row.start_date, mode: row.mode, enabled: !!row.enabled, turns: [] });
    }
    if (row.staff_id && row.turn_index !== null) {
      const rotation = map.get(row.unit_id)!;
      if (!rotation.turns[row.turn_index]) rotation.turns[row.turn_index] = [];
      rotation.turns[row.turn_index].push({
        staffId: row.staff_id,
        staffName: row.staff_name,
        staffType: row.staff_type,
        turnIndex: row.turn_index,
        memberOrder: row.member_order
      });
    }
  }
  return [...map.values()].map((rotation) => ({
    ...rotation,
    turns: rotation.turns.filter((turn) => Array.isArray(turn) && turn.length > 0)
  }));
}

async function getUnitById(env: Env, id: number): Promise<ScheduleUnit> {
  const row = await env.DB.prepare(
    "SELECT id, code, section, label, type, max_per_day, sort_order, computed FROM schedule_units WHERE id = ?"
  ).bind(id).first<UnitRow>();
  if (!row) throw new HttpError(404, "Không tìm thấy hàng lịch.");
  return mapUnitRow(row);
}

async function getStaffById(env: Env, id: number): Promise<Staff> {
  const row = await env.DB.prepare("SELECT id, family_middle_name, name, type, active FROM staff WHERE id = ?").bind(id).first<StaffRow>();
  if (!row) throw new HttpError(404, "Không tìm thấy nhân sự.");
  return mapStaffRow(row);
}

async function listAssignments(env: Env, dates: string[]): Promise<Assignment[]> {
  const start = dates[0];
  const end = dates[dates.length - 1];
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.unit_id, u.code AS unit_code, a.date, a.staff_id, s.name AS staff_name, s.type AS staff_type, a.slot
     FROM schedule_assignments a
     JOIN schedule_units u ON u.id = a.unit_id
     JOIN staff s ON s.id = a.staff_id
     WHERE a.date BETWEEN ? AND ?
     ORDER BY a.date, u.sort_order, a.slot`
  ).bind(start, end).all<AssignmentRow>();
  return results.map(mapAssignmentRow);
}

async function listLeaveDays(env: Env, dates: string[], rawRange = false): Promise<LeaveDay[]> {
  const start = dates[0];
  const end = rawRange ? dates[1] : dates[dates.length - 1];
  const { results } = await env.DB.prepare(
    `SELECT ld.id, ld.request_id, ld.date, ld.staff_id, s.name AS staff_name, ld.staff_type, lr.reason, lr.created_at
     FROM leave_days ld
     JOIN leave_requests lr ON lr.id = ld.request_id
     JOIN staff s ON s.id = ld.staff_id
     WHERE ld.date BETWEEN ? AND ? AND lr.status = 'approved'
     ORDER BY ld.date, ld.staff_type, s.name`
  ).bind(start, end).all<LeaveDayRow>();
  return results.map(mapLeaveDayRow);
}

/**
 * Days a staff member is unavailable because of leave: approved leave plus leave that has been
 * requested and is still waiting for approval. Scheduling somebody on a day they already asked off
 * would otherwise block the admin from approving that request later on.
 */
async function listRequestedLeaveStaffDays(env: Env, days: string[]): Promise<Set<string>> {
  const { results } = await env.DB.prepare(
    `SELECT ld.staff_id, ld.date
     FROM leave_days ld
     JOIN leave_requests lr ON lr.id = ld.request_id
     WHERE ld.date BETWEEN ? AND ? AND lr.status IN ('approved', 'pending')`
  ).bind(days[0], days[days.length - 1]).all<{ staff_id: number; date: string }>();
  return new Set((results || []).map((row) => `${row.staff_id}:${row.date}`));
}

async function listAuditLogs(
  env: Env,
  filters: { actor?: string; action?: string; q?: string; actorUserId?: number; relatedUserId?: number; relatedStaffId?: number } = {},
  page: { limit: number; offset: number } = { limit: 20, offset: 0 }
): Promise<{ logs: AuditLog[]; total: number }> {
  const where = ["TRUE"];
  const params: unknown[] = [];
  if (filters.actorUserId) {
    where.push("al.actor_user_id = ?");
    params.push(filters.actorUserId);
  }
  if (filters.relatedUserId) {
    if (filters.relatedStaffId) {
      where.push(`(
        al.actor_user_id = ? OR (
          al.entity_type = 'leave' AND al.action IN ('approve', 'reject') AND EXISTS (
            SELECT 1 FROM leave_requests lr
            WHERE lr.id = al.entity_id AND (lr.created_by = ? OR lr.staff_id = ?)
          )
        )
      )`);
      params.push(filters.relatedUserId, filters.relatedUserId, filters.relatedStaffId);
    } else {
      where.push("al.actor_user_id = ?");
      params.push(filters.relatedUserId);
    }
  }
  if (filters.actor) {
    where.push("u.username LIKE ?");
    params.push(`%${filters.actor}%`);
  }
  if (filters.action) {
    const actionValues = getAuditActionValues(filters.action);
    where.push(`al.action IN (${actionValues.map(() => "?").join(", ")})`);
    params.push(...actionValues);
  }
  if (filters.q) {
    where.push("(al.summary LIKE ? OR al.entity_type LIKE ?)");
    params.push(`%${filters.q}%`, `%${filters.q}%`);
  }
  const from = `FROM audit_logs al LEFT JOIN users u ON u.id = al.actor_user_id WHERE ${where.join(" AND ")}`;
  const [rows, count] = await Promise.all([
    env.DB.prepare(
      `SELECT al.id, u.username AS actor_username, al.action, al.entity_type, al.entity_id, al.summary, al.created_at
       ${from}
       ORDER BY al.created_at DESC, al.id DESC
       LIMIT ? OFFSET ?`
    ).bind(...params, page.limit, page.offset).all<AuditRow>(),
    env.DB.prepare(`SELECT COUNT(*)::int AS total ${from}`).bind(...params).first<{ total: number }>()
  ]);
  return { logs: rows.results.map(mapAuditRow), total: count?.total ?? 0 };
}

async function audit(
  env: Env,
  actorUserId: number | null,
  action: string,
  entityType: string,
  entityId: number | null,
  summary: string,
  payload?: unknown
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, summary, payload) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(actorUserId, action, entityType, entityId, summary, payload ? JSON.stringify(payload) : null).run();
}

function nextSlot(assignments: Assignment[], unitId: number, date: string): number {
  const used = new Set(assignments.filter((a) => a.unitId === unitId && a.date === date).map((a) => a.slot));
  let slot = 0;
  while (used.has(slot)) slot += 1;
  return slot;
}

async function assertStaffMatchesRole(env: Env, staffId: number, role: Role): Promise<void> {
  if (role === "admin") return;
  const staff = await getStaffById(env, staffId);
  if (
    (role === "bs" && staff.type !== "BS") ||
    (role === "ktv" && staff.type !== "KTV") ||
    (role === "tkyk" && staff.type !== "TKYK")
  ) {
    throw new HttpError(400, "Role không khớp loại nhân sự.");
  }
}

export function usernameAvailabilityLookup(
  username: string,
  exceptUserId?: number
): { sql: string; bindings: Array<string | number> } {
  return exceptUserId === undefined
    ? {
        sql: "SELECT id FROM users WHERE lower(username) = lower(?)",
        bindings: [username]
      }
    : {
        sql: "SELECT id FROM users WHERE lower(username) = lower(?) AND id <> ?",
        bindings: [username, exceptUserId]
      };
}

async function assertUsernameAvailable(env: Env, username: string, exceptUserId?: number): Promise<void> {
  const lookup = usernameAvailabilityLookup(username, exceptUserId);
  const row = await env.DB.prepare(lookup.sql).bind(...lookup.bindings).first<{ id: number }>();
  if (row) throw new HttpError(400, "Username đã tồn tại.");
}

function idFromPath(path: string): number {
  const value = Number(path.split("/").pop());
  if (!Number.isInteger(value) || value <= 0) throw new HttpError(400, "ID không hợp lệ.");
  return value;
}

function isRole(value: unknown): value is Role {
  return value === "admin" || value === "bs" || value === "ktv" || value === "tkyk";
}

function isStaffType(value: unknown): value is StaffType {
  return value === "BS" || value === "KTV" || value === "TKYK";
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "JSON không hợp lệ.");
  }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

function cookie(request: Request, name: string, value: string, maxAge: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function parseCookies(header: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!header) return map;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key) map.set(key, rest.join("="));
  }
  return map;
}

async function hashPassword(salt: string, password: string): Promise<string> {
  const input = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function publicUser(user: User): User {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    staffId: user.staffId,
    staffName: user.staffName ?? null,
    staffFullName: user.staffFullName ?? null,
    signature: user.signature ?? null,
    hasSignature: !!user.signature
  };
}

interface UserRow {
  id: number;
  username: string;
  role: Role;
  staff_id: number | null;
  staff_name?: string | null;
  staff_full_name?: string | null;
  signature?: string | null;
}

interface StaffRow {
  id: number;
  family_middle_name: string;
  name: string;
  type: StaffType;
  active: number;
}

interface UnitRow {
  id: number;
  code: string;
  section: "I" | "II" | "III";
  label: string;
  type: ScheduleUnit["type"];
  max_per_day: number | null;
  sort_order: number;
  computed: number;
}

interface AssignmentRow {
  id: number;
  unit_id: number;
  unit_code: string;
  date: string;
  staff_id: number;
  staff_name: string;
  staff_type: StaffType;
  slot: number;
}

interface LeaveDayRow {
  id: number;
  request_id: number;
  date: string;
  staff_id: number;
  staff_name: string;
  staff_type: StaffType;
  reason: string | null;
  created_at: string;
}

interface AuditRow {
  id: number;
  actor_username: string | null;
  action: string;
  entity_type: string;
  entity_id: number | null;
  summary: string;
  created_at: string;
}

interface RotationRow {
  unit_id: number;
  start_date: string;
  mode: "daily" | "weekly";
  enabled: number;
  turn_index: number | null;
  member_order: number;
  staff_id: number | null;
  staff_name: string;
  staff_type: StaffType;
}

function mapUserRow(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    staffId: row.staff_id,
    staffName: row.staff_name ?? null,
    staffFullName: row.staff_full_name ?? null,
    signature: row.signature ?? null
  };
}

function mapStaffRow(row: StaffRow): Staff {
  return {
    id: row.id,
    familyMiddleName: row.family_middle_name,
    name: row.name,
    type: row.type,
    active: !!row.active
  };
}

function mapUnitRow(row: UnitRow): ScheduleUnit {
  return {
    id: row.id,
    code: row.code,
    section: row.section,
    label: row.label,
    type: row.type,
    maxPerDay: row.max_per_day,
    sortOrder: row.sort_order,
    computed: !!row.computed
  };
}

function mapAssignmentRow(row: AssignmentRow): Assignment {
  return {
    id: row.id,
    unitId: row.unit_id,
    unitCode: row.unit_code,
    date: row.date,
    staffId: row.staff_id,
    staffName: row.staff_name,
    staffType: row.staff_type,
    slot: row.slot
  };
}

function mapLeaveDayRow(row: LeaveDayRow): LeaveDay {
  return {
    id: row.id,
    requestId: row.request_id,
    date: row.date,
    staffId: row.staff_id,
    staffName: row.staff_name,
    staffType: row.staff_type,
    reason: row.reason,
    registeredAt: row.created_at
  };
}

function mapAuditRow(row: AuditRow): AuditLog {
  return {
    id: row.id,
    actorUsername: row.actor_username,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    summary: row.summary,
    createdAt: row.created_at
  };
}

async function getSettings(env: Env) {
  const { results } = await env.DB.prepare("SELECT key, value FROM system_settings").all<{ key: string; value: string }>();
  const map = new Map<string, string>();
  for (const row of results || []) {
    map.set(row.key, row.value);
  }
  return {
    approve_leave_bs: map.get("approve_leave_bs") === "1",
    approve_leave_ktv: map.get("approve_leave_ktv") === "1",
    approve_swap: map.get("approve_swap") === "1",
    show_staff_rail: map.get("show_staff_rail") !== "0",
    show_leave_month_calendar: map.get("show_leave_month_calendar") === "1"
  };
}

async function getBlockedDates(env: Env): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT date FROM blocked_leave_days ORDER BY date").all<{ date: string }>();
  return (results || []).map((r) => r.date);
}

// Pending requests are listed regardless of the viewed week so they never disappear while waiting.
async function listPendingLeaves(env: Env, user: User): Promise<PendingLeave[]> {
  if (user.role !== "admin" && !user.staffId) return [];
  const pendingFilter = user.role === "admin" ? "" : " AND lr.staff_id = ?";
  const params: number[] = user.role === "admin" ? [] : [user.staffId!];
  const { results } = await env.DB.prepare(
    `SELECT lr.id, lr.staff_id, s.name AS staff_name, s.type AS staff_type, lr.reason, lr.created_at, ld.date
     FROM leave_requests lr
     JOIN staff s ON s.id = lr.staff_id
     JOIN leave_days ld ON ld.request_id = lr.id
     WHERE lr.status = 'pending'${pendingFilter}
     ORDER BY lr.created_at, ld.date, s.name`
  ).bind(...params).all<{ id: number; staff_id: number; staff_name: string; staff_type: StaffType; reason: string | null; created_at: string; date: string }>();

  const map = new Map<number, PendingLeave>();
  for (const row of results || []) {
    if (!map.has(row.id)) {
      map.set(row.id, {
        id: row.id,
        staffId: row.staff_id,
        staffName: row.staff_name,
        staffType: row.staff_type,
        reason: row.reason,
        registeredAt: row.created_at,
        dates: []
      });
    }
    map.get(row.id)!.dates.push(row.date);
  }
  return [...map.values()];
}

async function getSettingsEndpoint(env: Env, user: User): Promise<Response> {
  requireAdmin(user);
  const settings = await getSettings(env);
  const blockedDates = await getBlockedDates(env);
  return json({ ...settings, blocked_dates: blockedDates });
}

async function saveSettingsEndpoint(request: Request, env: Env, user: User): Promise<Response> {
  requireAdmin(user);
  const body = await readJson<Partial<SystemSettings>>(request);
  const statements: PostgresPreparedStatement[] = [];
  if (body.approve_leave_bs !== undefined) {
    statements.push(env.DB.prepare("INSERT INTO system_settings (key, value) VALUES ('approve_leave_bs', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").bind(body.approve_leave_bs ? "1" : "0"));
  }
  if (body.approve_leave_ktv !== undefined) {
    statements.push(env.DB.prepare("INSERT INTO system_settings (key, value) VALUES ('approve_leave_ktv', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").bind(body.approve_leave_ktv ? "1" : "0"));
  }
  if (body.approve_swap !== undefined) {
    statements.push(env.DB.prepare("INSERT INTO system_settings (key, value) VALUES ('approve_swap', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").bind(body.approve_swap ? "1" : "0"));
  }
  if (body.show_staff_rail !== undefined) {
    statements.push(env.DB.prepare("INSERT INTO system_settings (key, value) VALUES ('show_staff_rail', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").bind(body.show_staff_rail ? "1" : "0"));
  }
  if (body.show_leave_month_calendar !== undefined) {
    statements.push(env.DB.prepare("INSERT INTO system_settings (key, value) VALUES ('show_leave_month_calendar', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").bind(body.show_leave_month_calendar ? "1" : "0"));
  }
  if (statements.length) {
    await env.DB.batch(statements);
  }
  await audit(env, user.id, "update", "settings", null, "Cập nhật cài đặt hệ thống");
  return json({ ok: true });
}

async function addBlockedDay(request: Request, env: Env, user: User): Promise<Response> {
  requireAdmin(user);
  const body = await readJson<{ date?: string }>(request);
  const date = String(body.date || "").slice(0, 10);
  if (!date) throw new HttpError(400, "Thiếu ngày cần chặn.");
  await env.DB.prepare("INSERT INTO blocked_leave_days (date) VALUES (?) ON CONFLICT (date) DO NOTHING").bind(date).run();
  await audit(env, user.id, "create", "blocked_leave_day", null, `Chặn nghỉ phép ngày: ${date}`);
  return json({ ok: true });
}

async function deleteBlockedDay(env: Env, user: User, date: string): Promise<Response> {
  requireAdmin(user);
  if (!date) throw new HttpError(400, "Thiếu ngày cần xóa chặn.");
  await env.DB.prepare("DELETE FROM blocked_leave_days WHERE date = ?").bind(date).run();
  await audit(env, user.id, "delete", "blocked_leave_day", null, `Bỏ chặn nghỉ phép ngày: ${date}`);
  return json({ ok: true });
}

async function approveLeave(env: Env, user: User, requestId: number): Promise<Response> {
  requireAdmin(user);
  const requestRow = await env.DB.prepare(
    `SELECT lr.id, lr.staff_id, s.name AS staff_name, s.type AS staff_type, s.active
     FROM leave_requests lr
     JOIN staff s ON s.id = lr.staff_id
     WHERE lr.id = ? AND lr.status = 'pending'`
  ).bind(requestId).first<{ id: number; staff_id: number; staff_name: string; staff_type: StaffType; active: number }>();
  if (!requestRow) throw new HttpError(404, "Không tìm thấy yêu cầu nghỉ phép chờ duyệt.");

  const leaveDays = await env.DB.prepare(
    "SELECT date FROM leave_days WHERE request_id = ? ORDER BY date"
  ).bind(requestId).all<{ date: string }>();
  const dates = (leaveDays.results || []).map((row) => row.date);
  if (dates.length === 0) throw new HttpError(400, "Yêu cầu nghỉ phép không có ngày hợp lệ.");

  const approvedLeaveDays = await listLeaveDays(env, [dates[0], dates[dates.length - 1]], true);
  const validationMessage = validateLeaveInput({
    staff: {
      id: requestRow.staff_id,
      familyMiddleName: "",
      name: requestRow.staff_name,
      type: requestRow.staff_type,
      active: !!requestRow.active
    },
    dates,
    leaveDays: approvedLeaveDays,
    limitPerType: 2
  });
  if (validationMessage) throw new HttpError(409, validationMessage);
  await assertNoDutyLeaveConflicts(env, requestRow.staff_id, dates);

  const statements: PostgresPreparedStatement[] = [
    env.DB.prepare(
      `UPDATE leave_requests SET status = 'approved', decision = 'approved',
       decided_at = CURRENT_TIMESTAMP, decided_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'pending'`
    ).bind(user.id, requestId)
  ];

  const placeholders = dates.map(() => "?").join(",");
  statements.push(
    env.DB.prepare(`
      DELETE FROM schedule_assignments
      WHERE staff_id = ?
        AND date IN (${placeholders})
        AND unit_id IN (SELECT id FROM schedule_units WHERE type IN ('work_bs', 'work_ktv'))
    `).bind(requestRow.staff_id, ...dates)
  );

  const approvalResults = await env.DB.batch(statements);
  if ((approvalResults[0]?.meta.changes || 0) !== 1) throw new HttpError(409, "Yêu cầu nghỉ phép đã được xử lý bởi một phiên khác.");
  await audit(env, user.id, "approve", "leave", requestId, `Duyệt nghỉ phép cho ${requestRow.staff_name}: ${dates.join(", ")}`);
  return json({ ok: true });
}

async function rejectLeave(env: Env, user: User, requestId: number): Promise<Response> {
  requireAdmin(user);
  const requestRow = await env.DB.prepare(
    `SELECT lr.id, lr.staff_id, lr.requested_dates, s.name AS staff_name
     FROM leave_requests lr
     JOIN staff s ON s.id = lr.staff_id
     WHERE lr.id = ? AND lr.status = 'pending'`
  ).bind(requestId).first<{ id: number; staff_id: number; requested_dates: string | null; staff_name: string }>();
  if (!requestRow) throw new HttpError(404, "Không tìm thấy yêu cầu nghỉ phép chờ duyệt.");

  const rejectedDays = await env.DB.prepare("SELECT date FROM leave_days WHERE request_id = ? ORDER BY date")
    .bind(requestId)
    .all<{ date: string }>();
  const dates = (rejectedDays.results || []).map((row) => row.date);
  await env.DB.prepare(
    `UPDATE leave_requests SET status = 'cancelled', decision = 'rejected', requested_dates = ?,
     decided_at = CURRENT_TIMESTAMP, decided_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(requestRow.requested_dates || dates.join(","), user.id, requestId).run();
  await env.DB.prepare("DELETE FROM leave_days WHERE request_id = ?").bind(requestId).run();
  await audit(env, user.id, "reject", "leave", requestId, `Từ chối nghỉ phép của ${requestRow.staff_name}: ${dates.join(", ")}`);
  return json({ ok: true });
}

interface SwapRequestRow {
  id: number;
  token: string;
  status: string;
  created_at: string;
  expires_at: string | null;
  creator_staff_id: number | null;
  assignment_id_1: number;
  staff_id_1: number;
  unit_id_1: number;
  date_1: string;
  slot_1: number;
  assignment_id_2: number;
  staff_id_2: number;
  unit_id_2: number;
  date_2: string;
  slot_2: number;
}

function requireSwapRecipient(row: SwapRequestRow, user: User): void {
  if (user.role === "admin") return;
  const intendedStaffId = row.creator_staff_id === row.staff_id_1
    ? row.staff_id_2
    : row.creator_staff_id === row.staff_id_2
      ? row.staff_id_1
      : null;
  if (!user.staffId || user.staffId !== intendedStaffId) {
    throw new HttpError(403, "Chỉ nhân sự nhận yêu cầu đổi trực mới được xác nhận.");
  }
}

async function getSwapRequestPublic(env: Env, url: URL, user: User): Promise<Response> {
  const token = url.searchParams.get("token") || "";
  if (!token) throw new HttpError(400, "Thiếu token xác nhận.");

  const row = await env.DB.prepare(
    `SELECT sr.*, creator.staff_id AS creator_staff_id,
            s1.name AS staff_name_1, u1.label AS unit_label_1,
            s2.name AS staff_name_2, u2.label AS unit_label_2
     FROM swap_requests sr
     LEFT JOIN users creator ON creator.id = sr.created_by
     JOIN staff s1 ON s1.id = sr.staff_id_1
     JOIN schedule_units u1 ON u1.id = sr.unit_id_1
     JOIN staff s2 ON s2.id = sr.staff_id_2
     JOIN schedule_units u2 ON u2.id = sr.unit_id_2
     WHERE sr.token = ?`
  ).bind(token).first<SwapRequestRow & {
    staff_name_1: string; unit_label_1: string;
    staff_name_2: string; unit_label_2: string;
  }>();

  if (!row) throw new HttpError(404, "Yêu cầu đổi trực không tồn tại hoặc đã bị xóa.");
  requireSwapRecipient(row, user);
  if (row.status === "pending" && row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
    throw new HttpError(410, "Yêu cầu đổi trực đã hết hạn.");
  }

  return json({
    id: row.id,
    token: row.token,
    status: row.status,
    createdAt: row.created_at,
    assignmentId1: row.assignment_id_1,
    staffId1: row.staff_id_1,
    staffName1: row.staff_name_1,
    unitLabel1: row.unit_label_1,
    date1: row.date_1,
    slot1: row.slot_1,
    assignmentId2: row.assignment_id_2,
    staffId2: row.staff_id_2,
    staffName2: row.staff_name_2,
    unitLabel2: row.unit_label_2,
    date2: row.date_2,
    slot2: row.slot_2
  });
}

async function acceptSwapPublic(env: Env, url: URL, user: User): Promise<Response> {
  const token = url.searchParams.get("token") || "";
  if (!token) throw new HttpError(400, "Thiếu token xác nhận.");

  const row = await env.DB.prepare(
    `SELECT sr.*, creator.staff_id AS creator_staff_id
     FROM swap_requests sr
     LEFT JOIN users creator ON creator.id = sr.created_by
     WHERE sr.token = ? AND sr.status = 'pending'
       AND (sr.expires_at IS NULL OR sr.expires_at > CURRENT_TIMESTAMP)`
  ).bind(token).first<SwapRequestRow>();

  if (!row) throw new HttpError(400, "Yêu cầu đổi trực đã được duyệt, từ chối hoặc không hợp lệ.");
  requireSwapRecipient(row, user);

  const [asg1, asg2] = await Promise.all([
    env.DB.prepare("SELECT id, staff_id, unit_id, date, slot FROM schedule_assignments WHERE id = ?").bind(row.assignment_id_1).first<{ id: number; staff_id: number; unit_id: number; date: string; slot: number }>(),
    env.DB.prepare("SELECT id, staff_id, unit_id, date, slot FROM schedule_assignments WHERE id = ?").bind(row.assignment_id_2).first<{ id: number; staff_id: number; unit_id: number; date: string; slot: number }>()
  ]);

  if (!asg1 || !asg2) {
    throw new HttpError(400, "Một trong hai ca trực cần đổi đã bị xóa khỏi hệ thống.");
  }

  if (asg1.staff_id !== row.staff_id_1 || asg2.staff_id !== row.staff_id_2) {
    throw new HttpError(400, "Nhân sự của ca trực đã thay đổi kể từ lúc gửi yêu cầu.");
  }

  if (asg1.unit_id !== row.unit_id_1 || asg1.date !== row.date_1 || asg1.slot !== row.slot_1 ||
      asg2.unit_id !== row.unit_id_2 || asg2.date !== row.date_2 || asg2.slot !== row.slot_2) {
    throw new HttpError(400, "Vị trí lịch trực đã thay đổi kể từ lúc gửi yêu cầu.");
  }

  const pendingGuard = "EXISTS (SELECT 1 FROM swap_requests WHERE id = ? AND status = 'pending' AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP))";
  const swapResults = await env.DB.batch([
    env.DB.prepare(
      `UPDATE schedule_assignments SET slot = ?, updated_at = CURRENT_TIMESTAMP, confirmed = 0 WHERE id = ? AND ${pendingGuard}`
    ).bind(-100000 - asg2.id, asg2.id, row.id),
    env.DB.prepare(
      `UPDATE schedule_assignments SET unit_id = ?, date = ?, slot = ?, updated_at = CURRENT_TIMESTAMP, confirmed = 0 WHERE id = ? AND ${pendingGuard}`
    ).bind(asg2.unit_id, asg2.date, asg2.slot, asg1.id, row.id),
    env.DB.prepare(
      `UPDATE schedule_assignments SET unit_id = ?, date = ?, slot = ?, updated_at = CURRENT_TIMESTAMP, confirmed = 0 WHERE id = ? AND ${pendingGuard}`
    ).bind(asg1.unit_id, asg1.date, asg1.slot, asg2.id, row.id),
    env.DB.prepare(
      "UPDATE swap_requests SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending' AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)"
    ).bind(row.id)
  ]);
  if ((swapResults.at(-1)?.meta.changes || 0) !== 1) {
    throw new HttpError(409, "Yêu cầu đổi trực đã được xử lý bởi một phiên khác.");
  }

  await syncWorkScheduleAfterDutySwap(env, {
    staffId1: asg1.staff_id,
    dutyDate1: asg1.date,
    staffId2: asg2.staff_id,
    dutyDate2: asg2.date,
    updatedBy: null
  });

  await env.DB.prepare("UPDATE swap_requests SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(row.id).run();

  const [staff1, staff2] = await Promise.all([
    getStaffById(env, row.staff_id_1),
    getStaffById(env, row.staff_id_2)
  ]);

  const staffType1 = staff1.type ? `${staff1.type}. ` : "";
  const staffType2 = staff2.type ? `${staff2.type}. ` : "";
  await audit(
    env,
    user.id,
    "accept_swap",
    "swap_request",
    row.id,
    `Đồng ý đổi trực: ${staffType1}${staff1.name} (${formatDate(row.date_1)}) <-> ${staffType2}${staff2.name} (${formatDate(row.date_2)})`
  );

  return json({ ok: true });
}

async function rejectSwapPublic(env: Env, url: URL, user: User): Promise<Response> {
  const token = url.searchParams.get("token") || "";
  if (!token) throw new HttpError(400, "Thiếu token xác nhận.");

  const row = await env.DB.prepare(
    `SELECT sr.*, creator.staff_id AS creator_staff_id
     FROM swap_requests sr
     LEFT JOIN users creator ON creator.id = sr.created_by
     WHERE sr.token = ? AND sr.status = 'pending'
       AND (sr.expires_at IS NULL OR sr.expires_at > CURRENT_TIMESTAMP)`
  ).bind(token).first<SwapRequestRow>();

  if (!row) throw new HttpError(400, "Yêu cầu đổi trực đã được duyệt, từ chối hoặc không hợp lệ.");
  requireSwapRecipient(row, user);

  const rejected = await env.DB.prepare(
    "UPDATE swap_requests SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'"
  ).bind(row.id).run();
  if ((rejected.meta.changes || 0) !== 1) throw new HttpError(409, "Yêu cầu đổi trực đã được xử lý bởi một phiên khác.");

  const [staff1, staff2] = await Promise.all([
    getStaffById(env, row.staff_id_1),
    getStaffById(env, row.staff_id_2)
  ]);

  const staffType1 = staff1.type ? `${staff1.type}. ` : "";
  const staffType2 = staff2.type ? `${staff2.type}. ` : "";
  await audit(
    env,
    user.id,
    "reject_swap",
    "swap_request",
    row.id,
    `Từ chối đổi trực: ${staffType1}${staff1.name} <-> ${staffType2}${staff2.name}`
  );

  return json({ ok: true });
}

// === DUTY REPORT ENDPOINTS ===

async function getReportEndpoint(env: Env, url: URL, user: User): Promise<Response> {
  const date = url.searchParams.get("date") || "";
  if (!date) throw new HttpError(400, "Thiếu ngày trực.");

  const row = await env.DB.prepare("SELECT * FROM duty_reports WHERE date = ?").bind(date).first();


  const { results: scheduledStaff } = await env.DB.prepare(`
    SELECT s.name, s.type
    FROM schedule_assignments sa
    JOIN staff s ON s.id = sa.staff_id
    JOIN schedule_units su ON su.id = sa.unit_id
    WHERE sa.date = ? AND su.type IN ('duty_bs', 'duty_ktv')
    ORDER BY su.type, sa.slot
  `).bind(date).all<{ name: string; type: string }>();

  const scheduledBs = (scheduledStaff || [])
    .filter((s) => s.type === "BS")
    .map((s) => s.name.trim());

  const scheduledKtv = (scheduledStaff || [])
    .filter((s) => s.type === "KTV")
    .map((s) => s.name.trim());

  return json({
    report: row ? mapReportRow(row) : null,
    scheduledBs,
    scheduledKtv
  });
}

async function listReportsEndpoint(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT date, report_date, report_time, bs_truc, ktv_truc FROM duty_reports ORDER BY date DESC LIMIT 100"
  ).all();
  return json({ reports: results });
}

async function saveReportEndpoint(request: Request, env: Env, user: User): Promise<Response> {
  const body = await readJson<Partial<DutyReport>>(request);
  const date = String(body.date || "").trim();
  const reportDate = String(body.reportDate || "").trim();
  const reportTime = String(body.reportTime || "").trim();
  if (!isIsoDate(date) || !isIsoDate(reportDate) || !reportTime) {
    throw new HttpError(400, "Ngày trực, ngày báo cáo hoặc giờ báo cáo không hợp lệ.");
  }
  const counts = [body.xqKhoa, body.xqGiuong, body.mri, body.ctScan].map((value) => Number(value ?? 0));
  if (counts.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new HttpError(400, "Số lượng ca phải là số nguyên không âm.");
  }

  const existing = await env.DB.prepare(
    "SELECT date FROM duty_reports WHERE date = ?"
  ).bind(date).first<Record<string, unknown>>();

  if (existing) {
    const updated = await env.DB.prepare(`
      UPDATE duty_reports SET
        report_date = ?,
        report_time = ?,
        bs_truc = ?,
        ktv_truc = ?,
        xq_khoa = ?,
        xq_giuong = ?,
        mri = ?,
        ct_scan = ?,
        thuoc_su_dung = ?,
        ca_kho = ?,
        thiet_bi = ?,
        an_ninh = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE ${dutyReportUpdateWhere(user.role)}
    `).bind(
      reportDate,
      reportTime,
      body.bsTruc,
      body.ktvTruc,
      ...counts,
      body.thuocSuDung || "",
      body.caKho || "",
      body.thietBi || "",
      body.anNinh || "",
      date
    ).run();
    if ((updated.meta.changes || 0) !== 1) {
      throw new HttpError(409, "Báo cáo vừa thay đổi. Vui lòng tải lại và lưu lại.");
    }
    await audit(env, user.id, "update", "duty_report", null, `Cập nhật báo cáo trực ngày ${date}`);
  } else {
    await env.DB.prepare(`
      INSERT INTO duty_reports (
        date, report_date, report_time, bs_truc, ktv_truc,
        xq_khoa, xq_giuong, mri, ct_scan, thuoc_su_dung, ca_kho, thiet_bi, an_ninh
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      date,
      reportDate,
      reportTime,
      body.bsTruc,
      body.ktvTruc,
      ...counts,
      body.thuocSuDung || "",
      body.caKho || "",
      body.thietBi || "",
      body.anNinh || ""
    ).run();
    await audit(env, user.id, "create", "duty_report", null, `Tạo báo cáo trực ngày ${date}`);
  }

  return json({ ok: true });
}

async function signReportEndpoint(request: Request, env: Env, user: User): Promise<Response> {
  const body = await readJson<{ date?: string; role?: unknown; signature?: string; signerName?: string; useStoredSignature?: boolean }>(request);
  const date = String(body.date || "").trim();
  const role = body.role;

  if (!isIsoDate(date) || !isReportRole(role)) {
    throw new HttpError(400, "Ngày trực hoặc vai trò ký không hợp lệ.");
  }

  if (role === "bs" && user.role !== "bs" && user.role !== "admin") {
    throw new HttpError(403, "Chỉ Bác sĩ trực hoặc Admin được ký vai trò này.");
  }
  if (role === "ktv" && user.role !== "ktv" && user.role !== "admin") {
    throw new HttpError(403, "Chỉ Kỹ thuật viên trực hoặc Admin được ký vai trò này.");
  }
  if (role === "lanhdao" && user.role !== "admin") {
    throw new HttpError(403, "Chỉ Lãnh đạo khoa hoặc Admin được ký vai trò này.");
  }

  if (role !== "lanhdao" && user.role !== "admin") {
    if (!user.staffId) throw new HttpError(403, "Tài khoản chưa liên kết nhân sự.");
    const dutyType = role === "bs" ? "duty_bs" : "duty_ktv";
    const scheduled = await env.DB.prepare(
      `SELECT 1
       FROM schedule_assignments a
       JOIN schedule_units u ON u.id = a.unit_id
       WHERE a.date = ? AND a.staff_id = ? AND u.type = ?
       LIMIT 1`
    ).bind(date, user.staffId, dutyType).first();
    if (!scheduled) throw new HttpError(403, "Chỉ nhân sự được phân công trực ngày này mới được ký.");
  }

  const reportExists = await env.DB.prepare("SELECT date FROM duty_reports WHERE date = ?").bind(date).first();
  if (!reportExists) throw new HttpError(409, "Hãy lưu báo cáo trước khi ký.");

  const signature = body.useStoredSignature ? user.signature : body.signature;
  if (!signature || !isSignatureDataUrl(signature)) {
    throw new HttpError(400, body.useStoredSignature ? "Tài khoản chưa có chữ ký mẫu hợp lệ." : "Chữ ký không hợp lệ.");
  }
  const name = resolveReportSignerName(body.signerName, user.staffFullName || user.staffName);
  if (!name) throw new HttpError(400, "Hãy nhập họ và tên người ký.");
  if (name.length > 120) throw new HttpError(400, "Họ và tên người ký không được quá 120 ký tự.");
  const nowStr = new Date().toISOString();

  const signatureCol = role === "bs" ? "signature_bs" : (role === "ktv" ? "signature_ktv" : "signature_lanhdao");
  const userIdCol = role === "bs" ? "signature_bs_user_id" : (role === "ktv" ? "signature_ktv_user_id" : "signature_lanhdao_user_id");
  const nameCol = role === "bs" ? "signature_bs_name" : (role === "ktv" ? "signature_ktv_name" : "signature_lanhdao_name");
  const atCol = role === "bs" ? "signature_bs_at" : (role === "ktv" ? "signature_ktv_at" : "signature_lanhdao_at");

  const signed = await env.DB.prepare(`
    UPDATE duty_reports SET
      ${signatureCol} = ?,
      ${userIdCol} = ?,
      ${nameCol} = ?,
      ${atCol} = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE date = ? AND ${signatureCol} IS NULL AND ${userIdCol} IS NULL
  `).bind(signature, user.id, name, nowStr, date).run();
  if ((signed.meta.changes || 0) !== 1) throw new HttpError(409, "Vai trò này đã được ký trước đó.");


  await audit(env, user.id, "sign", "duty_report", null, `Ký tên vai trò ${role === "bs" ? "BS" : (role === "ktv" ? "KTV" : "Lãnh đạo")} ngày ${date}: ${name}`);

  return json({ ok: true });
}

async function deleteReportEndpoint(env: Env, url: URL, user: User): Promise<Response> {
  requireAdmin(user);
  const date = url.searchParams.get("date") || "";
  if (!date) throw new HttpError(400, "Thiếu ngày trực.");

  const result = await env.DB.prepare("DELETE FROM duty_reports WHERE date = ?").bind(date).run();
  if (result.meta.changes === 0) {
    throw new HttpError(404, "Không tìm thấy báo cáo trực cho ngày này.");
  }

  await audit(env, user.id, "delete", "duty_report", null, `Xóa báo cáo trực ngày ${date}`);
  return json({ ok: true });
}

function mapReportRow(row: Record<string, any>) {
  return {
    date: row.date,
    reportDate: row.report_date,
    reportTime: row.report_time,
    bsTruc: row.bs_truc,
    ktvTruc: row.ktv_truc,
    xqKhoa: row.xq_khoa,
    xqGiuong: row.xq_giuong,
    mri: row.mri,
    ctScan: row.ct_scan,
    thuocSuDung: row.thuoc_su_dung,
    caKho: row.ca_kho,
    thietBi: row.thiet_bi,
    anNinh: row.an_ninh,
    signatureBs: row.signature_bs,
    signatureBsName: row.signature_bs_name,
    signatureBsAt: row.signature_bs_at,
    signatureKtv: row.signature_ktv,
    signatureKtvName: row.signature_ktv_name,
    signatureKtvAt: row.signature_ktv_at,
    signatureLanhdao: row.signature_lanhdao,
    signatureLanhdaoName: row.signature_lanhdao_name,
    signatureLanhdaoAt: row.signature_lanhdao_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function isSignatureDataUrl(value: string): boolean {
  return value.length <= 512_000 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
}

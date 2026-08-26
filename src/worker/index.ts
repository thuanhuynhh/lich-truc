import type {
  Assignment,
  AttendanceEntry,
  AuditLog,
  CoordinatorAssignment,
  DaySession,
  Department,
  NotificationItem,
  Position,
  Role,
  Rotation,
  RotationMember,
  ScheduleResponse,
  Section,
  SwapRequest,
  SystemSettings,
  User,
  WorkDay,
  WorkReport
} from "../shared/types";
import {
  addDays,
  canEditPersonOnDate,
  formatFullDate,
  isDaySession,
  isIsoDate,
  monthRange,
  normalizeMonth,
  rotationAssignmentsForWorkDays,
  sessionLabel,
  todayInVietnam
} from "../shared/schedule";
import { getAuditActionValues } from "../shared/audit";
import {
  canManageSchedule,
  isRole,
  isSignerRole,
  normalizePhone,
  resolveSignerName,
  roleLabel,
  validateAssignmentInput,
  validateCoordinatorSwap,
  validatePersonInput
} from "../shared/validation";
import { PostgresDatabase, type PostgresPreparedStatement, createPostgresClient } from "./database";

interface Env {
  DB: PostgresDatabase;
}

interface SessionUser extends User {
  sessionId: string;
}

const SESSION_COOKIE = "lk_session";
const SESSION_DAYS = 14;

/**
 * Điều kiện cập nhật người làm việc của một ô lịch. Khoa phòng chỉ sửa được ô
 * của chính mình và chỉ khi ngày làm chưa qua; admin và điều phối sửa mọi ô.
 */
export function assignmentPersonUpdate(params: {
  assignmentId: number;
  role: Role;
  departmentId: number | null;
  userId: number;
  personName: string;
  personPhone: string;
  today: string;
  lockOnWorkDay?: boolean;
}): { sql: string; bindings: unknown[] } {
  const base =
    "UPDATE assignments SET person_name = ?, person_phone = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
  const bindings: unknown[] = [params.personName, params.personPhone, params.userId, params.assignmentId];
  if (canManageSchedule(params.role)) return { sql: base, bindings };
  return {
    sql: `${base} AND department_id = ? AND date ${params.lockOnWorkDay ? ">" : ">="} ?`,
    bindings: [...bindings, params.departmentId, params.today]
  };
}

export function rotationDepartmentLookup(departmentIds: number[]): { sql: string; bindings: number[] } {
  return {
    sql: `SELECT id, name, active, sort_order FROM departments WHERE id IN (${departmentIds.map(() => "?").join(", ")})`,
    bindings: departmentIds
  };
}

export function rotationMembersInsert(positionId: number, turns: number[][]): { sql: string; bindings: number[] } {
  const bindings: number[] = [];
  const values = turns.flatMap((turn, turnIndex) =>
    turn.map((departmentId, memberOrder) => {
      bindings.push(positionId, turnIndex, departmentId, memberOrder);
      return "(?, ?, ?, ?)";
    })
  );
  return {
    sql: `INSERT INTO rotation_members (position_id, turn_index, department_id, member_order) VALUES ${values.join(", ")}`,
    bindings
  };
}

export function passwordResetSessionCleanup(
  actorUserId: number,
  targetUserId: number,
  currentSessionId: string
): { sql: string; bindings: unknown[] } {
  return actorUserId === targetUserId
    ? { sql: "DELETE FROM user_sessions WHERE user_id = ? AND id <> ?", bindings: [targetUserId, currentSessionId] }
    : { sql: "DELETE FROM user_sessions WHERE user_id = ?", bindings: [targetUserId] };
}

export function usernameAvailabilityLookup(
  username: string,
  exceptUserId?: number
): { sql: string; bindings: unknown[] } {
  return exceptUserId === undefined
    ? { sql: "SELECT id FROM users WHERE lower(username) = lower(?)", bindings: [username] }
    : { sql: "SELECT id FROM users WHERE lower(username) = lower(?) AND id <> ?", bindings: [username, exceptUserId] };
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

  if (path === "/api/auth/me" && method === "GET") return json({ user: publicUser(user) });
  if (path === "/api/notifications" && method === "GET") return getNotifications(env, user);
  if (path === "/api/notifications/read" && method === "POST") return markNotificationsRead(request, env, user);
  if (path === "/api/profile" && method === "PATCH") return updateProfile(request, env, user);

  if (path === "/api/departments" && method === "GET") return json({ departments: await listDepartments(env) });
  if (path === "/api/departments" && method === "POST") return createDepartment(request, env, user);
  if (path.match(/^\/api\/departments\/\d+$/) && method === "PATCH") {
    return updateDepartment(request, env, user, idFromPath(path));
  }
  if (path.match(/^\/api\/departments\/\d+$/) && method === "DELETE") {
    return deleteDepartment(env, user, idFromPath(path));
  }

  if (path === "/api/sections" && method === "GET") return json({ sections: await listSections(env) });
  if (path === "/api/sections" && method === "POST") return createSection(request, env, user);
  if (path.match(/^\/api\/sections\/\d+$/) && method === "PATCH") {
    return updateSection(request, env, user, idFromPath(path));
  }
  if (path.match(/^\/api\/sections\/\d+$/) && method === "DELETE") return deleteSection(env, user, idFromPath(path));

  if (path === "/api/positions" && method === "GET") return json({ positions: await listPositions(env) });
  if (path === "/api/positions" && method === "POST") return createPosition(request, env, user);
  if (path.match(/^\/api\/positions\/\d+$/) && method === "PATCH") {
    return updatePosition(request, env, user, idFromPath(path));
  }
  if (path.match(/^\/api\/positions\/\d+$/) && method === "DELETE") {
    return deletePosition(env, user, idFromPath(path));
  }

  if (path === "/api/users" && method === "GET") return listUsersEndpoint(env, user);
  if (path === "/api/users" && method === "POST") return createUser(request, env, user);
  if (path.match(/^\/api\/users\/\d+$/) && method === "PATCH") return updateUser(request, env, user, idFromPath(path));
  if (path.match(/^\/api\/users\/\d+$/) && method === "DELETE") return deleteUser(env, user, idFromPath(path));

  if (path === "/api/settings" && method === "GET") return getSettingsEndpoint(env, user);
  if (path === "/api/settings" && method === "POST") return saveSettingsEndpoint(request, env, user);

  if (path === "/api/schedule" && method === "GET") return getSchedule(env, url, user);

  if (path === "/api/work-days" && method === "POST") return createWorkDay(request, env, user);
  if (path.startsWith("/api/work-days/") && method === "PATCH") {
    return updateWorkDay(request, env, user, dateFromPath(path));
  }
  if (path.startsWith("/api/work-days/") && method === "DELETE") {
    return deleteWorkDay(env, user, dateFromPath(path));
  }

  if (path === "/api/schedule/assignment" && method === "PUT") return putAssignment(request, env, user);
  if (path.match(/^\/api\/schedule\/assignment\/\d+\/person$/) && method === "PATCH") {
    return updateAssignmentPerson(request, env, user, Number(path.split("/").at(-2)));
  }
  if (path.match(/^\/api\/schedule\/assignment\/\d+\/move$/) && method === "PATCH") {
    return moveAssignment(request, env, user, Number(path.split("/").at(-2)));
  }
  if (path.match(/^\/api\/schedule\/assignment\/\d+$/) && method === "DELETE") {
    return deleteAssignment(env, user, idFromPath(path));
  }
  if (path === "/api/schedule/clear" && method === "POST") return clearSchedule(request, env, user);

  if (path === "/api/coordinator-assignment" && method === "PUT") return putCoordinatorAssignment(request, env, user);
  if (path.match(/^\/api\/coordinator-assignment\/\d+$/) && method === "DELETE") {
    return deleteCoordinatorAssignment(env, user, idFromPath(path));
  }
  if (path.match(/^\/api\/coordinator-assignment\/\d+\/move$/) && method === "PATCH") {
    return moveCoordinatorAssignment(request, env, user, Number(path.split("/").at(-2)));
  }
  if (path === "/api/coordinator-swap" && method === "POST") return requestCoordinatorSwap(request, env, user);
  if (path === "/api/coordinator-swap" && method === "GET") return getSwapRequestEndpoint(env, url, user);
  if (path === "/api/coordinator-swap/accept" && method === "POST") return acceptSwapEndpoint(env, url, user);
  if (path === "/api/coordinator-swap/reject" && method === "POST") return rejectSwapEndpoint(env, url, user);

  if (path === "/api/rotations" && method === "GET") return json({ rotations: await listRotations(env) });
  if (path === "/api/rotations/apply" && method === "POST") return applyRotation(request, env, user, null);
  if (path.match(/^\/api\/rotations\/\d+$/) && method === "PUT") {
    return saveRotation(request, env, user, idFromPath(path));
  }
  if (path.match(/^\/api\/rotations\/\d+\/apply$/) && method === "POST") {
    return applyRotation(request, env, user, Number(path.split("/").at(-2)));
  }

  if (path === "/api/audit" && method === "GET") return getAudit(env, url, user);
  if (path === "/api/audit" && method === "DELETE") return deleteAuditEndpoint(env, url, user);

  if (path === "/api/reports" && method === "GET") return getReportEndpoint(env, url, user);
  if (path === "/api/reports/list" && method === "GET") return listReportsEndpoint(env);
  if (path === "/api/reports" && method === "POST") return saveReportEndpoint(request, env, user);
  if (path === "/api/reports" && method === "DELETE") return deleteReportEndpoint(env, url, user);
  if (path === "/api/reports/attendance" && method === "POST") return saveAttendanceEndpoint(request, env, user);
  if (path === "/api/reports/sign" && method === "POST") return signReportEndpoint(request, env, user);

  throw new HttpError(404, "Không tìm thấy API.");
}

async function login(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ username?: string; password?: string }>(request);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!username || !password) throw new HttpError(400, "Thiếu tên đăng nhập hoặc mật khẩu.");

  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.password_salt, u.password_hash, u.role, u.department_id, u.full_name,
            d.name AS department_name, u.signature
     FROM users u LEFT JOIN departments d ON d.id = u.department_id
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
    `SELECT u.id, u.username, u.role, u.department_id, u.full_name, d.name AS department_name,
            us.id AS session_id, u.signature
     FROM user_sessions us
     JOIN users u ON u.id = us.user_id
     LEFT JOIN departments d ON d.id = u.department_id
     WHERE us.id = ? AND us.expires_at > CURRENT_TIMESTAMP AND u.disabled = 0`
  ).bind(sessionId).first<UserRow & { session_id: string }>();
  if (!row) throw new HttpError(401, "Phiên đăng nhập đã hết hạn.");
  return { ...mapUserRow(row), sessionId: row.session_id };
}

function requireAdmin(user: User): void {
  if (user.role !== "admin") throw new HttpError(403, "Chỉ tài khoản quản lý được thực hiện thao tác này.");
}

/** Admin và điều phối đều được lên lịch. */
function requireScheduler(user: User): void {
  if (!canManageSchedule(user.role)) {
    throw new HttpError(403, "Chỉ quản lý hoặc điều phối được lên lịch.");
  }
}

async function updateProfile(request: Request, env: Env, user: SessionUser): Promise<Response> {
  const body = await readJson<{
    currentPassword?: string;
    newPassword?: string;
    signature?: string | null;
    fullName?: string;
  }>(request);
  const changesSignature = Object.prototype.hasOwnProperty.call(body, "signature");
  const changesFullName = Object.prototype.hasOwnProperty.call(body, "fullName");
  const newPassword = String(body.newPassword || "");

  if (!changesSignature && !changesFullName && !newPassword) throw new HttpError(400, "Không có thay đổi để lưu.");
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
    const cleanup = passwordResetSessionCleanup(user.id, user.id, user.sessionId);
    try {
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET password_salt = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind(salt, passwordHash, user.id),
        env.DB.prepare(cleanup.sql).bind(...cleanup.bindings),
        env.DB.prepare(
          "INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, summary, payload) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(user.id, "update", "user", user.id, "Tự đổi mật khẩu", null)
      ]);
    } catch (error) {
      console.error({ event: "profile_password_update_failed", userId: user.id, error });
      throw new HttpError(503, "Hệ thống tạm thời không thể lưu mật khẩu. Vui lòng thử lại.");
    }
  }

  if (changesFullName) {
    const fullName = String(body.fullName || "").trim();
    if (fullName.length > 120) throw new HttpError(400, "Họ và tên không được quá 120 ký tự.");
    await env.DB.prepare("UPDATE users SET full_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(fullName, user.id)
      .run();
  }

  if (changesSignature) {
    await env.DB.prepare("UPDATE users SET signature = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(body.signature ?? null, user.id)
      .run();
    await audit(env, user.id, "update", "user", user.id, body.signature ? "Cập nhật chữ ký mẫu" : "Xóa chữ ký mẫu");
  }

  const updated = await loadUserById(env, user.id);
  if (!updated) throw new HttpError(404, "Không tìm thấy tài khoản.");
  return json({ user: publicUser(updated) });
}

async function loadUserById(env: Env, id: number): Promise<User | null> {
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.role, u.department_id, u.full_name, d.name AS department_name, u.signature
     FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?`
  ).bind(id).first<UserRow>();
  return row ? mapUserRow(row) : null;
}

async function listDepartments(env: Env): Promise<Department[]> {
  const { results } = await env.DB.prepare(
    "SELECT id, name, active, sort_order FROM departments ORDER BY active DESC, sort_order, name"
  ).all<DepartmentRow>();
  return results.map(mapDepartmentRow);
}

async function createDepartment(request: Request, env: Env, user: User): Promise<Response> {
  requireAdmin(user);
  const body = await readJson<{ name?: string }>(request);
  const name = String(body.name || "").trim();
  if (!name) throw new HttpError(400, "Tên khoa phòng không hợp lệ.");
  if (name.length > 160) throw new HttpError(400, "Tên khoa phòng không được quá 160 ký tự.");

  const duplicate = await env.DB.prepare("SELECT id FROM departments WHERE lower(name) = lower(?)").bind(name).first();
  if (duplicate) throw new HttpError(409, "Khoa phòng này đã tồn tại.");

  const maxOrder = await env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) AS value FROM departments")
    .first<{ value: number }>();
  const result = await env.DB.prepare("INSERT INTO departments (name, active, sort_order) VALUES (?, 1, ?)")
    .bind(name, Number(maxOrder?.value || 0) + 10)
    .run();
  await audit(env, user.id, "create", "department", result.meta.last_row_id, `Thêm khoa phòng: ${name}`);
  return json({ departments: await listDepartments(env) }, 201);
}

async function updateDepartment(request: Request, env: Env, user: User, id: number): Promise<Response> {
  requireAdmin(user);
  const body = await readJson<{ name?: string; active?: boolean; sortOrder?: number }>(request);
  const current = await env.DB.prepare("SELECT id, name, active, sort_order FROM departments WHERE id = ?")
    .bind(id)
    .first<DepartmentRow>();
  if (!current) throw new HttpError(404, "Không tìm thấy khoa phòng.");

  const name = body.name === undefined ? current.name : String(body.name).trim();
  if (!name) throw new HttpError(400, "Tên khoa phòng không hợp lệ.");
  const active = body.active === undefined ? !!current.active : body.active;
  const sortOrder = body.sortOrder === undefined ? current.sort_order : Number(body.sortOrder);
  if (!Number.isInteger(sortOrder)) throw new HttpError(400, "Thứ tự khoa phòng không hợp lệ.");

  if (name.toLowerCase() !== current.name.toLowerCase()) {
    const duplicate = await env.DB.prepare("SELECT id FROM departments WHERE lower(name) = lower(?) AND id <> ?")
      .bind(name, id)
      .first();
    if (duplicate) throw new HttpError(409, "Khoa phòng này đã tồn tại.");
  }

  await env.DB.prepare(
    "UPDATE departments SET name = ?, active = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).bind(name, active ? 1 : 0, sortOrder, id).run();
  await audit(env, user.id, "update", "department", id, `Cập nhật khoa phòng: ${name}`);
  return json({ departments: await listDepartments(env) });
}

async function deleteDepartment(env: Env, user: User, id: number): Promise<Response> {
  requireAdmin(user);
  const current = await env.DB.prepare("SELECT name FROM departments WHERE id = ?").bind(id).first<{ name: string }>();
  if (!current) throw new HttpError(404, "Không tìm thấy khoa phòng.");
  await env.DB.prepare("DELETE FROM departments WHERE id = ?").bind(id).run();
  await audit(env, user.id, "delete", "department", id, `Xóa khoa phòng: ${current.name}`);
  return json({ departments: await listDepartments(env) });
}

async function listSections(env: Env): Promise<Section[]> {
  const { results } = await env.DB.prepare(
    "SELECT id, label, sort_order FROM sections ORDER BY sort_order, id"
  ).all<SectionRow>();
  return results.map(mapSectionRow);
}

async function nextSortOrder(env: Env, table: "sections" | "positions", sectionId?: number): Promise<number> {
  const row = sectionId === undefined
    ? await env.DB.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS value FROM ${table}`).first<{ value: number }>()
    : await env.DB.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS value FROM ${table} WHERE section_id = ?`)
        .bind(sectionId)
        .first<{ value: number }>();
  return Number(row?.value || 0) + 10;
}

async function createSection(request: Request, env: Env, user: User): Promise<Response> {
  requireAdmin(user);
  const body = await readJson<{ label?: string }>(request);
  const label = String(body.label || "").trim();
  if (!label) throw new HttpError(400, "Tên mục không hợp lệ.");
  if (label.length > 160) throw new HttpError(400, "Tên mục không được quá 160 ký tự.");

  const result = await env.DB.prepare("INSERT INTO sections (label, sort_order) VALUES (?, ?)")
    .bind(label, await nextSortOrder(env, "sections"))
    .run();
  await audit(env, user.id, "create", "section", result.meta.last_row_id, `Thêm mục lịch: ${label}`);
  return json({ sections: await listSections(env) }, 201);
}

async function updateSection(request: Request, env: Env, user: User, id: number): Promise<Response> {
  requireAdmin(user);
  const body = await readJson<{ label?: string; sortOrder?: number }>(request);
  const current = await env.DB.prepare("SELECT id, label, sort_order FROM sections WHERE id = ?")
    .bind(id)
    .first<SectionRow>();
  if (!current) throw new HttpError(404, "Không tìm thấy mục lịch.");

  const label = body.label === undefined ? current.label : String(body.label).trim();
  if (!label) throw new HttpError(400, "Tên mục không hợp lệ.");
  const sortOrder = body.sortOrder === undefined ? current.sort_order : Number(body.sortOrder);
  if (!Number.isInteger(sortOrder)) throw new HttpError(400, "Thứ tự mục không hợp lệ.");

  await env.DB.prepare("UPDATE sections SET label = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(label, sortOrder, id)
    .run();
  await audit(env, user.id, "update", "section", id, `Cập nhật mục lịch: ${label}`);
  return json({ sections: await listSections(env) });
}

async function deleteSection(env: Env, user: User, id: number): Promise<Response> {
  requireAdmin(user);
  const current = await env.DB.prepare("SELECT label FROM sections WHERE id = ?").bind(id).first<{ label: string }>();
  if (!current) throw new HttpError(404, "Không tìm thấy mục lịch.");
  await env.DB.prepare("DELETE FROM sections WHERE id = ?").bind(id).run();
  await audit(env, user.id, "delete", "section", id, `Xóa mục lịch: ${current.label}`);
  return json({ sections: await listSections(env) });
}

async function listPositions(env: Env): Promise<Position[]> {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.section_id, p.label, p.sort_order, p.active
     FROM positions p
     JOIN sections s ON s.id = p.section_id
     ORDER BY s.sort_order, s.id, p.sort_order, p.id`
  ).all<PositionRow>();
  return results.map(mapPositionRow);
}

async function getPositionById(env: Env, id: number): Promise<Position> {
  const row = await env.DB.prepare(
    "SELECT id, section_id, label, sort_order, active FROM positions WHERE id = ?"
  ).bind(id).first<PositionRow>();
  if (!row) throw new HttpError(404, "Không tìm thấy vị trí khám.");
  return mapPositionRow(row);
}

async function createPosition(request: Request, env: Env, user: User): Promise<Response> {
  requireAdmin(user);
  const body = await readJson<{ sectionId?: number; label?: string }>(request);
  const sectionId = Number(body.sectionId || 0);
  const label = String(body.label || "").trim();
  if (!sectionId) throw new HttpError(400, "Hãy chọn mục cho vị trí khám.");
  if (!label) throw new HttpError(400, "Tên vị trí khám không hợp lệ.");
  if (label.length > 160) throw new HttpError(400, "Tên vị trí khám không được quá 160 ký tự.");

  const section = await env.DB.prepare("SELECT id FROM sections WHERE id = ?").bind(sectionId).first();
  if (!section) throw new HttpError(404, "Không tìm thấy mục lịch.");

  const result = await env.DB.prepare(
    "INSERT INTO positions (section_id, label, sort_order, active) VALUES (?, ?, ?, 1)"
  ).bind(sectionId, label, await nextSortOrder(env, "positions", sectionId)).run();
  await audit(env, user.id, "create", "position", result.meta.last_row_id, `Thêm vị trí khám: ${label}`);
  return json({ positions: await listPositions(env) }, 201);
}

async function updatePosition(request: Request, env: Env, user: User, id: number): Promise<Response> {
  requireAdmin(user);
  const body = await readJson<{ label?: string; sectionId?: number; sortOrder?: number; active?: boolean }>(request);
  const current = await env.DB.prepare(
    "SELECT id, section_id, label, sort_order, active FROM positions WHERE id = ?"
  ).bind(id).first<PositionRow>();
  if (!current) throw new HttpError(404, "Không tìm thấy vị trí khám.");

  const label = body.label === undefined ? current.label : String(body.label).trim();
  if (!label) throw new HttpError(400, "Tên vị trí khám không hợp lệ.");
  const sectionId = body.sectionId === undefined ? current.section_id : Number(body.sectionId);
  if (!sectionId) throw new HttpError(400, "Mục lịch không hợp lệ.");
  if (sectionId !== current.section_id) {
    const section = await env.DB.prepare("SELECT id FROM sections WHERE id = ?").bind(sectionId).first();
    if (!section) throw new HttpError(404, "Không tìm thấy mục lịch.");
  }
  const sortOrder = body.sortOrder === undefined ? current.sort_order : Number(body.sortOrder);
  if (!Number.isInteger(sortOrder)) throw new HttpError(400, "Thứ tự vị trí không hợp lệ.");
  const active = body.active === undefined ? !!current.active : body.active;

  await env.DB.prepare(
    `UPDATE positions SET section_id = ?, label = ?, sort_order = ?, active = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(sectionId, label, sortOrder, active ? 1 : 0, id).run();
  await audit(env, user.id, "update", "position", id, `Cập nhật vị trí khám: ${label}`);
  return json({ positions: await listPositions(env) });
}

async function deletePosition(env: Env, user: User, id: number): Promise<Response> {
  requireAdmin(user);
  const current = await env.DB.prepare("SELECT label FROM positions WHERE id = ?").bind(id).first<{ label: string }>();
  if (!current) throw new HttpError(404, "Không tìm thấy vị trí khám.");
  await env.DB.prepare("DELETE FROM positions WHERE id = ?").bind(id).run();
  await audit(env, user.id, "delete", "position", id, `Xóa vị trí khám: ${current.label}`);
  return json({ positions: await listPositions(env) });
}

async function listUsers(env: Env): Promise<User[]> {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.username, u.role, u.department_id, u.full_name, d.name AS department_name, u.signature
     FROM users u LEFT JOIN departments d ON d.id = u.department_id
     ORDER BY u.role, u.username`
  ).all<UserRow>();
  return results.map(mapUserRow).map(publicUser);
}

async function listUsersEndpoint(env: Env, user: User): Promise<Response> {
  requireAdmin(user);
  return json({ users: await listUsers(env) });
}

async function createUser(request: Request, env: Env, user: User): Promise<Response> {
  requireAdmin(user);
  const body = await readJson<{
    username?: string;
    password?: string;
    role?: Role;
    departmentId?: number | null;
    fullName?: string;
    signature?: string | null;
  }>(request);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const role = body.role;
  const fullName = String(body.fullName || "").trim();
  if (!username || password.length < 6 || !isRole(role)) {
    throw new HttpError(400, "Tài khoản cần username, mật khẩu ít nhất 6 ký tự và vai trò hợp lệ.");
  }
  if (body.signature && !isSignatureDataUrl(body.signature)) throw new HttpError(400, "Chữ ký mẫu không hợp lệ.");
  const departmentId = role === "khoa_phong" ? Number(body.departmentId || 0) : null;
  if (role === "khoa_phong" && !departmentId) {
    throw new HttpError(400, "Tài khoản khoa phòng cần chọn khoa phòng liên kết.");
  }
  if (departmentId) await assertDepartmentExists(env, departmentId);
  await assertUsernameAvailable(env, username);

  const salt = crypto.randomUUID();
  const passwordHash = await hashPassword(salt, password);
  const result = await env.DB.prepare(
    `INSERT INTO users (username, password_salt, password_hash, role, department_id, full_name, signature)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(username, salt, passwordHash, role, departmentId, fullName, body.signature ?? null).run();
  await audit(env, user.id, "create", "user", result.meta.last_row_id, `Tạo tài khoản ${roleLabel(role)}: ${username}`);
  return json({ users: await listUsers(env) }, 201);
}

async function updateUser(request: Request, env: Env, user: SessionUser, id: number): Promise<Response> {
  requireAdmin(user);
  const body = await readJson<{
    username?: string;
    password?: string;
    role?: Role;
    departmentId?: number | null;
    fullName?: string;
    signature?: string | null;
    disabled?: boolean;
  }>(request);
  const current = await env.DB.prepare(
    "SELECT id, username, role, department_id, full_name FROM users WHERE id = ?"
  ).bind(id).first<UserRow>();
  if (!current) throw new HttpError(404, "Không tìm thấy tài khoản.");

  const changesSignature = Object.prototype.hasOwnProperty.call(body, "signature");
  const onlySignature = changesSignature && body.username === undefined && body.role === undefined
    && body.password === undefined && body.fullName === undefined && body.departmentId === undefined;

  if (changesSignature) {
    if (body.signature && !isSignatureDataUrl(body.signature)) throw new HttpError(400, "Chữ ký mẫu không hợp lệ.");
    await env.DB.prepare("UPDATE users SET signature = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(body.signature ?? null, id)
      .run();
    await audit(env, user.id, "update", "user", id, body.signature
      ? `Cập nhật chữ ký mẫu của ${current.username}`
      : `Xóa chữ ký mẫu của ${current.username}`);
    if (onlySignature) return json({ users: await listUsers(env) });
  }

  if (body.password !== undefined) {
    if (String(body.password).length < 6) throw new HttpError(400, "Mật khẩu mới cần ít nhất 6 ký tự.");
    const salt = crypto.randomUUID();
    const passwordHash = await hashPassword(salt, String(body.password));
    const cleanup = passwordResetSessionCleanup(user.id, id, user.sessionId);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET password_salt = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(salt, passwordHash, id),
      env.DB.prepare(cleanup.sql).bind(...cleanup.bindings)
    ]);
    await audit(env, user.id, "update", "user", id, `Đổi mật khẩu tài khoản ${current.username}`);
    if (body.username === undefined && body.role === undefined) return json({ users: await listUsers(env) });
  }

  const username = body.username === undefined ? current.username : String(body.username).trim();
  const role = body.role === undefined ? current.role : body.role;
  const fullName = body.fullName === undefined ? (current.full_name || "") : String(body.fullName).trim();
  if (!username) throw new HttpError(400, "Username không hợp lệ.");
  if (!isRole(role)) throw new HttpError(400, "Vai trò không hợp lệ.");
  const departmentId = role === "khoa_phong"
    ? Number((body.departmentId === undefined ? current.department_id : body.departmentId) || 0)
    : null;
  if (role === "khoa_phong" && !departmentId) {
    throw new HttpError(400, "Tài khoản khoa phòng cần chọn khoa phòng liên kết.");
  }
  if (departmentId) await assertDepartmentExists(env, departmentId);
  if (username.toLowerCase() !== current.username.toLowerCase()) await assertUsernameAvailable(env, username, id);
  if (current.role === "admin" && role !== "admin") await assertAnotherAdminExists(env, id);

  await env.DB.prepare(
    `UPDATE users SET username = ?, role = ?, department_id = ?, full_name = ?,
     disabled = COALESCE(?, disabled), updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(username, role, departmentId, fullName, body.disabled === undefined ? null : (body.disabled ? 1 : 0), id).run();
  await audit(env, user.id, "update", "user", id, `Cập nhật tài khoản ${username} (${roleLabel(role)})`);
  return json({ users: await listUsers(env) });
}

async function deleteUser(env: Env, user: User, id: number): Promise<Response> {
  requireAdmin(user);
  if (user.id === id) throw new HttpError(400, "Không thể xóa tài khoản đang đăng nhập.");
  const current = await env.DB.prepare("SELECT username, role FROM users WHERE id = ?")
    .bind(id)
    .first<{ username: string; role: Role }>();
  if (!current) throw new HttpError(404, "Không tìm thấy tài khoản.");
  if (current.role === "admin") await assertAnotherAdminExists(env, id);
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
  await audit(env, user.id, "delete", "user", id, `Xóa tài khoản ${current.username}`);
  return json({ users: await listUsers(env) });
}

async function assertAnotherAdminExists(env: Env, exceptUserId: number): Promise<void> {
  const other = await env.DB.prepare(
    "SELECT id FROM users WHERE role = 'admin' AND disabled = 0 AND id <> ? LIMIT 1"
  ).bind(exceptUserId).first();
  if (!other) throw new HttpError(400, "Hệ thống cần giữ lại ít nhất một tài khoản quản lý.");
}

async function assertDepartmentExists(env: Env, departmentId: number): Promise<void> {
  const row = await env.DB.prepare("SELECT id FROM departments WHERE id = ?").bind(departmentId).first();
  if (!row) throw new HttpError(404, "Không tìm thấy khoa phòng liên kết.");
}

async function assertUsernameAvailable(env: Env, username: string, exceptUserId?: number): Promise<void> {
  const lookup = usernameAvailabilityLookup(username, exceptUserId);
  const existing = await env.DB.prepare(lookup.sql).bind(...lookup.bindings).first();
  if (existing) throw new HttpError(409, "Username đã tồn tại.");
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
  const today = todayInVietnam();
  const horizon = addDays(today, 45);
  const backlog = addDays(today, -30);
  const items: Array<Omit<NotificationItem, "read">> = [];

  if (user.role === "khoa_phong" && user.departmentId) {
    const { results: missing } = await env.DB.prepare(
      `SELECT a.date, w.session
       FROM assignments a
       JOIN work_days w ON w.date = a.date
       WHERE a.department_id = ? AND a.date BETWEEN ? AND ? AND TRIM(a.person_name) = ''
       GROUP BY a.date, w.session
       ORDER BY a.date`
    ).bind(user.departmentId, today, horizon).all<{ date: string; session: DaySession }>();
    for (const row of missing) {
      items.push({
        id: `person:${user.departmentId}:${row.date}`,
        type: "person",
        title: "Chưa điền người làm việc",
        message: `Ngày ${formatFullDate(row.date)} (${sessionLabel(row.session)}) chưa có họ tên và số điện thoại người làm việc.`,
        createdAt: `${row.date}T00:00:00Z`,
        actionView: "schedule",
        actionDate: row.date
      });
    }

    const { results: unsigned } = await env.DB.prepare(
      `SELECT a.date
       FROM assignments a
       JOIN work_reports r ON r.date = a.date
       LEFT JOIN work_report_attendance att ON att.assignment_id = a.id
       WHERE a.department_id = ? AND a.date BETWEEN ? AND ? AND att.signature IS NULL
       GROUP BY a.date
       ORDER BY a.date DESC`
    ).bind(user.departmentId, backlog, today).all<{ date: string }>();
    for (const row of unsigned) {
      items.push({
        id: `report:${user.departmentId}:${row.date}`,
        type: "report",
        title: "Chưa ký báo cáo làm việc",
        message: `Báo cáo làm việc ngày ${formatFullDate(row.date)} đang chờ khoa phòng điểm danh và ký tên.`,
        createdAt: `${row.date}T00:00:00Z`,
        actionView: "report",
        actionDate: row.date
      });
    }
  }

  if (user.role === "dieu_phoi") {
    const { results: swaps } = await env.DB.prepare(
      `SELECT s.token, s.date_1, s.date_2, s.created_at,
              COALESCE(NULLIF(TRIM(u1.full_name), ''), u1.username) AS name_1
       FROM swap_requests s
       JOIN users u1 ON u1.id = s.user_id_1
       WHERE s.status = 'pending' AND s.user_id_2 = ?
         AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP)
       ORDER BY s.created_at DESC`
    ).bind(user.id).all<{ token: string; date_1: string; date_2: string; created_at: string; name_1: string }>();
    for (const row of swaps) {
      items.push({
        id: `swap:${row.token}`,
        type: "swap",
        title: "Yêu cầu đổi ngày làm",
        message: `${row.name_1} muốn đổi ngày ${formatFullDate(row.date_1)} với ngày ${formatFullDate(row.date_2)} của bạn.`,
        createdAt: row.created_at,
        actionView: "schedule",
        actionDate: row.date_2,
        swapToken: row.token
      });
    }
  }

  if (canManageSchedule(user.role)) {
    const { results: pendingPersons } = await env.DB.prepare(
      `SELECT a.date, COUNT(*) AS missing_count
       FROM assignments a
       WHERE a.date BETWEEN ? AND ? AND TRIM(a.person_name) = ''
       GROUP BY a.date
       ORDER BY a.date`
    ).bind(today, horizon).all<{ date: string; missing_count: number }>();
    for (const row of pendingPersons) {
      items.push({
        id: `pending-person:${row.date}`,
        type: "person",
        title: "Khoa phòng chưa điền người",
        message: `Ngày ${formatFullDate(row.date)} còn ${row.missing_count} khoa phòng chưa điền người làm việc.`,
        createdAt: `${row.date}T00:00:00Z`,
        actionView: "schedule",
        actionDate: row.date
      });
    }

    const { results: missingReports } = await env.DB.prepare(
      `SELECT w.date
       FROM work_days w
       LEFT JOIN work_reports r ON r.date = w.date
       WHERE w.date BETWEEN ? AND ? AND r.date IS NULL
       ORDER BY w.date DESC`
    ).bind(backlog, today).all<{ date: string }>();
    for (const row of missingReports) {
      items.push({
        id: `missing-report:${row.date}`,
        type: "report",
        title: "Chưa có báo cáo làm việc",
        message: `Ngày làm ${formatFullDate(row.date)} chưa có báo cáo làm việc.`,
        createdAt: `${row.date}T00:00:00Z`,
        actionView: "report",
        actionDate: row.date
      });
    }
  }

  return items.sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 60);
}

async function getSchedule(env: Env, url: URL, user: User): Promise<Response> {
  const month = normalizeMonth(url.searchParams.get("month"));
  const { from, to } = monthRange(month);
  const settings = await getSettings(env);
  const [
    workDays,
    sections,
    positions,
    departments,
    assignments,
    coordinators,
    coordinatorAssignments,
    rotations,
    auditLogs
  ] = await Promise.all([
    listWorkDays(env, from, to),
    listSections(env),
    listPositions(env),
    listDepartments(env),
    listAssignments(env, from, to),
    listCoordinators(env),
    listCoordinatorAssignments(env, from, to),
    listRotations(env),
    listAuditLogs(env, from, to, auditFiltersForUser(user))
  ]);

  const response: ScheduleResponse = {
    month,
    workDays,
    sections,
    positions,
    departments,
    assignments,
    coordinators,
    coordinatorAssignments,
    rotations,
    auditLogs,
    lockPersonOnWorkDay: settings.lock_person_on_workday
  };
  return json(response);
}

async function listWorkDays(env: Env, from: string, to: string): Promise<WorkDay[]> {
  const { results } = await env.DB.prepare(
    "SELECT date, session, note FROM work_days WHERE date BETWEEN ? AND ? ORDER BY date"
  ).bind(from, to).all<WorkDayRow>();
  return results.map(mapWorkDayRow);
}

async function listAssignments(env: Env, from: string, to: string): Promise<Assignment[]> {
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.position_id, a.date, a.department_id, d.name AS department_name,
            a.person_name, a.person_phone, a.member_order, a.updated_at
     FROM assignments a
     JOIN departments d ON d.id = a.department_id
     WHERE a.date BETWEEN ? AND ?
     ORDER BY a.date, a.position_id, a.member_order, d.sort_order, d.name`
  ).bind(from, to).all<AssignmentRow>();
  return results.map(mapAssignmentRow);
}

async function createWorkDay(request: Request, env: Env, user: User): Promise<Response> {
  requireScheduler(user);
  const body = await readJson<{ date?: string; session?: DaySession; note?: string }>(request);
  const date = String(body.date || "").slice(0, 10);
  const session = body.session;
  if (!isIsoDate(date)) throw new HttpError(400, "Ngày làm không hợp lệ.");
  if (!isDaySession(session)) throw new HttpError(400, "Buổi làm việc không hợp lệ.");
  const note = String(body.note || "").trim() || null;
  if (note && note.length > 300) throw new HttpError(400, "Ghi chú không được quá 300 ký tự.");

  const result = await env.DB.prepare(
    `INSERT INTO work_days (date, session, note, created_by) VALUES (?, ?, ?, ?)
     ON CONFLICT (date) DO NOTHING`
  ).bind(date, session, note, user.id).run();
  if ((result.meta.changes || 0) === 0) throw new HttpError(409, `Ngày ${formatFullDate(date)} đã có trong lịch làm việc.`);

  await audit(env, user.id, "create", "work_day", null, `Thêm ngày làm ${formatFullDate(date)} (${sessionLabel(session)})`);
  return json({ ok: true }, 201);
}

async function updateWorkDay(request: Request, env: Env, user: User, date: string): Promise<Response> {
  requireScheduler(user);
  if (!isIsoDate(date)) throw new HttpError(400, "Ngày làm không hợp lệ.");
  const body = await readJson<{ session?: DaySession; note?: string | null }>(request);
  const current = await env.DB.prepare("SELECT date, session, note FROM work_days WHERE date = ?")
    .bind(date)
    .first<WorkDayRow>();
  if (!current) throw new HttpError(404, "Không tìm thấy ngày làm.");

  const session = body.session === undefined ? current.session : body.session;
  if (!isDaySession(session)) throw new HttpError(400, "Buổi làm việc không hợp lệ.");
  const note = body.note === undefined ? current.note : (String(body.note || "").trim() || null);
  if (note && note.length > 300) throw new HttpError(400, "Ghi chú không được quá 300 ký tự.");

  await env.DB.prepare("UPDATE work_days SET session = ?, note = ?, updated_at = CURRENT_TIMESTAMP WHERE date = ?")
    .bind(session, note, date)
    .run();
  await audit(env, user.id, "update", "work_day", null, `Sửa ngày làm ${formatFullDate(date)} (${sessionLabel(session)})`);
  return json({ ok: true });
}

async function deleteWorkDay(env: Env, user: User, date: string): Promise<Response> {
  requireScheduler(user);
  if (!isIsoDate(date)) throw new HttpError(400, "Ngày làm không hợp lệ.");
  const result = await env.DB.prepare("DELETE FROM work_days WHERE date = ?").bind(date).run();
  if ((result.meta.changes || 0) === 0) throw new HttpError(404, "Không tìm thấy ngày làm.");
  await audit(env, user.id, "delete", "work_day", null, `Xóa ngày làm ${formatFullDate(date)}`);
  return json({ ok: true });
}

async function putAssignment(request: Request, env: Env, user: User): Promise<Response> {
  requireScheduler(user);
  const body = await readJson<{
    positionId?: number;
    date?: string;
    departmentId?: number;
    personName?: string;
    personPhone?: string;
  }>(request);
  const date = String(body.date || "").slice(0, 10);
  const positionId = Number(body.positionId || 0);
  const departmentId = Number(body.departmentId || 0);
  if (!isIsoDate(date) || !positionId || !departmentId) {
    throw new HttpError(400, "Thiếu vị trí khám, ngày làm hoặc khoa phòng.");
  }

  const [position, department, workDays, assignments] = await Promise.all([
    getPositionById(env, positionId),
    getDepartmentById(env, departmentId),
    listWorkDays(env, date, date),
    listAssignments(env, date, date)
  ]);
  const message = validateAssignmentInput({
    position,
    department,
    date,
    workDayDates: workDays.map((workDay) => workDay.date),
    assignments
  });
  if (message) throw new HttpError(400, message);

  const personName = String(body.personName || "").trim();
  const personPhone = normalizePhone(body.personPhone);
  const memberOrder = assignments.filter((assignment) => assignment.positionId === positionId).length;

  const result = await env.DB.prepare(
    `INSERT INTO assignments (position_id, date, department_id, person_name, person_phone, member_order, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(positionId, date, departmentId, personName, personPhone, memberOrder, user.id, user.id).run();
  await audit(
    env,
    user.id,
    "create",
    "assignment",
    result.meta.last_row_id,
    `Phân công ${department.name} vào ${position.label} ngày ${formatFullDate(date)}`
  );
  return json({ ok: true }, 201);
}

async function updateAssignmentPerson(request: Request, env: Env, user: User, id: number): Promise<Response> {
  const body = await readJson<{ personName?: string; personPhone?: string }>(request);
  const message = validatePersonInput({ personName: body.personName, personPhone: body.personPhone });
  if (message) throw new HttpError(400, message);

  const current = await env.DB.prepare(
    `SELECT a.id, a.date, a.department_id, d.name AS department_name, a.person_name
     FROM assignments a JOIN departments d ON d.id = a.department_id WHERE a.id = ?`
  ).bind(id).first<{ id: number; date: string; department_id: number; department_name: string; person_name: string }>();
  if (!current) throw new HttpError(404, "Không tìm thấy phân công.");

  const settings = await getSettings(env);
  const today = todayInVietnam();
  if (!canManageSchedule(user.role)) {
    if (user.departmentId !== current.department_id) {
      throw new HttpError(403, "Chỉ khoa phòng được phân công mới được điền người làm việc.");
    }
    if (!canEditPersonOnDate(current.date, today, settings.lock_person_on_workday)) {
      throw new HttpError(403, `Ngày ${formatFullDate(current.date)} đã qua nên không sửa được người làm việc.`);
    }
  }

  const personName = String(body.personName || "").trim();
  const personPhone = normalizePhone(body.personPhone);
  const update = assignmentPersonUpdate({
    assignmentId: id,
    role: user.role,
    departmentId: user.departmentId,
    userId: user.id,
    personName,
    personPhone,
    today,
    lockOnWorkDay: settings.lock_person_on_workday
  });
  const result = await env.DB.prepare(update.sql).bind(...update.bindings).run();
  if ((result.meta.changes || 0) !== 1) throw new HttpError(409, "Không cập nhật được người làm việc. Vui lòng tải lại.");

  const action = current.person_name.trim() ? "update_person" : "fill_person";
  await audit(
    env,
    user.id,
    action,
    "assignment",
    id,
    `${current.department_name} ngày ${formatFullDate(current.date)}: ${personName} - ${personPhone}`
  );
  return json({ ok: true });
}

async function moveAssignment(request: Request, env: Env, user: User, id: number): Promise<Response> {
  requireScheduler(user);
  const body = await readJson<{ date?: string; positionId?: number }>(request);
  const date = String(body.date || "").slice(0, 10);
  if (!isIsoDate(date)) throw new HttpError(400, "Thiếu ngày làm đích.");

  const current = await env.DB.prepare(
    `SELECT a.id, a.position_id, a.date, a.department_id, d.name AS department_name, p.label AS position_label
     FROM assignments a
     JOIN departments d ON d.id = a.department_id
     JOIN positions p ON p.id = a.position_id
     WHERE a.id = ?`
  ).bind(id).first<{
    id: number;
    position_id: number;
    date: string;
    department_id: number;
    department_name: string;
    position_label: string;
  }>();
  if (!current) throw new HttpError(404, "Không tìm thấy phân công.");

  const positionId = Number(body.positionId || current.position_id);
  if (current.date === date && positionId === current.position_id) return json({ ok: true });

  const [position, department, workDays, assignments] = await Promise.all([
    getPositionById(env, positionId),
    getDepartmentById(env, current.department_id),
    listWorkDays(env, date, date),
    listAssignments(env, date, date)
  ]);
  const message = validateAssignmentInput({
    position,
    department,
    date,
    workDayDates: workDays.map((workDay) => workDay.date),
    assignments,
    replacingAssignmentId: id
  });
  if (message) throw new HttpError(400, message);

  await env.DB.prepare(
    "UPDATE assignments SET date = ?, position_id = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).bind(date, positionId, user.id, id).run();
  await audit(
    env,
    user.id,
    "move",
    "assignment",
    id,
    `Chuyển ${current.department_name}: ${current.position_label} ${formatFullDate(current.date)} sang ${position.label} ${formatFullDate(date)}`
  );
  return json({ ok: true });
}

async function deleteAssignment(env: Env, user: User, id: number): Promise<Response> {
  requireScheduler(user);
  const current = await env.DB.prepare(
    `SELECT a.date, d.name AS department_name, p.label AS position_label
     FROM assignments a
     JOIN departments d ON d.id = a.department_id
     JOIN positions p ON p.id = a.position_id
     WHERE a.id = ?`
  ).bind(id).first<{ date: string; department_name: string; position_label: string }>();
  if (!current) throw new HttpError(404, "Không tìm thấy phân công.");
  await env.DB.prepare("DELETE FROM assignments WHERE id = ?").bind(id).run();
  await audit(
    env,
    user.id,
    "delete",
    "assignment",
    id,
    `Xóa phân công ${current.department_name} ở ${current.position_label} ngày ${formatFullDate(current.date)}`
  );
  return json({ ok: true });
}

export function clearScheduleStatement(scope: "month" | "date", value: string): { sql: string; bindings: string[] } {
  return scope === "date"
    ? { sql: "DELETE FROM assignments WHERE date = ?", bindings: [value] }
    : { sql: "DELETE FROM assignments WHERE date BETWEEN ? AND ?", bindings: [monthRange(value).from, monthRange(value).to] };
}

async function clearSchedule(request: Request, env: Env, user: User): Promise<Response> {
  requireScheduler(user);
  const body = await readJson<{ month?: string; date?: string }>(request);
  const scope: "month" | "date" = body.date ? "date" : "month";
  const value = scope === "date" ? String(body.date).slice(0, 10) : normalizeMonth(body.month);
  if (scope === "date" && !isIsoDate(value)) throw new HttpError(400, "Ngày cần xóa không hợp lệ.");

  const statement = clearScheduleStatement(scope, value);
  const result = await env.DB.prepare(statement.sql).bind(...statement.bindings).run();
  await audit(
    env,
    user.id,
    "delete",
    "assignment",
    null,
    scope === "date"
      ? `Xóa toàn bộ phân công ngày ${formatFullDate(value)}`
      : `Xóa toàn bộ phân công tháng ${value}`
  );
  return json({ ok: true, deleted: result.meta.changes || 0 });
}

async function listCoordinators(env: Env): Promise<User[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, username, role, department_id, full_name, NULL AS department_name, signature
     FROM users WHERE role = 'dieu_phoi' AND disabled = 0 ORDER BY full_name, username`
  ).all<UserRow>();
  return results.map(mapUserRow).map(publicUser);
}

async function listCoordinatorAssignments(env: Env, from: string, to: string): Promise<CoordinatorAssignment[]> {
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.date, c.user_id, u.username, u.full_name
     FROM coordinator_assignments c
     JOIN users u ON u.id = c.user_id
     WHERE c.date BETWEEN ? AND ?
     ORDER BY c.date, c.member_order, u.full_name, u.username`
  ).bind(from, to).all<CoordinatorAssignmentRow>();
  return results.map(mapCoordinatorAssignmentRow);
}

async function getCoordinatorAssignment(env: Env, id: number): Promise<CoordinatorAssignment> {
  const row = await env.DB.prepare(
    `SELECT c.id, c.date, c.user_id, u.username, u.full_name
     FROM coordinator_assignments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`
  ).bind(id).first<CoordinatorAssignmentRow>();
  if (!row) throw new HttpError(404, "Không tìm thấy phân công điều phối.");
  return mapCoordinatorAssignmentRow(row);
}

async function assertCoordinatorFree(env: Env, userId: number, date: string, exceptId?: number): Promise<void> {
  const lookup = exceptId === undefined
    ? { sql: "SELECT id FROM coordinator_assignments WHERE user_id = ? AND date = ?", bindings: [userId, date] }
    : {
        sql: "SELECT id FROM coordinator_assignments WHERE user_id = ? AND date = ? AND id <> ?",
        bindings: [userId, date, exceptId]
      };
  const existing = await env.DB.prepare(lookup.sql).bind(...lookup.bindings).first();
  if (existing) throw new HttpError(409, `Điều phối này đã có mặt trong ngày ${formatFullDate(date)}.`);
}

async function putCoordinatorAssignment(request: Request, env: Env, user: User): Promise<Response> {
  requireAdmin(user);
  const body = await readJson<{ date?: string; userId?: number }>(request);
  const date = String(body.date || "").slice(0, 10);
  const userId = Number(body.userId || 0);
  if (!isIsoDate(date) || !userId) throw new HttpError(400, "Thiếu ngày làm hoặc điều phối.");

  const workDay = await env.DB.prepare("SELECT date FROM work_days WHERE date = ?").bind(date).first();
  if (!workDay) throw new HttpError(400, "Ngày này chưa được mở làm việc. Hãy thêm ngày làm trước.");

  const coordinator = await env.DB.prepare(
    "SELECT id, username, full_name FROM users WHERE id = ? AND role = 'dieu_phoi' AND disabled = 0"
  ).bind(userId).first<{ id: number; username: string; full_name: string | null }>();
  if (!coordinator) throw new HttpError(404, "Không tìm thấy tài khoản điều phối.");
  await assertCoordinatorFree(env, userId, date);

  const existingCount = await env.DB.prepare(
    "SELECT COUNT(*) AS value FROM coordinator_assignments WHERE date = ?"
  ).bind(date).first<{ value: number }>();

  const result = await env.DB.prepare(
    `INSERT INTO coordinator_assignments (date, user_id, member_order, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(date, userId, Number(existingCount?.value || 0), user.id, user.id).run();
  await audit(
    env,
    user.id,
    "create",
    "coordinator_assignment",
    result.meta.last_row_id,
    `Xếp điều phối ${coordinator.full_name || coordinator.username} ngày ${formatFullDate(date)}`
  );
  return json({ ok: true }, 201);
}

async function deleteCoordinatorAssignment(env: Env, user: User, id: number): Promise<Response> {
  requireAdmin(user);
  const current = await getCoordinatorAssignment(env, id);
  await env.DB.prepare("DELETE FROM coordinator_assignments WHERE id = ?").bind(id).run();
  await audit(
    env,
    user.id,
    "delete",
    "coordinator_assignment",
    id,
    `Bỏ điều phối ${current.fullName || current.username} ngày ${formatFullDate(current.date)}`
  );
  return json({ ok: true });
}

async function moveCoordinatorAssignment(request: Request, env: Env, user: User, id: number): Promise<Response> {
  requireAdmin(user);
  const body = await readJson<{ date?: string }>(request);
  const date = String(body.date || "").slice(0, 10);
  if (!isIsoDate(date)) throw new HttpError(400, "Thiếu ngày làm đích.");

  const current = await getCoordinatorAssignment(env, id);
  if (current.date === date) return json({ ok: true });
  const workDay = await env.DB.prepare("SELECT date FROM work_days WHERE date = ?").bind(date).first();
  if (!workDay) throw new HttpError(400, "Ngày này chưa được mở làm việc.");
  await assertCoordinatorFree(env, current.userId, date, id);

  await env.DB.prepare(
    "UPDATE coordinator_assignments SET date = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).bind(date, user.id, id).run();
  await audit(
    env,
    user.id,
    "move_coordinator",
    "coordinator_assignment",
    id,
    `Chuyển điều phối ${current.fullName || current.username} từ ${formatFullDate(current.date)} sang ${formatFullDate(date)}`
  );
  return json({ ok: true });
}

const SWAP_EXPIRY_DAYS = 7;

async function requestCoordinatorSwap(request: Request, env: Env, user: User): Promise<Response> {
  const body = await readJson<{ assignmentId?: number; targetAssignmentId?: number }>(request);
  const assignmentId = Number(body.assignmentId || 0);
  const targetAssignmentId = Number(body.targetAssignmentId || 0);
  if (!assignmentId || !targetAssignmentId) throw new HttpError(400, "Thiếu ngày làm cần đổi.");

  const [source, target] = await Promise.all([
    getCoordinatorAssignment(env, assignmentId),
    getCoordinatorAssignment(env, targetAssignmentId)
  ]);
  const today = todayInVietnam();

  // Admin xếp lịch trực tiếp, không cần đối phương đồng ý.
  if (user.role === "admin") {
    await performSwap(env, user, source, target);
    return json({ ok: true });
  }
  if (user.role !== "dieu_phoi") throw new HttpError(403, "Chỉ điều phối được xin đổi ngày làm.");

  const message = validateCoordinatorSwap({
    source: { id: source.id, userId: source.userId, date: source.date },
    target: { id: target.id, userId: target.userId, date: target.date },
    requesterUserId: user.id,
    today
  });
  if (message) throw new HttpError(400, message);

  const duplicate = await env.DB.prepare(
    `SELECT id FROM swap_requests
     WHERE status = 'pending' AND (assignment_id_1 IN (?, ?) OR assignment_id_2 IN (?, ?))`
  ).bind(source.id, target.id, source.id, target.id).first();
  if (duplicate) throw new HttpError(409, "Đã có yêu cầu đổi ngày đang chờ duyệt cho một trong hai ngày này.");

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SWAP_EXPIRY_DAYS * 86400000).toISOString();
  await env.DB.prepare(
    `INSERT INTO swap_requests
       (token, status, assignment_id_1, user_id_1, date_1, assignment_id_2, user_id_2, date_2, created_by, expires_at)
     VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(token, source.id, source.userId, source.date, target.id, target.userId, target.date, user.id, expiresAt).run();

  await audit(
    env,
    user.id,
    "request_swap",
    "swap_request",
    null,
    `Xin đổi ngày làm ${formatFullDate(source.date)} với ${target.fullName || target.username} ngày ${formatFullDate(target.date)}`
  );
  return json({ ok: true, pending: true, token }, 201);
}

interface SwapRow {
  id: number;
  token: string;
  status: SwapRequest["status"];
  assignment_id_1: number;
  user_id_1: number;
  name_1: string;
  date_1: string;
  assignment_id_2: number;
  user_id_2: number;
  name_2: string;
  date_2: string;
  created_at: string;
  expires_at: string | null;
}

async function loadSwapRequest(env: Env, token: string): Promise<SwapRow> {
  if (!token) throw new HttpError(400, "Thiếu mã yêu cầu đổi ngày.");
  const row = await env.DB.prepare(
    `SELECT s.id, s.token, s.status, s.assignment_id_1, s.user_id_1,
            COALESCE(NULLIF(TRIM(u1.full_name), ''), u1.username) AS name_1, s.date_1,
            s.assignment_id_2, s.user_id_2,
            COALESCE(NULLIF(TRIM(u2.full_name), ''), u2.username) AS name_2, s.date_2,
            s.created_at, s.expires_at
     FROM swap_requests s
     JOIN users u1 ON u1.id = s.user_id_1
     JOIN users u2 ON u2.id = s.user_id_2
     WHERE s.token = ?`
  ).bind(token).first<SwapRow>();
  if (!row) throw new HttpError(404, "Không tìm thấy yêu cầu đổi ngày làm.");
  return row;
}

function mapSwapRow(row: SwapRow): SwapRequest {
  return {
    id: row.id,
    token: row.token,
    status: row.status,
    assignmentId1: row.assignment_id_1,
    userId1: row.user_id_1,
    name1: row.name_1,
    date1: row.date_1,
    assignmentId2: row.assignment_id_2,
    userId2: row.user_id_2,
    name2: row.name_2,
    date2: row.date_2,
    createdAt: row.created_at,
    expiresAt: row.expires_at
  };
}

async function getSwapRequestEndpoint(env: Env, url: URL, user: User): Promise<Response> {
  const row = await loadSwapRequest(env, url.searchParams.get("token") || "");
  if (user.role !== "admin" && user.id !== row.user_id_1 && user.id !== row.user_id_2) {
    throw new HttpError(403, "Bạn không liên quan đến yêu cầu đổi ngày làm này.");
  }
  return json({ swap: mapSwapRow(row) });
}

function assertSwapRecipient(row: SwapRow, user: User): void {
  if (row.status !== "pending") throw new HttpError(409, "Yêu cầu đổi ngày làm này đã được xử lý.");
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    throw new HttpError(409, "Yêu cầu đổi ngày làm đã hết hạn.");
  }
  if (user.role !== "admin" && user.id !== row.user_id_2) {
    throw new HttpError(403, "Chỉ điều phối được yêu cầu đổi mới có thể trả lời.");
  }
}

/** Đổi chỗ hai ngày làm của hai điều phối. */
async function performSwap(
  env: Env,
  user: User,
  source: CoordinatorAssignment,
  target: CoordinatorAssignment
): Promise<void> {
  await assertCoordinatorFree(env, source.userId, target.date, source.id);
  await assertCoordinatorFree(env, target.userId, source.date, target.id);
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE coordinator_assignments SET date = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(target.date, user.id, source.id),
    env.DB.prepare(
      "UPDATE coordinator_assignments SET date = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(source.date, user.id, target.id)
  ]);
  await audit(
    env,
    user.id,
    "accept_swap",
    "coordinator_assignment",
    source.id,
    `Đổi ngày làm: ${source.fullName || source.username} ${formatFullDate(source.date)} ↔ ${target.fullName || target.username} ${formatFullDate(target.date)}`
  );
}

async function acceptSwapEndpoint(env: Env, url: URL, user: User): Promise<Response> {
  const row = await loadSwapRequest(env, url.searchParams.get("token") || "");
  assertSwapRecipient(row, user);

  const [source, target] = await Promise.all([
    getCoordinatorAssignment(env, row.assignment_id_1),
    getCoordinatorAssignment(env, row.assignment_id_2)
  ]);
  if (source.date !== row.date_1 || target.date !== row.date_2) {
    throw new HttpError(409, "Lịch đã thay đổi sau khi tạo yêu cầu. Vui lòng tạo yêu cầu mới.");
  }

  const claimed = await env.DB.prepare(
    `UPDATE swap_requests SET status = 'approved', decided_at = CURRENT_TIMESTAMP, decided_by = ?
     WHERE id = ? AND status = 'pending'`
  ).bind(user.id, row.id).run();
  if ((claimed.meta.changes || 0) !== 1) throw new HttpError(409, "Yêu cầu đổi ngày làm đã được xử lý.");

  await performSwap(env, user, source, target);
  return json({ ok: true });
}

async function rejectSwapEndpoint(env: Env, url: URL, user: User): Promise<Response> {
  const row = await loadSwapRequest(env, url.searchParams.get("token") || "");
  assertSwapRecipient(row, user);
  const updated = await env.DB.prepare(
    `UPDATE swap_requests SET status = 'rejected', decided_at = CURRENT_TIMESTAMP, decided_by = ?
     WHERE id = ? AND status = 'pending'`
  ).bind(user.id, row.id).run();
  if ((updated.meta.changes || 0) !== 1) throw new HttpError(409, "Yêu cầu đổi ngày làm đã được xử lý.");
  await audit(
    env,
    user.id,
    "reject_swap",
    "swap_request",
    row.id,
    `Từ chối đổi ngày làm ${formatFullDate(row.date_1)} ↔ ${formatFullDate(row.date_2)}`
  );
  return json({ ok: true });
}

/** Tua của mọi vị trí khám. Mỗi vị trí có ngày bắt đầu và danh sách tua riêng. */
async function listRotations(env: Env): Promise<Rotation[]> {
  const [configs, members] = await Promise.all([
    env.DB.prepare("SELECT position_id, start_date, enabled FROM rotations")
      .all<{ position_id: number; start_date: string; enabled: number }>(),
    env.DB.prepare(
      `SELECT m.position_id, m.turn_index, m.member_order, m.department_id, d.name AS department_name
       FROM rotation_members m
       JOIN departments d ON d.id = m.department_id
       ORDER BY m.position_id, m.turn_index, m.member_order`
    ).all<{
      position_id: number;
      turn_index: number;
      member_order: number;
      department_id: number;
      department_name: string;
    }>()
  ]);

  const turnsByPosition = new Map<number, RotationMember[][]>();
  for (const row of members.results || []) {
    const turns = turnsByPosition.get(row.position_id) || [];
    while (turns.length <= row.turn_index) turns.push([]);
    turns[row.turn_index].push({
      departmentId: row.department_id,
      departmentName: row.department_name,
      turnIndex: row.turn_index,
      memberOrder: row.member_order
    });
    turnsByPosition.set(row.position_id, turns);
  }

  return (configs.results || []).map((config) => ({
    positionId: config.position_id,
    startDate: config.start_date,
    enabled: !!config.enabled,
    turns: turnsByPosition.get(config.position_id) || []
  }));
}

async function loadRotation(env: Env, positionId: number): Promise<Rotation | null> {
  const rotations = await listRotations(env);
  return rotations.find((rotation) => rotation.positionId === positionId) || null;
}

async function saveRotation(request: Request, env: Env, user: User, positionId: number): Promise<Response> {
  requireScheduler(user);
  const position = await getPositionById(env, positionId);
  const body = await readJson<{ startDate?: string; turns?: number[][]; enabled?: boolean }>(request);
  const startDate = String(body.startDate || "").slice(0, 10);
  const turns = body.turns;
  if (!isIsoDate(startDate)) throw new HttpError(400, "Ngày bắt đầu tua không hợp lệ.");
  if (!Array.isArray(turns) || turns.length === 0 || turns.some((turn) => !Array.isArray(turn) || turn.length === 0)) {
    throw new HttpError(400, "Cần ít nhất một tua và mỗi tua có ít nhất một khoa phòng.");
  }
  if (turns.some((turn) => turn.some((departmentId) => !Number.isInteger(departmentId) || departmentId <= 0))) {
    throw new HttpError(400, "Khoa phòng trong tua không hợp lệ.");
  }
  for (const turn of turns) {
    if (new Set(turn).size !== turn.length) {
      throw new HttpError(400, "Một khoa phòng không thể xuất hiện hai lần trong cùng một tua.");
    }
  }

  const departmentIds = [...new Set(turns.flat())];
  const lookup = rotationDepartmentLookup(departmentIds);
  const { results: departmentRows } = await env.DB.prepare(lookup.sql).bind(...lookup.bindings).all<DepartmentRow>();
  const departmentsById = new Map(departmentRows.map((row) => [row.id, mapDepartmentRow(row)]));
  const missing = departmentIds.find((departmentId) => !departmentsById.has(departmentId));
  if (missing !== undefined) throw new HttpError(404, "Không tìm thấy khoa phòng trong tua.");
  const inactive = departmentIds.find((departmentId) => !departmentsById.get(departmentId)!.active);
  if (inactive !== undefined) {
    throw new HttpError(400, `${departmentsById.get(inactive)!.name} đã ngừng hoạt động, không thể đưa vào tua.`);
  }

  const membersInsert = rotationMembersInsert(positionId, turns);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO rotations (position_id, start_date, enabled, updated_by, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(position_id) DO UPDATE SET start_date = excluded.start_date, enabled = excluded.enabled,
         updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`
    ).bind(positionId, startDate, body.enabled === false ? 0 : 1, user.id),
    env.DB.prepare("DELETE FROM rotation_members WHERE position_id = ?").bind(positionId),
    env.DB.prepare(membersInsert.sql).bind(...membersInsert.bindings)
  ]);
  await audit(
    env,
    user.id,
    "save",
    "rotation",
    positionId,
    `Lưu tua ${position.label}: ${turns.length} tua, bắt đầu ${formatFullDate(startDate)}`
  );
  return json({ ok: true });
}

/**
 * Áp tua cho một vị trí, hoặc cho mọi vị trí đang bật tua khi positionId là null.
 * Chỉ thay phân công của đúng những vị trí được áp, giữ lại họ tên và số điện
 * thoại khoa phòng đã điền.
 */
async function applyRotation(
  request: Request,
  env: Env,
  user: User,
  positionId: number | null
): Promise<Response> {
  requireScheduler(user);
  const body = await readJson<{ month?: string }>(request);
  const month = normalizeMonth(body.month);
  const { from, to } = monthRange(month);

  const allRotations = await listRotations(env);
  const rotations = allRotations.filter(
    (rotation) =>
      rotation.enabled &&
      rotation.turns.some((turn) => turn.length > 0) &&
      (positionId === null || rotation.positionId === positionId)
  );
  if (rotations.length === 0) {
    throw new HttpError(400, positionId === null ? "Chưa có vị trí nào cấu hình tua." : "Vị trí này chưa cấu hình tua.");
  }

  const workDays = await listWorkDays(env, from, to);
  if (workDays.length === 0) throw new HttpError(400, `Tháng ${month} chưa có ngày làm nào.`);
  const workDayDates = workDays.map((workDay) => workDay.date);

  const existing = await listAssignments(env, from, to);
  const persons = new Map(
    existing
      .filter((assignment) => assignment.personName.trim())
      .map((assignment) => [
        `${assignment.positionId}:${assignment.date}:${assignment.departmentId}`,
        assignment
      ])
  );

  const positions = await listPositions(env);
  const statements: PostgresPreparedStatement[] = [];
  let created = 0;
  let restored = 0;

  for (const rotation of rotations) {
    const planned = rotationAssignmentsForWorkDays(workDayDates, rotation.turns, rotation.startDate);
    if (planned.length === 0) continue;
    statements.push(
      env.DB.prepare("DELETE FROM assignments WHERE position_id = ? AND date BETWEEN ? AND ?")
        .bind(rotation.positionId, from, to)
    );
    for (const item of planned) {
      const previous = persons.get(`${rotation.positionId}:${item.date}:${item.departmentId}`);
      if (previous) restored += 1;
      created += 1;
      statements.push(
        env.DB.prepare(
          `INSERT INTO assignments (position_id, date, department_id, person_name, person_phone, member_order, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          rotation.positionId,
          item.date,
          item.departmentId,
          previous?.personName || "",
          previous?.personPhone || "",
          item.memberOrder,
          user.id,
          user.id
        )
      );
    }
  }

  if (statements.length === 0) {
    throw new HttpError(400, `Không có ngày làm nào trong tháng ${month} tính từ ngày bắt đầu tua.`);
  }

  await env.DB.batch(statements);
  const scope = positionId === null
    ? `${rotations.length} vị trí`
    : positions.find((position) => position.id === positionId)?.label || "vị trí";
  await audit(
    env,
    user.id,
    "apply",
    "rotation",
    positionId,
    `Áp tua ${scope} cho tháng ${month}: ${created} phân công, giữ lại ${restored} người đã điền`
  );
  return json({ ok: true, created, restored });
}

async function getAudit(env: Env, url: URL, user: User): Promise<Response> {
  const month = normalizeMonth(url.searchParams.get("month"));
  const { from, to } = monthRange(month);
  const logs = await listAuditLogs(env, from, to, auditFiltersForUser(user, url));
  return json({ auditLogs: logs });
}

async function deleteAuditEndpoint(env: Env, url: URL, user: User): Promise<Response> {
  requireAdmin(user);
  const month = normalizeMonth(url.searchParams.get("month"));
  const { from, to } = monthRange(month);
  await env.DB.prepare("DELETE FROM audit_logs WHERE created_at >= ? AND created_at < ?")
    .bind(`${from}T00:00:00Z`, `${addDays(to, 1)}T00:00:00Z`)
    .run();
  await audit(env, user.id, "delete", "audit", null, `Xóa lịch sử thay đổi tháng ${month}`);
  return json({ ok: true });
}

function auditFiltersForUser(user: User, url?: URL): {
  actor?: string;
  action?: string;
  q?: string;
  actorUserId?: number;
} {
  if (user.role === "khoa_phong") return { actorUserId: user.id };
  return {
    actor: url?.searchParams.get("actor") || undefined,
    action: url?.searchParams.get("action") || undefined,
    q: url?.searchParams.get("q") || undefined
  };
}

async function listAuditLogs(
  env: Env,
  from: string,
  to: string,
  filters: { actor?: string; action?: string; q?: string; actorUserId?: number }
): Promise<AuditLog[]> {
  const conditions = ["a.created_at >= ?", "a.created_at < ?"];
  const bindings: unknown[] = [`${from}T00:00:00Z`, `${addDays(to, 1)}T00:00:00Z`];

  if (filters.actorUserId !== undefined) {
    conditions.push("a.actor_user_id = ?");
    bindings.push(filters.actorUserId);
  }
  if (filters.actor) {
    conditions.push("lower(u.username) LIKE lower(?)");
    bindings.push(`%${filters.actor}%`);
  }
  if (filters.action) {
    const actions = getAuditActionValues(filters.action);
    conditions.push(`a.action IN (${actions.map(() => "?").join(", ")})`);
    bindings.push(...actions);
  }
  if (filters.q) {
    conditions.push("lower(a.summary) LIKE lower(?)");
    bindings.push(`%${filters.q}%`);
  }

  const { results } = await env.DB.prepare(
    `SELECT a.id, u.username AS actor_username, a.action, a.entity_type, a.entity_id, a.summary, a.created_at
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.actor_user_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT 300`
  ).bind(...bindings).all<AuditRow>();
  return results.map(mapAuditRow);
}

async function audit(
  env: Env,
  actorUserId: number | null,
  action: string,
  entityType: string,
  entityId: number | null,
  summary: string,
  payload: string | null = null
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, summary, payload) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(actorUserId, action, entityType, entityId, summary, payload).run();
}

async function getDepartmentById(env: Env, id: number): Promise<Department> {
  const row = await env.DB.prepare("SELECT id, name, active, sort_order FROM departments WHERE id = ?")
    .bind(id)
    .first<DepartmentRow>();
  if (!row) throw new HttpError(404, "Không tìm thấy khoa phòng.");
  return mapDepartmentRow(row);
}

async function getSettingsEndpoint(env: Env, user: User): Promise<Response> {
  requireAdmin(user);
  return json(await getSettings(env));
}

async function saveSettingsEndpoint(request: Request, env: Env, user: User): Promise<Response> {
  requireAdmin(user);
  const body = await readJson<Partial<SystemSettings>>(request);
  const statements: PostgresPreparedStatement[] = [];
  const upsert = (key: string, value: boolean) =>
    env.DB.prepare(
      "INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value"
    ).bind(key, value ? "1" : "0");

  if (body.lock_person_on_workday !== undefined) {
    statements.push(upsert("lock_person_on_workday", body.lock_person_on_workday));
  }
  if (statements.length) await env.DB.batch(statements);
  await audit(env, user.id, "update", "settings", null, "Cập nhật cấu hình hệ thống");
  return json(await getSettings(env));
}

async function getSettings(env: Env): Promise<SystemSettings> {
  const { results } = await env.DB.prepare("SELECT key, value FROM system_settings").all<{ key: string; value: string }>();
  const map = new Map((results || []).map((row) => [row.key, row.value]));
  return {
    lock_person_on_workday: map.get("lock_person_on_workday") === "1"
  };
}

async function getReportEndpoint(env: Env, url: URL, user: User): Promise<Response> {
  const date = url.searchParams.get("date") || "";
  if (!isIsoDate(date)) throw new HttpError(400, "Thiếu ngày làm việc.");

  const workDay = await env.DB.prepare("SELECT date, session, note FROM work_days WHERE date = ?")
    .bind(date)
    .first<WorkDayRow>();
  if (!workDay) throw new HttpError(404, `Ngày ${formatFullDate(date)} không phải ngày làm việc.`);

  const row = await env.DB.prepare("SELECT * FROM work_reports WHERE date = ?").bind(date).first<Record<string, any>>();
  const [attendance, dayCoordinators] = await Promise.all([
    listAttendance(env, date),
    listCoordinatorAssignments(env, date, date)
  ]);
  const canSign = user.role === "khoa_phong"
    ? attendance.some((entry) => entry.departmentId === user.departmentId)
    : user.role === "admin" || dayCoordinators.some((item) => item.userId === user.id);

  return json({
    report: row ? mapReportRow(row, workDay.session, attendance) : null,
    workDay: mapWorkDayRow(workDay),
    attendance,
    coordinators: dayCoordinators,
    canSign
  });
}

async function listAttendance(env: Env, date: string): Promise<AttendanceEntry[]> {
  const { results } = await env.DB.prepare(
    `SELECT a.id AS assignment_id, a.position_id, p.label AS position_label,
            a.department_id, d.name AS department_name, a.person_name, a.person_phone,
            att.present, att.note, att.signature, att.signature_name, att.signature_at
     FROM assignments a
     JOIN departments d ON d.id = a.department_id
     JOIN positions p ON p.id = a.position_id
     JOIN sections sec ON sec.id = p.section_id
     LEFT JOIN work_report_attendance att ON att.assignment_id = a.id
     WHERE a.date = ?
     ORDER BY sec.sort_order, sec.id, p.sort_order, p.id, a.member_order, d.name`
  ).bind(date).all<AttendanceRow>();
  return results.map(mapAttendanceRow);
}

async function listReportsEndpoint(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT w.date, w.session, COALESCE(r.report_time, '') AS report_time,
            COUNT(a.id) AS total_count,
            COALESCE(SUM(CASE WHEN att.present = 1 THEN 1 ELSE 0 END), 0) AS present_count
     FROM work_days w
     LEFT JOIN work_reports r ON r.date = w.date
     LEFT JOIN assignments a ON a.date = w.date
     LEFT JOIN work_report_attendance att ON att.assignment_id = a.id
     GROUP BY w.date, w.session, r.report_time
     ORDER BY w.date DESC
     LIMIT 120`
  ).all();
  return json({ reports: results });
}

async function saveReportEndpoint(request: Request, env: Env, user: User): Promise<Response> {
  requireScheduler(user);
  const body = await readJson<Partial<WorkReport>>(request);
  const date = String(body.date || "").trim();
  const reportDate = String(body.reportDate || "").trim();
  const reportTime = String(body.reportTime || "").trim();
  if (!isIsoDate(date) || !isIsoDate(reportDate) || !reportTime) {
    throw new HttpError(400, "Ngày làm, ngày báo cáo hoặc giờ báo cáo không hợp lệ.");
  }

  const workDay = await env.DB.prepare("SELECT date FROM work_days WHERE date = ?").bind(date).first();
  if (!workDay) throw new HttpError(404, `Ngày ${formatFullDate(date)} không phải ngày làm việc.`);

  const counts = [body.soLuotKham, body.soHoSo].map((value) => Number(value ?? 0));
  if (counts.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new HttpError(400, "Số liệu công việc phải là số nguyên không âm.");
  }

  const existing = await env.DB.prepare(
    "SELECT date, signature_dieu_phoi FROM work_reports WHERE date = ?"
  ).bind(date).first<{ date: string; signature_dieu_phoi: string | null }>();

  if (existing?.signature_dieu_phoi && user.role !== "admin") {
    throw new HttpError(409, "Báo cáo đã được điều phối ký chốt, chỉ quản lý mới sửa được.");
  }

  const values = [
    reportDate,
    reportTime,
    ...counts,
    String(body.vatTu || ""),
    String(body.suCo || ""),
    String(body.deXuat || "")
  ];

  if (existing) {
    const updated = await env.DB.prepare(
      `UPDATE work_reports SET report_date = ?, report_time = ?, so_luot_kham = ?, so_ho_so = ?,
         vat_tu = ?, su_co = ?, de_xuat = ?, updated_at = CURRENT_TIMESTAMP
       WHERE date = ?`
    ).bind(...values, date).run();
    if ((updated.meta.changes || 0) !== 1) {
      throw new HttpError(409, "Báo cáo vừa thay đổi. Vui lòng tải lại và lưu lại.");
    }
    await audit(env, user.id, "update", "work_report", null, `Cập nhật báo cáo làm việc ngày ${formatFullDate(date)}`);
  } else {
    await env.DB.prepare(
      `INSERT INTO work_reports (date, report_date, report_time, so_luot_kham, so_ho_so, vat_tu, su_co, de_xuat)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(date, ...values).run();
    await audit(env, user.id, "create", "work_report", null, `Tạo báo cáo làm việc ngày ${formatFullDate(date)}`);
  }

  return json({ ok: true });
}

async function saveAttendanceEndpoint(request: Request, env: Env, user: User): Promise<Response> {
  const body = await readJson<{
    assignmentId?: number;
    present?: boolean;
    note?: string;
    signature?: string;
    signerName?: string;
    useStoredSignature?: boolean;
  }>(request);
  const assignmentId = Number(body.assignmentId || 0);
  if (!assignmentId) throw new HttpError(400, "Thiếu ô phân công cần điểm danh.");

  const assignment = await env.DB.prepare(
    `SELECT a.id, a.date, a.department_id, d.name AS department_name, p.label AS position_label
     FROM assignments a
     JOIN departments d ON d.id = a.department_id
     JOIN positions p ON p.id = a.position_id
     WHERE a.id = ?`
  ).bind(assignmentId).first<{
    id: number;
    date: string;
    department_id: number;
    department_name: string;
    position_label: string;
  }>();
  if (!assignment) throw new HttpError(404, "Không tìm thấy ô phân công.");

  const date = assignment.date;
  if (!canManageSchedule(user.role) && user.departmentId !== assignment.department_id) {
    throw new HttpError(403, "Chỉ khoa phòng của mình mới được điểm danh và ký tên.");
  }

  const reportExists = await env.DB.prepare("SELECT date FROM work_reports WHERE date = ?").bind(date).first();
  if (!reportExists) throw new HttpError(409, "Điều phối cần tạo báo cáo làm việc của ngày này trước.");

  const note = String(body.note || "").trim() || null;
  const wantsSignature = body.useStoredSignature || Boolean(body.signature);
  let signature: string | null = null;
  let signerName: string | null = null;

  if (wantsSignature) {
    signature = body.useStoredSignature ? (user.signature ?? null) : (body.signature ?? null);
    if (!signature || !isSignatureDataUrl(signature)) {
      throw new HttpError(400, body.useStoredSignature ? "Tài khoản chưa có chữ ký mẫu hợp lệ." : "Chữ ký không hợp lệ.");
    }
    signerName = resolveSignerName(body.signerName, user.fullName || user.departmentName);
    if (!signerName) throw new HttpError(400, "Hãy nhập họ và tên người ký.");
    if (signerName.length > 120) throw new HttpError(400, "Họ và tên người ký không được quá 120 ký tự.");
  }

  const present = body.present === undefined ? true : Boolean(body.present);

  if (wantsSignature) {
    await env.DB.prepare(
      `INSERT INTO work_report_attendance
         (assignment_id, present, note, signature, signature_name, signature_at, signature_user_id, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(assignment_id) DO UPDATE SET
         present = excluded.present, note = excluded.note, signature = excluded.signature,
         signature_name = excluded.signature_name, signature_at = CURRENT_TIMESTAMP,
         signature_user_id = excluded.signature_user_id, updated_at = CURRENT_TIMESTAMP`
    ).bind(assignmentId, present ? 1 : 0, note, signature, signerName, user.id).run();
    await audit(
      env,
      user.id,
      "sign",
      "work_report",
      assignmentId,
      `${assignment.department_name} (${assignment.position_label}) ký báo cáo ngày ${formatFullDate(date)}: ${signerName}`
    );
  } else {
    await env.DB.prepare(
      `INSERT INTO work_report_attendance (assignment_id, present, note, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(assignment_id) DO UPDATE SET
         present = excluded.present, note = excluded.note, updated_at = CURRENT_TIMESTAMP`
    ).bind(assignmentId, present ? 1 : 0, note).run();
    await audit(
      env,
      user.id,
      "attendance",
      "work_report",
      assignmentId,
      `Điểm danh ${assignment.department_name} (${assignment.position_label}) ngày ${formatFullDate(date)}: ${present ? "có mặt" : "vắng"}`
    );
  }

  return json({ ok: true });
}

async function signReportEndpoint(request: Request, env: Env, user: User): Promise<Response> {
  const body = await readJson<{
    date?: string;
    role?: unknown;
    signature?: string;
    signerName?: string;
    useStoredSignature?: boolean;
  }>(request);
  const date = String(body.date || "").trim();
  if (!isIsoDate(date) || !isSignerRole(body.role)) {
    throw new HttpError(400, "Ngày làm việc hoặc vai trò ký không hợp lệ.");
  }
  if (body.role === "khoa_phong") {
    throw new HttpError(400, "Khoa phòng ký tên qua mục điểm danh của báo cáo.");
  }
  requireScheduler(user);

  // Điều phối chỉ ký chốt ngày mình phụ trách; admin ký thay được mọi ngày.
  if (user.role === "dieu_phoi") {
    const assigned = await env.DB.prepare(
      "SELECT id FROM coordinator_assignments WHERE date = ? AND user_id = ?"
    ).bind(date, user.id).first();
    if (!assigned) throw new HttpError(403, "Chỉ điều phối phụ trách ngày này mới được ký chốt báo cáo.");
  }

  const reportExists = await env.DB.prepare("SELECT date FROM work_reports WHERE date = ?").bind(date).first();
  if (!reportExists) throw new HttpError(409, "Hãy lưu báo cáo trước khi ký.");

  const signature = body.useStoredSignature ? user.signature : body.signature;
  if (!signature || !isSignatureDataUrl(signature)) {
    throw new HttpError(400, body.useStoredSignature ? "Tài khoản chưa có chữ ký mẫu hợp lệ." : "Chữ ký không hợp lệ.");
  }
  const name = resolveSignerName(body.signerName, user.fullName || user.username);
  if (!name) throw new HttpError(400, "Hãy nhập họ và tên người ký.");
  if (name.length > 120) throw new HttpError(400, "Họ và tên người ký không được quá 120 ký tự.");

  const signed = await env.DB.prepare(
    `UPDATE work_reports SET signature_dieu_phoi = ?, signature_dieu_phoi_user_id = ?,
       signature_dieu_phoi_name = ?, signature_dieu_phoi_at = ?, updated_at = CURRENT_TIMESTAMP
     WHERE date = ? AND signature_dieu_phoi IS NULL`
  ).bind(signature, user.id, name, new Date().toISOString(), date).run();
  if ((signed.meta.changes || 0) !== 1) throw new HttpError(409, "Báo cáo này đã được ký chốt trước đó.");

  await audit(env, user.id, "sign", "work_report", null, `Điều phối ký chốt báo cáo ngày ${formatFullDate(date)}: ${name}`);
  return json({ ok: true });
}

async function deleteReportEndpoint(env: Env, url: URL, user: User): Promise<Response> {
  requireAdmin(user);
  const date = url.searchParams.get("date") || "";
  if (!isIsoDate(date)) throw new HttpError(400, "Thiếu ngày làm việc.");

  const result = await env.DB.batch([
    env.DB.prepare("DELETE FROM work_report_attendance WHERE date = ?").bind(date),
    env.DB.prepare("DELETE FROM work_reports WHERE date = ?").bind(date)
  ]);
  if ((result[1]?.meta.changes || 0) === 0) {
    throw new HttpError(404, "Không tìm thấy báo cáo làm việc của ngày này.");
  }

  await audit(env, user.id, "delete", "work_report", null, `Xóa báo cáo làm việc ngày ${formatFullDate(date)}`);
  return json({ ok: true });
}

function idFromPath(path: string): number {
  const id = Number(path.split("/").pop());
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "ID không hợp lệ.");
  return id;
}

function dateFromPath(path: string): string {
  return (path.split("/").pop() || "").slice(0, 10);
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
    departmentId: user.departmentId,
    departmentName: user.departmentName ?? null,
    fullName: user.fullName ?? null,
    signature: user.signature ?? null,
    hasSignature: !!user.signature
  };
}

interface UserRow {
  id: number;
  username: string;
  role: Role;
  department_id: number | null;
  department_name?: string | null;
  full_name?: string | null;
  signature?: string | null;
}

interface DepartmentRow {
  id: number;
  name: string;
  active: number;
  sort_order: number;
}

interface SectionRow {
  id: number;
  label: string;
  sort_order: number;
}

interface PositionRow {
  id: number;
  section_id: number;
  label: string;
  sort_order: number;
  active: number;
}

interface WorkDayRow {
  date: string;
  session: DaySession;
  note: string | null;
}

interface AssignmentRow {
  id: number;
  position_id: number;
  date: string;
  department_id: number;
  department_name: string;
  person_name: string;
  person_phone: string;
  member_order: number;
  updated_at: string | null;
}

interface CoordinatorAssignmentRow {
  id: number;
  date: string;
  user_id: number;
  username: string;
  full_name: string | null;
}

interface AttendanceRow {
  assignment_id: number;
  position_id: number;
  position_label: string;
  department_id: number;
  department_name: string;
  person_name: string;
  person_phone: string;
  present: number | null;
  note: string | null;
  signature: string | null;
  signature_name: string | null;
  signature_at: string | null;
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

function mapUserRow(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    departmentId: row.department_id,
    departmentName: row.department_name ?? null,
    fullName: row.full_name ?? null,
    signature: row.signature ?? null
  };
}

function mapDepartmentRow(row: DepartmentRow): Department {
  return {
    id: row.id,
    name: row.name,
    active: !!row.active,
    sortOrder: row.sort_order
  };
}

function mapSectionRow(row: SectionRow): Section {
  return { id: row.id, label: row.label, sortOrder: row.sort_order };
}

function mapPositionRow(row: PositionRow): Position {
  return {
    id: row.id,
    sectionId: row.section_id,
    label: row.label,
    sortOrder: row.sort_order,
    active: !!row.active
  };
}

function mapWorkDayRow(row: WorkDayRow): WorkDay {
  return {
    date: row.date,
    session: row.session,
    note: row.note ?? null
  };
}

function mapAssignmentRow(row: AssignmentRow): Assignment {
  return {
    id: row.id,
    positionId: row.position_id,
    date: row.date,
    departmentId: row.department_id,
    departmentName: row.department_name,
    personName: row.person_name || "",
    personPhone: row.person_phone || "",
    memberOrder: row.member_order,
    updatedAt: row.updated_at
  };
}

function mapCoordinatorAssignmentRow(row: CoordinatorAssignmentRow): CoordinatorAssignment {
  return {
    id: row.id,
    date: row.date,
    userId: row.user_id,
    username: row.username,
    fullName: (row.full_name || "").trim()
  };
}

function mapAttendanceRow(row: AttendanceRow): AttendanceEntry {
  return {
    assignmentId: row.assignment_id,
    positionId: row.position_id,
    positionLabel: row.position_label,
    departmentId: row.department_id,
    departmentName: row.department_name,
    personName: row.person_name || "",
    personPhone: row.person_phone || "",
    present: !!row.present,
    note: row.note ?? null,
    signature: row.signature ?? null,
    signatureName: row.signature_name ?? null,
    signatureAt: row.signature_at ?? null
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

function mapReportRow(row: Record<string, any>, session: DaySession, attendance: AttendanceEntry[]): WorkReport {
  return {
    date: row.date,
    session,
    reportDate: row.report_date,
    reportTime: row.report_time,
    soLuotKham: row.so_luot_kham,
    soHoSo: row.so_ho_so,
    vatTu: row.vat_tu,
    suCo: row.su_co,
    deXuat: row.de_xuat,
    signatureDieuPhoi: row.signature_dieu_phoi,
    signatureDieuPhoiName: row.signature_dieu_phoi_name,
    signatureDieuPhoiAt: row.signature_dieu_phoi_at,
    attendance,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function isSignatureDataUrl(value: string): boolean {
  return value.length <= 512_000 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
}

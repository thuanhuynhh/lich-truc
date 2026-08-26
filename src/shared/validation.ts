import type { Assignment, Department, Role, SignerRole, WorkReport } from "./types";
import { canEditPersonOnDate } from "./schedule";

const PHONE_PATTERN = /^[0-9+][0-9\s.-]{7,19}$/;

export function isSignerRole(value: unknown): value is SignerRole {
  return value === "khoa_phong" || value === "dieu_phoi";
}

export function isRole(value: unknown): value is Role {
  return value === "admin" || value === "dieu_phoi" || value === "khoa_phong";
}

/** Admin và điều phối đều được lên lịch; khoa phòng thì không. */
export function canManageSchedule(role: Role): boolean {
  return role === "admin" || role === "dieu_phoi";
}

export function roleLabel(role: Role): string {
  if (role === "admin") return "Quản lý";
  if (role === "dieu_phoi") return "Điều phối";
  return "Khoa phòng";
}

export function resolveSignerName(value: unknown, fallbackName?: string | null): string {
  const submittedName = typeof value === "string" ? value.trim() : "";
  return submittedName || (fallbackName || "").trim();
}

export function normalizePhone(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

export function validatePersonInput(params: { personName: unknown; personPhone: unknown }): string | null {
  const name = typeof params.personName === "string" ? params.personName.trim() : "";
  const phone = normalizePhone(params.personPhone);
  if (!name) return "Hãy nhập họ và tên người làm việc.";
  if (name.length > 120) return "Họ và tên không được quá 120 ký tự.";
  if (!phone) return "Hãy nhập số điện thoại liên hệ.";
  if (!PHONE_PATTERN.test(phone)) return "Số điện thoại liên hệ không hợp lệ.";
  return null;
}

export function validateAssignmentInput(params: {
  department: Department;
  date: string;
  workDayDates: string[];
  assignments: Assignment[];
  replacingAssignmentId?: number | null;
}): string | null {
  if (!params.workDayDates.includes(params.date)) {
    return "Ngày này chưa được mở làm việc. Hãy thêm ngày làm trước.";
  }
  if (!params.department.active) return "Khoa phòng này đã ngừng hoạt động.";
  const duplicated = params.assignments.some(
    (assignment) =>
      assignment.date === params.date &&
      assignment.departmentId === params.department.id &&
      assignment.id !== params.replacingAssignmentId
  );
  if (duplicated) return `${params.department.name} đã có trong ngày ${params.date}.`;
  return null;
}

/**
 * Khoa phòng chỉ sửa được ô của chính mình và chỉ khi ngày làm chưa qua.
 * Admin và điều phối sửa được mọi lúc.
 */
export function canEditAssignmentPerson(params: {
  role: Role;
  userDepartmentId: number | null;
  assignment: Pick<Assignment, "date" | "departmentId">;
  today?: string;
  lockOnWorkDay?: boolean;
}): boolean {
  if (canManageSchedule(params.role)) return true;
  if (params.userDepartmentId !== params.assignment.departmentId) return false;
  return canEditPersonOnDate(params.assignment.date, params.today, params.lockOnWorkDay);
}

/**
 * Điều phối chỉ được xin đổi ngày làm với một điều phối khác, và chỉ với ngày
 * chưa qua. Admin xếp lịch trực tiếp nên không đi qua luồng này.
 */
export function validateCoordinatorSwap(params: {
  source: { id: number; userId: number; date: string };
  target: { id: number; userId: number; date: string };
  requesterUserId: number;
  today: string;
}): string | null {
  if (params.source.id === params.target.id) return "Không thể đổi với chính ngày làm đó.";
  if (params.source.userId !== params.requesterUserId) return "Chỉ được xin đổi ngày làm của chính mình.";
  if (params.target.userId === params.requesterUserId) return "Hãy chọn ngày làm của một điều phối khác.";
  if (params.source.date < params.today || params.target.date < params.today) {
    return "Chỉ đổi được ngày làm chưa qua.";
  }
  return null;
}

type ReportSignatureState = Pick<
  WorkReport,
  "signatureDieuPhoi" | "signatureDieuPhoiName" | "signatureDieuPhoiAt"
>;

export function hasCoordinatorSignature(report: ReportSignatureState | null | undefined): boolean {
  if (!report) return false;
  return Boolean(report.signatureDieuPhoi || report.signatureDieuPhoiName || report.signatureDieuPhoiAt);
}

/** Sau khi điều phối đã ký chốt thì chỉ admin còn sửa được số liệu. */
export function canEditWorkReport(role: Role, report: ReportSignatureState | null | undefined): boolean {
  if (role === "admin") return true;
  if (!canManageSchedule(role)) return false;
  return !hasCoordinatorSignature(report);
}

export function attendanceSummary(present: number, total: number): string {
  if (total === 0) return "Chưa có phân công";
  return `${present}/${total} khoa phòng có mặt`;
}

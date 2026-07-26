import type { Assignment, DutyReport, LeaveDay, Role, ScheduleUnit, Staff, StaffType } from "./types";
import { acceptsStaffTypeForUnit, staffTypesForUnit } from "./schedule";

export function isReportRole(value: unknown): value is "bs" | "ktv" | "lanhdao" {
  return value === "bs" || value === "ktv" || value === "lanhdao";
}

export function resolveReportSignerName(value: unknown, staffName?: string | null): string {
  const submittedName = typeof value === "string" ? value.trim() : "";
  return submittedName || (staffName || "").trim();
}

export function formatStaffFullName(familyMiddleName: unknown, name: unknown): string {
  return [familyMiddleName, name]
    .map((part) => typeof part === "string" ? part.trim() : "")
    .filter(Boolean)
    .join(" ");
}

type ReportSignatureState = Pick<
  DutyReport,
  | "signatureBs"
  | "signatureBsName"
  | "signatureBsAt"
  | "signatureKtv"
  | "signatureKtvName"
  | "signatureKtvAt"
  | "signatureLanhdao"
  | "signatureLanhdaoName"
  | "signatureLanhdaoAt"
>;

export function hasReportSignature(report: ReportSignatureState | null | undefined): boolean {
  if (!report) return false;
  return [
    report.signatureBs,
    report.signatureBsName,
    report.signatureBsAt,
    report.signatureKtv,
    report.signatureKtvName,
    report.signatureKtvAt,
    report.signatureLanhdao,
    report.signatureLanhdaoName,
    report.signatureLanhdaoAt
  ].some((value) => Boolean(value));
}

export function canEditDutyReport(
  _role: Role,
  _report: ReportSignatureState | null | undefined
): boolean {
  return true;
}

export function validateAssignmentInput(params: {
  unit: ScheduleUnit;
  staff: Staff;
  date: string;
  assignments: Assignment[];
  leaveDays: LeaveDay[];
  replacingAssignmentId?: number | null;
}): string | null {
  const allowedTypes = staffTypesForUnit(params.unit.type);
  if (params.unit.computed) return "Hàng này được tính tự động, không thể chỉnh trực tiếp.";
  if (!params.staff.active) return "Nhân sự này đã ngừng hoạt động.";
  if (!acceptsStaffTypeForUnit(params.unit.type, params.staff.type)) {
    return `Hàng này chỉ nhận ${allowedTypes.join("/")}.`;
  }
  const isOnLeave = params.leaveDays.some(
    (day) => day.date === params.date && day.staffId === params.staff.id
  );
  if (isOnLeave) return "Nhân sự này đang nghỉ phép trong ngày đã chọn.";
  if (params.unit.maxPerDay !== null) {
    const count = params.assignments.filter(
      (assignment) =>
        assignment.unitId === params.unit.id &&
        assignment.date === params.date &&
        assignment.id !== params.replacingAssignmentId
    ).length;
    if (count >= params.unit.maxPerDay) {
      return `${params.unit.label} tối đa ${params.unit.maxPerDay} người/ngày.`;
    }
  }
  return null;
}

export function validateLeaveInput(params: {
  staff: Staff;
  dates: string[];
  leaveDays: LeaveDay[];
  limitPerType?: number;
}): string | null {
  const limit = params.limitPerType ?? 2;
  if (!params.staff.active) return "Nhân sự này đã ngừng hoạt động.";
  if (params.dates.length === 0) return "Cần chọn ít nhất một ngày nghỉ.";
  const uniqueDates = new Set(params.dates);
  if (uniqueDates.size !== params.dates.length) return "Ngày nghỉ bị trùng.";
  for (const date of uniqueDates) {
    const blockedReason = getLeaveDateBlockReason(params.staff, date, params.leaveDays, limit);
    if (blockedReason) return blockedReason;
  }
  return null;
}

export function getLeaveDateBlockReason(
  staff: Staff,
  date: string,
  leaveDays: LeaveDay[],
  limitPerType = 2
): string | null {
  const alreadyLeave = leaveDays.some(
    (day) => day.date === date && day.staffId === staff.id
  );
  if (alreadyLeave) return `${staff.name} đã có nghỉ phép ngày ${date}.`;
  const currentCount = leaveDays.filter(
    (day) => day.date === date && day.staffType === staff.type
  ).length;
  return currentCount >= limitPerType
    ? `Ngày ${date} đã đủ ${limitPerType} ${staff.type} nghỉ phép.`
    : null;
}

export function leaveSummaryByType(leaveDays: LeaveDay[], date: string, type: StaffType): string {
  return leaveDays
    .filter((day) => day.date === date && day.staffType === type)
    .map((day) => day.staffName)
    .join(", ");
}

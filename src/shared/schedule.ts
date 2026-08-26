import type { DaySession, RotationMember } from "./types";

export const APP_TIME_ZONE = "Asia/Ho_Chi_Minh";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH_PATTERN = /^\d{4}-\d{2}$/;

export const DAY_SESSIONS: DaySession[] = ["morning", "afternoon", "full"];

export const SESSION_LABELS: Record<DaySession, string> = {
  morning: "Sáng",
  afternoon: "Chiều",
  full: "Cả buổi"
};

export const SESSION_SHORT_LABELS: Record<DaySession, string> = {
  morning: "S",
  afternoon: "C",
  full: "CB"
};

const WEEKDAY_LABELS = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];

export function isDaySession(value: unknown): value is DaySession {
  return value === "morning" || value === "afternoon" || value === "full";
}

export function sessionLabel(session: DaySession): string {
  return SESSION_LABELS[session];
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isIsoMonth(value: string): boolean {
  if (!ISO_MONTH_PATTERN.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

export function todayInVietnam(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function currentMonthInVietnam(now = new Date()): string {
  return todayInVietnam(now).slice(0, 7);
}

/** Chuẩn hóa tham số tháng về dạng YYYY-MM, mặc định là tháng hiện tại. */
export function normalizeMonth(value: string | null | undefined): string {
  if (!value) return currentMonthInVietnam();
  const trimmed = value.slice(0, 7);
  return isIsoMonth(trimmed) ? trimmed : currentMonthInVietnam();
}

export function monthRange(month: string): { from: string; to: string } {
  const normalized = normalizeMonth(month);
  const [year, monthNumber] = normalized.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    from: `${normalized}-01`,
    to: `${normalized}-${String(lastDay).padStart(2, "0")}`
  };
}

/** Thứ hai của tuần chứa ngày đã cho. */
export function normalizeWeekStart(value: string | null | undefined): string {
  const date = value && isIsoDate(value.slice(0, 10)) ? value.slice(0, 10) : todayInVietnam();
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
}

/** Bảy ngày của tuần, từ thứ hai đến chủ nhật. */
export function getWeekDays(weekStart: string): string[] {
  const start = normalizeWeekStart(weekStart);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export function weekRange(weekStart: string): { from: string; to: string } {
  const from = normalizeWeekStart(weekStart);
  return { from, to: addDays(from, 6) };
}

/** 05/09 - 11/09 · tháng 9/2026 */
export function formatWeekLabel(weekStart: string): string {
  const { from, to } = weekRange(weekStart);
  return `${formatDate(from)} - ${formatDate(to)}`;
}

/**
 * Tháng của một tuần, lấy theo thứ năm giữa tuần. Nhờ vậy tuần vắt qua hai
 * tháng được xếp vào tháng chiếm phần lớn tuần đó.
 */
export function monthOfWeek(weekStart: string): string {
  return addDays(normalizeWeekStart(weekStart), 3).slice(0, 7);
}

export function addWeeks(weekStart: string, delta: number): string {
  return addDays(normalizeWeekStart(weekStart), delta * 7);
}

export function addMonths(month: string, delta: number): string {
  const normalized = normalizeMonth(month);
  const [year, monthNumber] = normalized.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function formatMonthLabel(month: string): string {
  const normalized = normalizeMonth(month);
  return `Tháng ${Number(normalized.slice(5, 7))}/${normalized.slice(0, 4)}`;
}

/** 05/09 — nhãn ngắn dùng cho tiêu đề cột. */
export function formatDate(value: string): string {
  const parts = value.split("-");
  if (parts.length < 3) return value;
  const [, month, day] = parts;
  return `${day}/${month}`;
}

/** 05/09/2026 — nhãn đầy đủ dùng cho báo cáo. */
export function formatFullDate(value: string): string {
  const parts = value.split("-");
  if (parts.length < 3) return value;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

/** Thứ của một ngày, ghi rõ bằng chữ: "Thứ sáu", "Chủ nhật". */
export function getWeekdayLabel(value: string): string {
  const day = new Date(`${value}T00:00:00Z`).getUTCDay();
  return WEEKDAY_LABELS[day] || "";
}

/**
 * Khoa phòng chỉ được sửa họ tên và số điện thoại khi ngày làm chưa qua.
 * Mặc định ngày làm hôm nay vẫn còn sửa được; bật `lockOnWorkDay` thì phải
 * điền xong từ trước ngày làm.
 */
export function canEditPersonOnDate(
  date: string,
  today = todayInVietnam(),
  lockOnWorkDay = false
): boolean {
  return lockOnWorkDay ? date > today : date >= today;
}

/**
 * Vị trí tua của một ngày làm. Tua chạy theo thứ tự ngày làm chứ không theo
 * ngày dương lịch, vì lịch khám không liên tục.
 */
export function rotationTurnIndex(
  workDays: string[],
  date: string,
  startDate: string,
  turnCount: number
): number {
  if (turnCount <= 0) return -1;
  const eligible = workDays
    .filter((workDay) => workDay >= startDate)
    .sort((left, right) => left.localeCompare(right));
  const position = eligible.indexOf(date);
  if (position < 0) return -1;
  return position % turnCount;
}

export interface RotationAssignment {
  date: string;
  departmentId: number;
  memberOrder: number;
}

/** Sinh danh sách phân công theo tua cho các ngày làm đã cho. */
export function rotationAssignmentsForWorkDays(
  workDays: string[],
  turns: RotationMember[][],
  startDate: string
): RotationAssignment[] {
  const usableTurns = turns.filter((turn) => Array.isArray(turn) && turn.length > 0);
  if (usableTurns.length === 0) return [];

  const sortedWorkDays = [...workDays].sort((left, right) => left.localeCompare(right));
  const assignments: RotationAssignment[] = [];

  for (const date of sortedWorkDays) {
    const turnIndex = rotationTurnIndex(sortedWorkDays, date, startDate, usableTurns.length);
    if (turnIndex < 0) continue;
    for (const [memberOrder, member] of usableTurns[turnIndex].entries()) {
      assignments.push({ date, departmentId: member.departmentId, memberOrder });
    }
  }

  return assignments;
}

export function parseTimestamp(value?: string | null): Date | null {
  if (!value) return null;
  let normalized = value.trim().replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(normalized)) normalized += "Z";
  if (/[+-]\d{2}$/.test(normalized)) normalized += ":00";
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatVietnamDateTime(value?: string | null): string {
  const date = parseTimestamp(value);
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("vi-VN", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("day")}/${part("month")}/${part("year")} ${part("hour")}:${part("minute")}`;
}

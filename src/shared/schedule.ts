import type { ScheduleUnit, StaffType, UnitKind, UnitRotation } from "./types";

export const DAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"] as const;
export const APP_TIME_ZONE = "Asia/Ho_Chi_Minh";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface SeedUnit {
  code: string;
  section: "I" | "II" | "III";
  label: string;
  type: UnitKind;
  maxPerDay: number | null;
  sortOrder: number;
  computed: boolean;
}

export const SCHEDULE_UNITS: SeedUnit[] = [
  { code: "duty_common", section: "I", label: "LỊCH TRỰC CHUNG", type: "duty_common", maxPerDay: null, sortOrder: 10, computed: true },
  { code: "duty_bs", section: "I", label: "LỊCH TRỰC BÁC SĨ", type: "duty_bs", maxPerDay: 1, sortOrder: 20, computed: false },
  { code: "duty_ktv", section: "I", label: "LỊCH TRỰC KỸ THUẬT VIÊN", type: "duty_ktv", maxPerDay: 2, sortOrder: 30, computed: false },
  { code: "leave", section: "I", label: "NGHỈ PHÉP", type: "leave", maxPerDay: null, sortOrder: 40, computed: true },
  { code: "xq1", section: "II", label: "X QUANG 1", type: "work_bs", maxPerDay: null, sortOrder: 110, computed: false },
  { code: "xq2", section: "II", label: "X QUANG 2", type: "work_bs", maxPerDay: null, sortOrder: 120, computed: false },
  { code: "ct64_128", section: "II", label: "CT 64+128", type: "work_bs", maxPerDay: null, sortOrder: 130, computed: false },
  { code: "ct512", section: "II", label: "CT 512", type: "work_bs", maxPerDay: null, sortOrder: 140, computed: false },
  { code: "mri1", section: "II", label: "MRI 1", type: "work_bs", maxPerDay: null, sortOrder: 150, computed: false },
  { code: "mri2", section: "II", label: "MRI 2", type: "work_bs", maxPerDay: null, sortOrder: 160, computed: false },
  { code: "xqdv", section: "II", label: "X QUANG DV", type: "work_bs", maxPerDay: null, sortOrder: 170, computed: false },
  { code: "ktv_mri", section: "III", label: "PHÒNG MRI 1", type: "work_ktv", maxPerDay: null, sortOrder: 210, computed: false },
  { code: "ktv_tai_giuong", section: "III", label: "TẠI GIƯỜNG", type: "work_ktv", maxPerDay: null, sortOrder: 220, computed: false },
  { code: "ktv_ct1", section: "III", label: "PHÒNG CT 1", type: "work_ktv", maxPerDay: null, sortOrder: 230, computed: false },
  { code: "ktv_ct2", section: "III", label: "PHÒNG CT 2", type: "work_ktv", maxPerDay: null, sortOrder: 240, computed: false },
  { code: "ktv_thay1", section: "III", label: "THAY RA TRỰC 1", type: "work_ktv", maxPerDay: null, sortOrder: 250, computed: false },
  { code: "ktv_thay2", section: "III", label: "THAY RA TRỰC 2", type: "work_ktv", maxPerDay: null, sortOrder: 260, computed: false },
  { code: "ktv_rang", section: "III", label: "RĂNG KTC", type: "work_ktv", maxPerDay: null, sortOrder: 270, computed: false },
  { code: "ktv_phong4", section: "III", label: "PHÒNG 4", type: "work_ktv", maxPerDay: null, sortOrder: 280, computed: false },
  { code: "ktv_mri2", section: "III", label: "PHÒNG MRI 2", type: "work_ktv", maxPerDay: null, sortOrder: 290, computed: false },
  { code: "ktv_phong3", section: "III", label: "PHÒNG 3", type: "work_ktv", maxPerDay: null, sortOrder: 300, computed: false },
  { code: "ktv_lx_nhu_anh_tiep_nhan", section: "III", label: "PHÒNG LX + X-QUANG NHŨ ẢNH", type: "work_ktv", maxPerDay: null, sortOrder: 310, computed: false },
  { code: "ktv_nhu_anh", section: "III", label: "X-QUANG NHŨ ẢNH", type: "work_ktv", maxPerDay: null, sortOrder: 320, computed: false },
  { code: "ktv_xqdv", section: "III", label: "PHÒNG X-QUANG DỊCH VỤ", type: "work_ktv", maxPerDay: null, sortOrder: 330, computed: false },
  { code: "ktv_ct3_nhu_anh", section: "III", label: "PHÒNG CT 3", type: "work_ktv", maxPerDay: null, sortOrder: 340, computed: false },
  { code: "ktv_dsa_carm", section: "III", label: "DSA & C-ARM", type: "work_ktv", maxPerDay: null, sortOrder: 350, computed: false },
  { code: "ktv_huong_dan", section: "III", label: "TIẾP NHẬN & HƯỚNG DẪN BN CHỤP X-QUANG TẠI KHOA", type: "work_ktv", maxPerDay: null, sortOrder: 360, computed: false },
  { code: "ktv_huong_dan_mri_ct", section: "III", label: "TIẾP NHẬN & HƯỚNG DẪN BN CHỤP MRI & CT", type: "work_ktv", maxPerDay: null, sortOrder: 370, computed: false }
];

export function staffTypeForUnit(type: UnitKind): StaffType | null {
  if (type === "duty_bs" || type === "work_bs") return "BS";
  if (type === "duty_ktv" || type === "work_ktv") return "KTV";
  return null;
}

export function staffTypesForUnit(type: UnitKind): StaffType[] {
  if (type === "duty_bs" || type === "work_bs") return ["BS"];
  if (type === "duty_ktv") return ["KTV"];
  if (type === "work_ktv") return ["KTV", "TKYK"];
  return [];
}

export function acceptsStaffTypeForUnit(type: UnitKind, staffType: StaffType): boolean {
  const allowedTypes = staffTypesForUnit(type);
  return allowedTypes.length === 0 || allowedTypes.includes(staffType);
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function getMonday(input = new Date()): Date {
  const date = new Date(input);
  date.setUTCHours(0, 0, 0, 0);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date;
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function postDutyOffDate(dutyDate: string): string {
  const dutyDay = new Date(`${dutyDate}T00:00:00Z`).getUTCDay();
  if (dutyDay === 5 || dutyDay === 6) return addDays(dutyDate, -1);
  return addDays(dutyDate, 1);
}

export function conflictsWithDutyLeave(dutyDate: string, leaveDate: string): boolean {
  return dutyDate === leaveDate || postDutyOffDate(dutyDate) === leaveDate;
}

export function formatLeaveRegistrationDateTime(value?: string | null): string {
  if (!value) return "";
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
  return `${Number(part("hour"))}h${part("minute")} ngày ${part("day")}/${part("month")}/${part("year")}`;
}

export function shouldSyncPostDutyOffDate(dutyDate: string, today: string): boolean {
  return postDutyOffDate(dutyDate) >= today;
}

export function rotationTurnIndex(
  startDate: string,
  date: string,
  mode: UnitRotation["mode"],
  turnCount: number
): number {
  if (turnCount <= 0) return -1;
  const start = new Date(`${startDate}T00:00:00Z`);
  const current = new Date(`${date}T00:00:00Z`);
  const delta = Math.round((current.getTime() - start.getTime()) / 86400000);
  const step = mode === "weekly" ? Math.floor(delta / 7) : delta;
  return ((step % turnCount) + turnCount) % turnCount;
}

export function workRotationAssignmentsForStaff(
  units: ScheduleUnit[],
  rotations: UnitRotation[],
  staffId: number,
  date: string
): Array<{ unitId: number; slot: number }> {
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  const assignments: Array<{ unitId: number; slot: number }> = [];

  for (const rotation of rotations) {
    const unit = unitsById.get(rotation.unitId);
    const turns = rotation.turns.filter((turn) => Array.isArray(turn) && turn.length > 0);
    if (!rotation.enabled || !unit || (unit.type !== "work_bs" && unit.type !== "work_ktv") || turns.length === 0) continue;

    const turnIndex = rotationTurnIndex(rotation.startDate, date, rotation.mode, turns.length);
    const slot = turns[turnIndex].findIndex((member) => member.staffId === staffId);
    if (slot >= 0) assignments.push({ unitId: unit.id, slot });
  }

  return assignments;
}

export function getWeekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

export function normalizeWeekStart(value: string | null | undefined): string {
  const date = value && isIsoDate(value) ? value : todayInVietnam();
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
}

export function getDayOfWeekLabel(value: string): string {
  const day = new Date(`${value}T00:00:00Z`).getUTCDay();
  if (day === 0) return "chủ nhật";
  return `thứ ${day + 1}`;
}

export function formatDate(value: string): string {
  const parts = value.split("-");
  if (parts.length < 3) return value;
  const [, month, day] = parts;
  return `${day}/${month}`;
}

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
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

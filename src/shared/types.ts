export type Role = "admin" | "bs" | "ktv" | "tkyk";
export type StaffType = "BS" | "KTV" | "TKYK";
export type UnitKind = "duty_common" | "duty_bs" | "duty_ktv" | "leave" | "work_bs" | "work_ktv";
export type RotationMode = "daily" | "weekly";

export interface User {
  id: number;
  username: string;
  role: Role;
  staffId: number | null;
  staffName?: string | null;
  staffFullName?: string | null;
  signature?: string | null;
  hasSignature?: boolean;
}

export interface Staff {
  id: number;
  familyMiddleName: string;
  name: string;
  type: StaffType;
  active: boolean;
}

export interface ScheduleUnit {
  id: number;
  code: string;
  section: "I" | "II" | "III";
  label: string;
  type: UnitKind;
  maxPerDay: number | null;
  sortOrder: number;
  computed: boolean;
}

export interface Assignment {
  id: number;
  unitId: number;
  unitCode: string;
  date: string;
  staffId: number;
  staffName: string;
  staffType: StaffType;
  slot: number;
}

export interface LeaveDay {
  id: number;
  requestId: number;
  date: string;
  staffId: number;
  staffName: string;
  staffType: StaffType;
  reason: string | null;
  registeredAt?: string | null;
}

export interface AuditLog {
  id: number;
  actorUsername: string | null;
  action: string;
  entityType: string;
  entityId: number | null;
  summary: string;
  createdAt: string;
}

export interface RotationMember {
  staffId: number;
  staffName: string;
  staffType: StaffType;
  turnIndex: number;
  memberOrder: number;
}

export interface UnitRotation {
  unitId: number;
  startDate: string;
  mode: RotationMode;
  enabled: boolean;
  turns: RotationMember[][];
}

export interface ScheduleResponse {
  weekStart: string;
  days: string[];
  units: ScheduleUnit[];
  staff: Staff[];
  assignments: Assignment[];
  leaveDays: LeaveDay[];
  nextWeekLeaveDays?: LeaveDay[];
  monthLeaveDays?: LeaveDay[];
  rotations: UnitRotation[];
  pendingLeaves?: PendingLeave[];
  approveLeaveBs?: boolean;
  approveLeaveKtv?: boolean;
  approveSwap?: boolean;
  showStaffRail?: boolean;
  showLeaveMonthCalendar?: boolean;
}

export interface LoginResponse {
  user: User;
}

export interface ApiError {
  error: string;
}

export interface SystemSettings {
  approve_leave_bs: boolean;
  approve_leave_ktv: boolean;
  approve_swap: boolean;
  show_staff_rail: boolean;
  show_leave_month_calendar: boolean;
}

export interface SettingsResponse extends SystemSettings {
  blocked_dates: string[];
}

export interface PendingLeave {
  id: number; // request_id
  staffId: number;
  staffName: string;
  staffType: StaffType;
  reason: string | null;
  registeredAt?: string;
  dates: string[];
}

export interface SwapRequest {
  id: number;
  token: string;
  assignmentId1: number;
  staffId1: number;
  staffName1: string;
  unitLabel1: string;
  date1: string;
  slot1: number;
  assignmentId2: number;
  staffId2: number;
  staffName2: string;
  unitLabel2: string;
  date2: string;
  slot2: number;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

export interface MoveAssignmentResponse {
  ok?: boolean;
  pending?: boolean;
  token?: string;
  message?: string;
}

export interface DutyReport {
  date: string;
  reportDate: string;
  reportTime: string;
  bsTruc: string;
  ktvTruc: string;
  xqKhoa: number;
  xqGiuong: number;
  mri: number;
  ctScan: number;
  thuocSuDung: string;
  caKho: string;
  thietBi: string;
  anNinh: string;
  signatureBs: string | null;
  signatureBsName: string | null;
  signatureBsAt: string | null;
  signatureKtv: string | null;
  signatureKtvName: string | null;
  signatureKtvAt: string | null;
  signatureLanhdao: string | null;
  signatureLanhdaoName: string | null;
  signatureLanhdaoAt: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface DutyReportSummary {
  date: string;
  report_date: string;
  report_time: string;
  bs_truc: string | null;
  ktv_truc: string | null;
}

export type NotificationType = "swap" | "leave" | "report";

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  actionView?: "schedule" | "leave" | "report";
  actionDate?: string;
  swapToken?: string;
}

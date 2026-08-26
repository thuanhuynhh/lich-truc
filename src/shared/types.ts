export type Role = "admin" | "dieu_phoi" | "khoa_phong";
export type DaySession = "morning" | "afternoon" | "full";
export type SignerRole = "khoa_phong" | "dieu_phoi";

export interface User {
  id: number;
  username: string;
  role: Role;
  departmentId: number | null;
  departmentName?: string | null;
  fullName?: string | null;
  signature?: string | null;
  hasSignature?: boolean;
}

export interface Department {
  id: number;
  name: string;
  active: boolean;
  sortOrder: number;
}

/** Mục của bảng lịch, ví dụ "I. KHÁM LÂM SÀNG". */
export interface Section {
  id: number;
  label: string;
  sortOrder: number;
}

/** Vị trí khám: một hàng của bảng lịch, có cấu hình tua riêng. */
export interface Position {
  id: number;
  sectionId: number;
  label: string;
  sortOrder: number;
  active: boolean;
}

export interface WorkDay {
  date: string;
  session: DaySession;
  note: string | null;
  /** Chỉ có ở danh sách ngày làm theo tháng dùng cho trang quản lý. */
  assignmentCount?: number;
}

export interface Assignment {
  id: number;
  positionId: number;
  date: string;
  departmentId: number;
  departmentName: string;
  personName: string;
  personPhone: string;
  memberOrder: number;
  updatedAt?: string | null;
}

/** Ô của hàng điều phối: điều phối nào phụ trách ngày làm nào. */
export interface CoordinatorAssignment {
  id: number;
  date: string;
  userId: number;
  username: string;
  fullName: string;
}

export interface SwapRequest {
  id: number;
  token: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  assignmentId1: number;
  userId1: number;
  name1: string;
  date1: string;
  assignmentId2: number;
  userId2: number;
  name2: string;
  date2: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface SwapResponse {
  ok?: boolean;
  pending?: boolean;
  token?: string;
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
  departmentId: number;
  departmentName: string;
  turnIndex: number;
  memberOrder: number;
}

export interface Rotation {
  positionId: number;
  startDate: string;
  enabled: boolean;
  turns: RotationMember[][];
}

export interface ScheduleResponse {
  /** Thứ hai của tuần đang xem. */
  weekStart: string;
  /** Tháng chứa tuần đang xem, dùng cho trang quản lý ngày làm. */
  month: string;
  /** Ngày làm trong tuần đang xem, mỗi ngày là một cột của bảng lịch. */
  workDays: WorkDay[];
  /** Toàn bộ ngày làm của tháng, dùng cho trang quản lý ngày làm. */
  monthWorkDays: WorkDay[];
  sections: Section[];
  positions: Position[];
  departments: Department[];
  assignments: Assignment[];
  coordinators: User[];
  coordinatorAssignments: CoordinatorAssignment[];
  rotations: Rotation[];
  auditLogs: AuditLog[];
  lockPersonOnWorkDay?: boolean;
}

export interface LoginResponse {
  user: User;
}

export interface ApiError {
  error: string;
}

export interface SystemSettings {
  lock_person_on_workday: boolean;
}

export interface SettingsResponse extends SystemSettings {}

export interface AttendanceEntry {
  assignmentId: number;
  positionId: number;
  positionLabel: string;
  departmentId: number;
  departmentName: string;
  personName: string;
  personPhone: string;
  present: boolean;
  note: string | null;
  signature: string | null;
  signatureName: string | null;
  signatureAt: string | null;
}

export interface WorkReport {
  date: string;
  session: DaySession;
  reportDate: string;
  reportTime: string;
  soLuotKham: number;
  soHoSo: number;
  vatTu: string;
  suCo: string;
  deXuat: string;
  signatureDieuPhoi: string | null;
  signatureDieuPhoiName: string | null;
  signatureDieuPhoiAt: string | null;
  attendance: AttendanceEntry[];
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkReportSummary {
  date: string;
  session: DaySession;
  report_time: string;
  present_count: number;
  total_count: number;
}

export type NotificationType = "assignment" | "person" | "report" | "swap";

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  actionView?: "schedule" | "report";
  actionDate?: string;
  swapToken?: string;
}

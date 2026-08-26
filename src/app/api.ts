import type {
  AttendanceEntry,
  AuditLog,
  CoordinatorAssignment,
  DaySession,
  Department,
  LoginResponse,
  NotificationItem,
  Position,
  Role,
  Rotation,
  ScheduleResponse,
  Section,
  SettingsResponse,
  SwapRequest,
  SwapResponse,
  SystemSettings,
  User,
  WorkDay,
  WorkReport,
  WorkReportSummary
} from "../shared/types";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {})
    },
    ...init
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error || "Yêu cầu thất bại.");
  return data as T;
}

export const api = {
  me: () => request<LoginResponse>("/api/auth/me"),
  login: (username: string, password: string) =>
    request<LoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  updateProfile: (body: { currentPassword?: string; newPassword?: string; signature?: string | null; fullName?: string }) =>
    request<LoginResponse>("/api/profile", {
      method: "PATCH",
      body: JSON.stringify(body)
    }),

  notifications: () => request<{ notifications: NotificationItem[] }>("/api/notifications"),
  markNotificationRead: (notificationId: string) =>
    request<{ notifications: NotificationItem[] }>("/api/notifications/read", {
      method: "POST",
      body: JSON.stringify({ notificationId })
    }),
  markAllNotificationsRead: () =>
    request<{ notifications: NotificationItem[] }>("/api/notifications/read", {
      method: "POST",
      body: JSON.stringify({ all: true })
    }),

  schedule: (weekStart: string) => request<ScheduleResponse>(`/api/schedule?weekStart=${weekStart}`),

  departments: () => request<{ departments: Department[] }>("/api/departments"),
  createDepartment: (body: { name: string }) =>
    request<{ departments: Department[] }>("/api/departments", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  updateDepartment: (id: number, body: Partial<{ name: string; active: boolean; sortOrder: number }>) =>
    request<{ departments: Department[] }>(`/api/departments/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  deleteDepartment: (id: number) =>
    request<{ departments: Department[] }>(`/api/departments/${id}`, { method: "DELETE" }),

  sections: () => request<{ sections: Section[] }>("/api/sections"),
  createSection: (body: { label: string }) =>
    request<{ sections: Section[] }>("/api/sections", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  updateSection: (id: number, body: Partial<{ label: string; sortOrder: number }>) =>
    request<{ sections: Section[] }>(`/api/sections/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  deleteSection: (id: number) => request<{ sections: Section[] }>(`/api/sections/${id}`, { method: "DELETE" }),

  positions: () => request<{ positions: Position[] }>("/api/positions"),
  createPosition: (body: { sectionId: number; label: string }) =>
    request<{ positions: Position[] }>("/api/positions", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  updatePosition: (
    id: number,
    body: Partial<{ label: string; sectionId: number; sortOrder: number; active: boolean }>
  ) =>
    request<{ positions: Position[] }>(`/api/positions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  deletePosition: (id: number) => request<{ positions: Position[] }>(`/api/positions/${id}`, { method: "DELETE" }),

  createWorkDay: (body: { date: string; session: DaySession; note?: string }) =>
    request<{ ok: boolean }>("/api/work-days", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  updateWorkDay: (date: string, body: { session?: DaySession; note?: string | null }) =>
    request<{ ok: boolean }>(`/api/work-days/${date}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  deleteWorkDay: (date: string) => request<{ ok: boolean }>(`/api/work-days/${date}`, { method: "DELETE" }),

  putAssignment: (body: {
    positionId: number;
    date: string;
    departmentId: number;
    personName?: string;
    personPhone?: string;
  }) =>
    request<{ ok: boolean }>("/api/schedule/assignment", {
      method: "PUT",
      body: JSON.stringify(body)
    }),
  updateAssignmentPerson: (id: number, body: { personName: string; personPhone: string }) =>
    request<{ ok: boolean }>(`/api/schedule/assignment/${id}/person`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  moveAssignment: (id: number, body: { date: string; positionId?: number }) =>
    request<{ ok: boolean }>(`/api/schedule/assignment/${id}/move`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  deleteAssignment: (id: number) =>
    request<{ ok: boolean }>(`/api/schedule/assignment/${id}`, { method: "DELETE" }),
  clearSchedule: (body: { from?: string; to?: string; date?: string }) =>
    request<{ ok: boolean; deleted: number }>("/api/schedule/clear", {
      method: "POST",
      body: JSON.stringify(body)
    }),

  putCoordinatorAssignment: (body: { date: string; userId: number }) =>
    request<{ ok: boolean }>("/api/coordinator-assignment", {
      method: "PUT",
      body: JSON.stringify(body)
    }),
  deleteCoordinatorAssignment: (id: number) =>
    request<{ ok: boolean }>(`/api/coordinator-assignment/${id}`, { method: "DELETE" }),
  moveCoordinatorAssignment: (id: number, body: { date: string }) =>
    request<{ ok: boolean }>(`/api/coordinator-assignment/${id}/move`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  requestCoordinatorSwap: (body: { assignmentId: number; targetAssignmentId: number }) =>
    request<SwapResponse>("/api/coordinator-swap", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  getCoordinatorSwap: (token: string) =>
    request<{ swap: SwapRequest }>(`/api/coordinator-swap?token=${encodeURIComponent(token)}`),
  acceptCoordinatorSwap: (token: string) =>
    request<{ ok: boolean }>(`/api/coordinator-swap/accept?token=${encodeURIComponent(token)}`, { method: "POST" }),
  rejectCoordinatorSwap: (token: string) =>
    request<{ ok: boolean }>(`/api/coordinator-swap/reject?token=${encodeURIComponent(token)}`, { method: "POST" }),

  rotations: () => request<{ rotations: Rotation[] }>("/api/rotations"),
  saveRotation: (positionId: number, body: { startDate: string; turns: number[][]; enabled?: boolean }) =>
    request<{ ok: boolean }>(`/api/rotations/${positionId}`, {
      method: "PUT",
      body: JSON.stringify(body)
    }),
  applyRotation: (positionId: number | null, body: { from: string; to: string }) =>
    request<{ ok: boolean; created: number; restored: number }>(
      positionId === null ? "/api/rotations/apply" : `/api/rotations/${positionId}/apply`,
      { method: "POST", body: JSON.stringify(body) }
    ),

  users: () => request<{ users: User[] }>("/api/users"),
  createUser: (body: {
    username: string;
    password: string;
    role: Role;
    departmentId?: number | null;
    fullName?: string;
    signature?: string | null;
  }) =>
    request<{ users: User[] }>("/api/users", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  updateUser: (
    id: number,
    body: Partial<{
      username: string;
      password: string;
      role: Role;
      departmentId: number | null;
      fullName: string;
      signature: string | null;
    }>
  ) =>
    request<{ users: User[] }>(`/api/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  deleteUser: (id: number) => request<{ users: User[] }>(`/api/users/${id}`, { method: "DELETE" }),

  audit: (weekStart: string, filters: { actor?: string; action?: string; q?: string } = {}) => {
    const params = new URLSearchParams({ weekStart });
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return request<{ auditLogs: AuditLog[] }>(`/api/audit?${params.toString()}`);
  },
  clearAudit: (weekStart: string) =>
    request<{ ok: boolean }>(`/api/audit?weekStart=${weekStart}`, { method: "DELETE" }),

  getSettings: () => request<SettingsResponse>("/api/settings"),
  saveSettings: (body: Partial<SystemSettings>) =>
    request<SettingsResponse>("/api/settings", {
      method: "POST",
      body: JSON.stringify(body)
    }),

  getReport: (date: string) =>
    request<{
      report: WorkReport | null;
      workDay: WorkDay;
      attendance: AttendanceEntry[];
      coordinators: CoordinatorAssignment[];
      canSign: boolean;
    }>(`/api/reports?date=${date}`),
  listReports: () => request<{ reports: WorkReportSummary[] }>("/api/reports/list"),
  saveReport: (body: {
    date: string;
    reportDate: string;
    reportTime: string;
    soLuotKham: number;
    soHoSo: number;
    vatTu: string;
    suCo: string;
    deXuat: string;
  }) =>
    request<{ ok: boolean }>("/api/reports", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  deleteReport: (date: string) => request<{ ok: boolean }>(`/api/reports?date=${date}`, { method: "DELETE" }),
  saveAttendance: (body: {
    assignmentId: number;
    present?: boolean;
    note?: string;
    signature?: string;
    signerName?: string;
    useStoredSignature?: boolean;
  }) =>
    request<{ ok: boolean }>("/api/reports/attendance", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  signReport: (body: {
    date: string;
    role: "dieu_phoi";
    signature?: string;
    signerName: string;
    useStoredSignature?: boolean;
  }) =>
    request<{ ok: boolean }>("/api/reports/sign", {
      method: "POST",
      body: JSON.stringify(body)
    })
};

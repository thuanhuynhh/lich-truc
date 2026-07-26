import type { AuditLog, LeaveDay, LoginResponse, MoveAssignmentResponse, NotificationItem, Role, RotationMode, ScheduleResponse, Staff, StaffType, User, SettingsResponse, SystemSettings, SwapRequest, DutyReport, DutyReportSummary, ScheduleUnit } from "../shared/types";

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
  updateProfile: (body: { currentPassword?: string; newPassword?: string; signature?: string | null }) =>
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
  putAssignment: (body: { unitId: number; date: string; staffId: number; slot?: number }) =>
    request<{ ok: boolean }>("/api/schedule/assignment", {
      method: "PUT",
      body: JSON.stringify(body)
    }),
  deleteAssignment: (id: number) =>
    request<{ ok: boolean }>(`/api/schedule/assignment/${id}`, { method: "DELETE" }),
  moveAssignment: (id: number, body: { unitId: number; date: string; slot?: number }) =>
    request<MoveAssignmentResponse>(`/api/schedule/assignment/${id}/move`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  confirmSchedule: (weekStart: string) =>
    request<{ ok: boolean }>("/api/schedule/confirm", {
      method: "POST",
      body: JSON.stringify({ weekStart })
    }),
  clearSchedule: (body: { weekStart: string; scope: "duty_bs" | "duty_ktv" | "work_bs" | "work_ktv" | "all" | "month_all" }) =>
    request<{ ok: boolean }>("/api/schedule/clear", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  recalculateWork: (weekStart: string) =>
    request<{ ok: boolean; deleted: number; restored: number }>("/api/schedule/recalculate-work", {
      method: "POST",
      body: JSON.stringify({ weekStart })
    }),
  createLeave: (body: { staffId?: number; dates: string[]; reason?: string }) =>
    request<{ ok: boolean }>("/api/leave", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  leaveMonth: (month: string) =>
    request<{ month: string; leaveDays: LeaveDay[] }>(`/api/leave/month?month=${encodeURIComponent(month)}`),
  cancelLeave: (requestId: number) => request<{ ok: boolean }>(`/api/leave/${requestId}`, { method: "DELETE" }),
  cancelLeaveDay: (leaveDayId: number) => request<{ ok: boolean }>(`/api/leave-day/${leaveDayId}`, { method: "DELETE" }),
  createStaff: (body: { familyMiddleName: string; name: string; type: StaffType }) =>
    request<{ staff: Staff[] }>("/api/staff", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  updateStaff: (id: number, body: Partial<{ familyMiddleName: string; name: string; type: StaffType; active: boolean }>) =>
    request<{ staff: Staff[] }>(`/api/staff/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  deleteStaff: (id: number) => request<{ staff: Staff[] }>(`/api/staff/${id}`, { method: "DELETE" }),
  createUser: (body: { username: string; password: string; role: Role; staffId?: number | null; signature?: string | null }) =>
    request<{ users: User[] }>("/api/users", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  updateUser: (id: number, body: Partial<{ username: string; password: string; role: Role; staffId: number | null; signature: string | null }>) =>
    request<{ users: User[] }>(`/api/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  deleteUser: (id: number) => request<{ users: User[] }>(`/api/users/${id}`, { method: "DELETE" }),
  users: () => request<{ users: User[] }>("/api/users"),
  audit: (weekStart: string, filters: { actor?: string; action?: string; q?: string } = {}) => {
    const params = new URLSearchParams({ weekStart });
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return request<{ auditLogs: AuditLog[] }>(`/api/audit?${params.toString()}`);
  },
  clearAudit: (weekStart: string) =>
    request<{ ok: boolean }>(`/api/audit?weekStart=${weekStart}`, { method: "DELETE" }),
  saveRotation: (unitId: number, body: { startDate: string; mode: RotationMode; turns: number[][] }) =>
    request<{ ok: boolean }>(`/api/rotations/${unitId}`, {
      method: "PUT",
      body: JSON.stringify(body)
    }),
  applyRotation: (unitId: number, body: { weekStart: string; weeks?: number }) =>
    request<{ ok: boolean }>(`/api/rotations/${unitId}/apply`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  reorderUnits: (unitIds: number[]) =>
    request<{ ok: boolean }>("/api/units/reorder", {
      method: "POST",
      body: JSON.stringify({ unitIds })
    }),
  createUnit: (body: { label: string; type: "work_bs" | "work_ktv" }) =>
    request<{ ok: boolean; unit: ScheduleUnit }>("/api/units", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  updateUnit: (id: number, body: { label: string }) =>
    request<{ ok: boolean }>(`/api/units/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  deleteUnit: (id: number) =>
    request<{ ok: boolean }>(`/api/units/${id}`, {
      method: "DELETE"
    }),
  getSettings: () => request<SettingsResponse>("/api/settings"),
  saveSettings: (body: Partial<SystemSettings>) =>
    request<{ ok: boolean }>("/api/settings", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  addBlockedDate: (date: string) =>
    request<{ ok: boolean }>("/api/settings/blocked-days", {
      method: "POST",
      body: JSON.stringify({ date })
    }),
  deleteBlockedDate: (date: string) =>
    request<{ ok: boolean }>(`/api/settings/blocked-days/${date}`, { method: "DELETE" }),
  approveLeave: (id: number) =>
    request<{ ok: boolean }>(`/api/leave/${id}/approve`, { method: "POST" }),
  rejectLeave: (id: number) =>
    request<{ ok: boolean }>(`/api/leave/${id}/reject`, { method: "POST" }),
  getSwapRequest: (token: string) =>
    request<SwapRequest>(`/api/swap/request?token=${token}`),
  acceptSwap: (token: string) =>
    request<{ ok: boolean }>(`/api/swap/accept?token=${token}`, { method: "POST" }),
  rejectSwap: (token: string) =>
    request<{ ok: boolean }>(`/api/swap/reject?token=${token}`, { method: "POST" }),
  getReport: (date: string) =>
    request<{ report: DutyReport | null; scheduledBs: string[]; scheduledKtv: string[] }>(`/api/reports?date=${date}`),
  listReports: () =>
    request<{ reports: DutyReportSummary[] }>("/api/reports/list"),
  saveReport: (body: Omit<DutyReport, "signatureBs" | "signatureBsName" | "signatureBsAt" | "signatureKtv" | "signatureKtvName" | "signatureKtvAt" | "signatureLanhdao" | "signatureLanhdaoName" | "signatureLanhdaoAt">) =>
    request<{ ok: boolean }>("/api/reports", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  deleteReport: (date: string) =>
    request<{ ok: boolean }>(`/api/reports?date=${date}`, { method: "DELETE" }),
  signReport: (body: { date: string; role: "bs" | "ktv" | "lanhdao"; signature?: string; signerName: string; useStoredSignature?: boolean }) =>
    request<{ ok: boolean }>("/api/reports/sign", {
      method: "POST",
      body: JSON.stringify(body)
    })
};

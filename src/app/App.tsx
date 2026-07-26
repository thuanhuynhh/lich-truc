import {
  AlertCircle,
  ArrowLeftRight,
  Bell,
  Calendar,
  CalendarCheck,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  FileSpreadsheet,
  LogOut,
  KeyRound,
  PenLine,
  Plus,
  RefreshCw,
  Save,
  Shield,
  Trash2,
  Users
} from "lucide-react";
import { FormEvent, MutableRefObject, ReactNode, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { SignaturePad } from "./SignaturePad";
import { ReportView } from "./ReportView";
import type { Assignment, LeaveDay, NotificationItem, PendingLeave, Role, ScheduleResponse, ScheduleUnit, Staff, StaffType, SystemSettings, User, DutyReport } from "../shared/types";
import { addDays, APP_TIME_ZONE, DAYS, getWeekDays, normalizeWeekStart, staffTypesForUnit, getDayOfWeekLabel, formatDate, formatLeaveRegistrationDateTime, formatVietnamDateTime, parseTimestamp, todayInVietnam } from "../shared/schedule";
import { getLeaveDateBlockReason } from "../shared/validation";

type View = "schedule" | "leave" | "staff" | "users" | "history" | "settings" | "profile" | "report";

const SECTION_LABELS: Record<string, string> = {
  I: "I. LỊCH TRỰC KHOA",
  II: "II. LỊCH LÀM VIỆC BS",
  III: "III. LỊCH LÀM VIỆC KTV"
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loginError, setLoginError] = useState("");
  const [loading, setLoading] = useState(true);
  const [weekStart, setWeekStart] = useState(() => normalizeWeekStart(todayInVietnam()));
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [view, setView] = useState<View>("schedule");
  const [toast, setToast] = useState("");
  const [draggedStaffId, setDraggedStaffId] = useState<number | null>(null);
  const [draggedAssignmentId, setDraggedAssignmentId] = useState<number | null>(null);
  const [draggedRowId, setDraggedRowId] = useState<number | null>(null);
  const [rotationUnit, setRotationUnit] = useState<ScheduleUnit | null>(null);
  const [swapTarget, setSwapTarget] = useState<Assignment | null>(null);
  const [clearMenuOpen, setClearMenuOpen] = useState(false);
  const [updateMenuOpen, setUpdateMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [reportNavigation, setReportNavigation] = useState<{ date: string; requestId: number } | null>(null);
  const [showLunar, setShowLunar] = useState(false);
  const tableRef = useRef<HTMLDivElement | null>(null);
  const refreshSequence = useRef(0);
  const currentWeekRef = useRef(weekStart);
  const currentUserRef = useRef<User | null>(user);
  currentWeekRef.current = weekStart;
  currentUserRef.current = user;

  const [swapToken, setSwapToken] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("swapToken");
  });
  const [pendingSwapLink, setPendingSwapLink] = useState<string | null>(null);
  const [pendingSwapTarget, setPendingSwapTarget] = useState<{ name: string; type: string } | null>(null);

  const isAdmin = user?.role === "admin";

  useEffect(() => {
    api
      .me()
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refreshSequence.current += 1;
    setData(null);
    if (user) {
      void refresh(weekStart, user.id).catch((error) => {
        notify(error instanceof Error ? error.message : "Không thể tải lịch.");
      });
    }
  }, [user, weekStart]);

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      return;
    }
    void refreshNotifications();
    const interval = window.setInterval(() => void refreshNotifications(false), 60_000);
    return () => window.clearInterval(interval);
  }, [user?.id]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  async function run(action: () => Promise<void>, ok?: string): Promise<boolean> {
    try {
      await action();
      if (ok) notify(ok);
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "Có lỗi xảy ra.");
      return false;
    }
  }

  async function refreshNotifications(showLoading = true) {
    if (!currentUserRef.current) return;
    if (showLoading) setNotificationsLoading(true);
    try {
      const response = await api.notifications();
      if (currentUserRef.current) setNotifications(response.notifications);
    } catch {
      // Notification refresh must not interrupt the schedule workflow.
    } finally {
      if (showLoading) setNotificationsLoading(false);
    }
  }

  async function refresh(targetWeek = weekStart, targetUserId = user?.id) {
    const sequence = ++refreshSequence.current;
    const response = await api.schedule(targetWeek);
    if (
      sequence === refreshSequence.current &&
      targetWeek === currentWeekRef.current &&
      targetUserId === currentUserRef.current?.id
    ) {
      setData(response);
    }
  }

  function clearUserScopedState() {
    refreshSequence.current += 1;
    setData(null);
    setView("schedule");
    setDraggedStaffId(null);
    setDraggedAssignmentId(null);
    setDraggedRowId(null);
    setRotationUnit(null);
    setSwapTarget(null);
    setPendingSwapLink(null);
    setPendingSwapTarget(null);
    setClearMenuOpen(false);
    setUpdateMenuOpen(false);
    setNotifications([]);
    setNotificationsOpen(false);
    setReportNavigation(null);
  }

  function clearSchedule(scope: "duty_bs" | "duty_ktv" | "work_bs" | "work_ktv" | "all" | "month_all", label: string) {
    setClearMenuOpen(false);
    const rangeLabel = scope === "month_all" ? formatMonthLabel(weekStart) : formatWeekLabel(weekStart);
    if (!window.confirm(`Xóa ${label} của ${rangeLabel}?`)) return;
    void run(() => api.clearSchedule({ weekStart, scope }).then(() => refresh()), `Đã xóa ${label}`);
  }

  function recalculateWork() {
    setUpdateMenuOpen(false);
    void run(async () => {
      const result = await api.recalculateWork(weekStart);
      await refresh();
      notify(`Đã cập nhật lịch làm việc: bỏ ${result.deleted} phân công ngày ra trực, khôi phục ${result.restored} phân công theo tua`);
    });
  }

  if (loading) {
    return <div className="boot">Đang tải ứng dụng...</div>;
  }

  if (!user) {
    return (
      <LoginScreen
        error={loginError}
        onSubmit={async (username, password) => {
          setLoginError("");
          try {
            const res = await api.login(username, password);
            clearUserScopedState();
            setUser(res.user);
          } catch (error) {
            setLoginError(error instanceof Error ? error.message : "Đăng nhập thất bại.");
          }
        }}
      />
    );
  }

  if (swapToken) {
    return (
      <SwapAcceptScreen
        token={swapToken}
        onDone={() => {
          setSwapToken(null);
          const url = new URL(window.location.href);
          url.searchParams.delete("swapToken");
          window.history.replaceState({}, document.title, url.pathname + url.search);
          void refresh();
        }}
      />
    );
  }

  const staff = data?.staff ?? [];
  const activeStaff = staff.filter((item) => item.active);
  const bsStaff = activeStaff.filter((item) => item.type === "BS");
  const ktvStaff = activeStaff.filter((item) => item.type === "KTV" || item.type === "TKYK");

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-top">
          <div className="brand">
            <img
            <div>
              <h1>LỊCH LÀM VIỆC KHOA</h1>
              <p>Khoa Chẩn Đoán Hình Ảnh</p>
            </div>
          </div>
          <div className="user-actions">
            <button
              type="button"
              className="avatar-btn"
              title={user.username}
              onClick={() =>
                void run(async () => {
                  await api.logout();
                  clearUserScopedState();
                  setUser(null);
                })
              }
            >
              <LogOut size={16} /> <span className="avatar-name">{user.username}</span>
            </button>
            <NotificationMenu
              items={notifications}
              open={notificationsOpen}
              loading={notificationsLoading}
              onToggle={() => {
                const nextOpen = !notificationsOpen;
                setNotificationsOpen(nextOpen);
                if (nextOpen) void refreshNotifications();
              }}
              onClose={() => setNotificationsOpen(false)}
              onMarkRead={async (item) => {
                setNotificationsLoading(true);
                try {
                  const response = await api.markNotificationRead(item.id);
                  setNotifications(response.notifications);
                } catch (error) {
                  notify(error instanceof Error ? error.message : "Không đánh dấu được thông báo.");
                } finally {
                  setNotificationsLoading(false);
                }
              }}
              onMarkAllRead={async () => {
                setNotificationsLoading(true);
                try {
                  const response = await api.markAllNotificationsRead();
                  setNotifications(response.notifications);
                } catch (error) {
                  notify(error instanceof Error ? error.message : "Không đánh dấu được thông báo.");
                } finally {
                  setNotificationsLoading(false);
                }
              }}
              onAcceptSwap={async (item) => {
                if (!item.swapToken) return;
                setNotificationsLoading(true);
                try {
                  await api.acceptSwap(item.swapToken);
                  await Promise.all([refreshNotifications(false), refresh()]);
                  notify("Đã đồng ý đổi trực");
                } catch (error) {
                  notify(error instanceof Error ? error.message : "Đồng ý đổi trực thất bại.");
                } finally {
                  setNotificationsLoading(false);
                }
              }}
              onRejectSwap={async (item) => {
                if (!item.swapToken || !window.confirm("Từ chối yêu cầu đổi trực này?")) return;
                setNotificationsLoading(true);
                try {
                  await api.rejectSwap(item.swapToken);
                  await refreshNotifications(false);
                  notify("Đã từ chối đổi trực");
                } catch (error) {
                  notify(error instanceof Error ? error.message : "Từ chối đổi trực thất bại.");
                } finally {
                  setNotificationsLoading(false);
                }
              }}
              onSelect={(item) => {
                setNotificationsOpen(false);
                if (item.swapToken) {
                  setSwapToken(item.swapToken);
                  return;
                }
                if (item.actionView === "report" && item.actionDate) {
                  setReportNavigation((current) => ({
                    date: item.actionDate as string,
                    requestId: (current?.requestId || 0) + 1
                  }));
                }
                if (item.actionView) setView(item.actionView);
              }}
            />
          </div>
        </div>

        <div className="header-controls">
          <div className="week-tools" aria-label="Điều hướng tuần">
            <button type="button" className="icon-btn" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Tuần trước">
              <ChevronLeft size={18} />
            </button>
            <button type="button" className="week-pill" onClick={() => setWeekStart(normalizeWeekStart(todayInVietnam()))}>
              {formatWeekLabel(weekStart)}
            </button>
            <button type="button" className="icon-btn" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Tuần sau">
              <ChevronRight size={18} />
            </button>
            <label className="toggle-pill">
              <input type="checkbox" checked={showLunar} onChange={(event) => setShowLunar(event.target.checked)} />
              <span className="lunar-text-desktop">Âm lịch</span>
              <span className="lunar-text-mobile">ÂL</span>
            </label>
          </div>

          <div className="header-actions">
            {isAdmin ? (
              <div className="action-menu">
                <button
                  type="button"
                  className="icon-btn"
                  title="Cập nhật"
                  onClick={() => setUpdateMenuOpen((open) => !open)}
                  aria-label="Cập nhật"
                  aria-haspopup="menu"
                  aria-expanded={updateMenuOpen}
                >
                  <RefreshCw size={16} />
                </button>
                {updateMenuOpen && (
                  <div className="action-menu-panel" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setUpdateMenuOpen(false);
                        void run(refresh, "Đã cập nhật lịch");
                      }}
                    >
                      Tải lại lịch
                    </button>
                    <button type="button" role="menuitem" onClick={recalculateWork}>
                      Cập nhật lại danh sách làm việc
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                className="icon-btn"
                title="Cập nhật"
                onClick={() => void run(refresh, "Đã cập nhật lịch")}
                aria-label="Cập nhật"
              >
                <RefreshCw size={16} />
              </button>
            )}
            {isAdmin && (
              <div className="danger-menu">
                <button
                  type="button"
                  className="icon-btn danger-tool"
                  title="Xóa"
                  onClick={() => setClearMenuOpen((open) => !open)}
                  aria-label="Xóa"
                  aria-haspopup="menu"
                  aria-expanded={clearMenuOpen}
                >
                  <Trash2 size={16} />
                </button>
                {clearMenuOpen && (
                  <div className="danger-menu-panel" role="menu">
                    <button type="button" role="menuitem" onClick={() => clearSchedule("duty_bs", "lịch trực BS tuần này")}>
                      Xóa lịch trực BS tuần này
                    </button>
                    <button type="button" role="menuitem" onClick={() => clearSchedule("duty_ktv", "lịch trực KTV tuần này")}>
                      Xóa lịch trực KTV tuần này
                    </button>
                    <button type="button" role="menuitem" onClick={() => clearSchedule("work_bs", "lịch làm việc BS")}>
                      Xóa lịch làm việc BS
                    </button>
                    <button type="button" role="menuitem" onClick={() => clearSchedule("work_ktv", "lịch làm việc KTV")}>
                      Xóa lịch làm việc KTV
                    </button>
                    <button type="button" role="menuitem" className="danger-menu-all" onClick={() => clearSchedule("all", "tất cả lịch tuần này")}>
                      Xóa tất cả lịch tuần này
                    </button>
                    <button type="button" role="menuitem" className="danger-menu-all" onClick={() => clearSchedule("month_all", "tất cả lịch tháng này")}>
                      Xóa tất cả lịch tháng này
                    </button>
                  </div>
                )}
              </div>
            )}
            <button type="button" className="tool-btn" title="Xuất PNG" aria-label="Xuất PNG" onClick={() => exportPng(data, showLunar)}>
              <Download size={16} /> <span className="btn-text">Xuất PNG</span>
            </button>
            {isAdmin && (
              <button type="button" className="tool-btn" title="Xuất Excel" aria-label="Xuất Excel" onClick={() => exportExcel(data, showLunar)}>
                <FileSpreadsheet size={16} /> <span className="btn-text">Excel</span>
              </button>
            )}
            {isAdmin && (
              <button type="button" className="primary-btn" onClick={() => void run(() => api.confirmSchedule(weekStart).then(() => refresh()), "Đã duyệt lịch tuần")}> 
                <Save size={16} /> Duyệt lịch
              </button>
            )}
          </div>
        </div>
      </header>

      <nav className="tabs" aria-label="Khu vực chức năng">
        <Tab id="schedule" view={view} setView={setView} label="Lịch tuần" />
        <Tab id="leave" view={view} setView={setView} label="Nghỉ phép" />
        <Tab
          id="report"
          view={view}
          setView={(nextView) => {
            setReportNavigation(null);
            setView(nextView);
          }}
          label="Báo cáo trực"
        />
        {isAdmin && <Tab id="staff" view={view} setView={setView} label="Nhân sự" />}
        {isAdmin && <Tab id="users" view={view} setView={setView} label="Tài khoản" />}
        <Tab id="history" view={view} setView={setView} label="Lịch sử" />
        {isAdmin && <Tab id="settings" view={view} setView={setView} label="Cấu hình" />}
        {!isAdmin && <Tab id="profile" view={view} setView={setView} label="Cấu hình" />}
      </nav>

      {view === "schedule" && data && (
        <main className={`main-grid ${isAdmin && data.showStaffRail !== false ? "" : "schedule-only"}`}>
          {isAdmin && data.showStaffRail !== false && (
            <aside className="staff-rail" aria-label="Danh sách kéo thả">
              <PanelTitle icon={<Users size={17} />} title="Nhân sự" />
              <Roster title="Bác sĩ" staff={bsStaff} onDrag={setDraggedStaffId} />
              <Roster title="Kỹ thuật viên" staff={ktvStaff} onDrag={setDraggedStaffId} />
            </aside>
          )}
          <section className="schedule-area">
              <ScheduleTable
                data={data}
                user={user}
                isAdmin={isAdmin}
                showLunar={showLunar}
                draggedStaffId={draggedStaffId}
                draggedAssignmentId={draggedAssignmentId}
                draggedRowId={draggedRowId}
                tableRef={tableRef}
                onDragAssignment={setDraggedAssignmentId}
                onOpenDutySwap={setSwapTarget}
                onDragRow={setDraggedRowId}
                onOpenRotation={setRotationUnit}
                onContinueRotation={(unit) => {
                  const removePostDuty = window.confirm("Bạn muốn bỏ người ra trực vào ngày ra trực không?");
                  run(async () => {
                    await api.applyRotation(unit.id, { weekStart });
                    let deleted = 0;
                    if (removePostDuty) {
                      const result = await api.recalculateWork(weekStart);
                      deleted = result.deleted;
                    }
                    await refresh();
                    if (removePostDuty) notify(`Đã bỏ ${deleted} phân công ngày ra trực`);
                  }, "Đã áp dụng tiếp tục tua");
                }}
                onDropStaff={(unit, date, staffId) =>
                  run(async () => {
                    await api.putAssignment({ unitId: unit.id, date, staffId });
                    await refresh();
                  }, "Đã thêm phân công")
                }
                onMoveAssignment={(assignmentId, unit, date) =>
                  run(async () => {
                    const res = await api.moveAssignment(assignmentId, { unitId: unit.id, date });
                    await refresh();
                    if (res?.pending && res?.token) {
                      const link = `${window.location.origin}/?swapToken=${res.token}`;
                      setPendingSwapLink(link);
                    }
                  }, "Đã xử lý đổi lịch")
                }
                onReorderRows={(section, fromId, toId) =>
                  run(async () => {
                    const sectionUnits = data.units.filter((u) => u.section === section && !u.computed);
                    const ids = moveId(sectionUnits.map((u) => u.id), fromId, toId);
                    await api.reorderUnits(ids);
                    await refresh();
                  }, "Đã đổi vị trí row")
                }
                onAdd={(unit, date, staffId) =>
                run(async () => {
                  await api.putAssignment({ unitId: unit.id, date, staffId });
                  await refresh();
                }, "Đã thêm phân công")
              }
              onDelete={(id) =>
                run(async () => {
                  await api.deleteAssignment(id);
                  await refresh();
                }, "Đã xóa phân công")
              }
              />
            {rotationUnit && (
              <RotationDialog
                unit={rotationUnit}
                data={data}
                onClose={() => setRotationUnit(null)}
                onSave={(payload) =>
                  run(async () => {
                    await api.saveRotation(rotationUnit.id, payload);
                    await refresh();
                  }, rotationUnit.section === "I" ? "Đã lưu tua trực" : "Đã lưu lịch làm việc")
                }
                onApply={(weeks, payload) =>
                  run(async () => {
                    await api.saveRotation(rotationUnit.id, payload);
                    await api.applyRotation(rotationUnit.id, { weekStart, weeks });
                    await refresh();
                    setRotationUnit(null);
                  }, weeks === 1 ? "Đã áp dụng tua cho tuần" : `Đã áp dụng tua cho ${weeks} tuần`)
                }
              />
            )}
          </section>
        </main>
      )}

      {view === "leave" && data && (
        <LeaveView
          data={data}
          user={user}
          onCreate={(payload) => run(() => api.createLeave(payload).then(() => refresh()), "Đã ghi nhận nghỉ phép")}
          onCancel={(leaveDayId) => run(() => api.cancelLeaveDay(leaveDayId).then(() => refresh()), "Đã hủy ngày nghỉ phép")}
          showLunar={showLunar}
          onRefresh={refresh}
        />
      )}

      {view === "settings" && isAdmin && data && (
        <SettingsView units={data.units} onRefresh={refresh} />
      )}

      {view === "profile" && !isAdmin && (
        <ProfileSettingsView user={user} onUserUpdated={setUser} notify={notify} />
      )}

      {view === "staff" && isAdmin && data && (
        <StaffView
          staff={data.staff}
          onCreate={(payload) => run(() => api.createStaff(payload).then(() => refresh()), "Đã thêm nhân sự")}
          onToggle={(item) => run(() => api.updateStaff(item.id, { active: !item.active }).then(() => refresh()), "Đã cập nhật nhân sự")}
          onUpdate={(id, payload) => run(() => api.updateStaff(id, payload).then(() => refresh()), "Đã sửa nhân sự")}
          onDelete={(id) => run(() => api.deleteStaff(id).then(() => refresh()), "Đã xóa nhân sự")}
        />
      )}

      {view === "users" && isAdmin && data && (
        <UsersView staff={data.staff} onSaved={() => run(refresh, "Đã cập nhật")} notify={notify} />
      )}

      {view === "history" && data && <HistoryView data={data} weekStart={weekStart} isAdmin={isAdmin} notify={notify} />}

      {view === "report" && (
        <ReportView
          key={reportNavigation?.requestId || "default"}
          user={user}
          notify={notify}
          navigationTarget={reportNavigation}
        />
      )}

      {swapTarget && data && (
        <DutySwapDialog
          currentData={data}
          user={user}
          target={swapTarget}
          onClose={() => setSwapTarget(null)}
          onSwap={async (source, target) => {
            const res = await api.moveAssignment(source.id, { unitId: target.unitId, date: target.date, slot: target.slot });
            await refresh();
            setSwapTarget(null);
            if (res?.pending && res?.token) {
              const link = `${window.location.origin}/?swapToken=${res.token}`;
              setPendingSwapTarget({ name: target.staffName, type: target.staffType });
              setPendingSwapLink(link);
            } else {
              notify("Đã đổi trực");
            }
          }}
        />
      )}

      {pendingSwapLink && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-panel" style={{maxWidth: 500}}>
            <div className="modal-head">
              <h2>Yêu cầu đổi trực chờ duyệt</h2>
              <button type="button" className="icon-btn" onClick={() => { setPendingSwapLink(null); setPendingSwapTarget(null); }}>×</button>
            </div>
            <div style={{padding: "16px 0", display: "grid", gap: 12}}>
              <p>Hệ thống đã tạo yêu cầu đổi trực ở trạng thái <strong>Chờ duyệt</strong>.</p>
              <p>Vui lòng gửi link dưới đây cho đối phương để họ xác nhận đồng ý đổi trực:</p>
              <div style={{display: "flex", gap: 8}}>
                <input
                  type="text"
                  readOnly
                  value={pendingSwapLink}
                  onClick={(event) => (event.target as HTMLInputElement).select()}
                  style={{flex: 1}}
                />
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => {
                    navigator.clipboard.writeText(pendingSwapLink);
                    notify("Đã copy link!");
                  }}
                >
                  Copy
                </button>
              </div>
              {pendingSwapTarget && (
                <p style={{ color: "var(--muted)", fontStyle: "italic", fontSize: "0.9rem", marginTop: 8 }}>
                  Lưu ý: {pendingSwapTarget.type}. {pendingSwapTarget.name} đồng ý thì yêu cầu này mới được chấp nhận.
                </p>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="primary-btn" onClick={() => { setPendingSwapLink(null); setPendingSwapTarget(null); }}>Đóng</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function NotificationMenu({
  items,
  open,
  loading,
  onToggle,
  onClose,
  onMarkRead,
  onMarkAllRead,
  onAcceptSwap,
  onRejectSwap,
  onSelect
}: {
  items: NotificationItem[];
  open: boolean;
  loading: boolean;
  onToggle: () => void;
  onClose: () => void;
  onMarkRead: (item: NotificationItem) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
  onAcceptSwap: (item: NotificationItem) => Promise<void>;
  onRejectSwap: (item: NotificationItem) => Promise<void>;
  onSelect: (item: NotificationItem) => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const unreadCount = items.filter((item) => !item.read).length;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  return (
    <div className="notification-menu" ref={menuRef}>
      <button
        type="button"
        className={`notification-btn${open ? " active" : ""}`}
        onClick={onToggle}
        aria-label={unreadCount ? `Thông báo, ${unreadCount} mục chưa đọc` : "Thông báo, không có mục chưa đọc"}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Bell size={19} aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="notification-badge" aria-hidden="true">{unreadCount > 99 ? "99+" : unreadCount}</span>
        )}
      </button>
      {open && (
        <section className="notification-panel" aria-label="Thông báo">
          <div className="notification-panel-head">
            <div>
              <h2>Thông báo</h2>
              <p>{items.length ? `${unreadCount} chưa đọc · ${items.length} tổng` : "Không có việc đang chờ"}</p>
            </div>
            <div className="notification-head-actions">
              {unreadCount > 0 && (
                <button type="button" className="notification-read-all" onClick={() => void onMarkAllRead()} disabled={loading}>
                  Đánh dấu tất cả đã đọc
                </button>
              )}
              {loading && <RefreshCw className="notification-spinner" size={17} aria-label="Đang cập nhật" />}
            </div>
          </div>
          <div className="notification-list" role="menu">
            {!loading && items.length === 0 && (
              <div className="notification-empty">
                <Check size={22} aria-hidden="true" />
                <span>Bạn đã xử lý hết thông báo.</span>
              </div>
            )}
            {items.map((item) => {
              const Icon = item.type === "swap" ? ArrowLeftRight : item.type === "leave" ? CalendarCheck : PenLine;
              return (
                <div key={item.id} className={`notification-item ${item.type} ${item.read ? "read" : "unread"}`} role="none">
                  <button
                    type="button"
                    className="notification-item-main"
                    role="menuitem"
                    onClick={() => {
                      if (!item.read) void onMarkRead(item);
                      onSelect(item);
                    }}
                  >
                    <span className="notification-item-icon"><Icon size={18} aria-hidden="true" /></span>
                    <span className="notification-item-content">
                      <strong>{item.title}</strong>
                      <span>{item.message}</span>
                      <time dateTime={item.createdAt}>{formatNotificationTime(item.createdAt)}</time>
                    </span>
                  </button>
                  {item.swapToken ? (
                    <div className="notification-swap-actions" role="group" aria-label={`Xử lý: ${item.title}`}>
                      <button type="button" className="notification-swap-reject" onClick={() => void onRejectSwap(item)} disabled={loading}>
                        Từ chối
                      </button>
                      <button type="button" className="notification-swap-accept" onClick={() => void onAcceptSwap(item)} disabled={loading}>
                        Đồng ý
                      </button>
                    </div>
                  ) : !item.read && (
                    <button type="button" className="notification-mark-read" onClick={() => void onMarkRead(item)} disabled={loading} aria-label={`Đánh dấu đã đọc: ${item.title}`}>
                      <Check size={14} aria-hidden="true" /> Đã đọc
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function formatNotificationTime(value: string): string {
  const date = parseTimestamp(value);
  if (!date) return value;
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: APP_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function LoginScreen({ error, onSubmit }: { error: string; onSubmit: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    await onSubmit(username, password);
    setBusy(false);
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <img
          className="brand-mark large"
          src="https://bvtn.org.vn/wp-content/uploads/2023/12/logo-bvtn-148x148.png.webp"
          alt="Logo BVTN"
          style={{ objectFit: "contain", background: "transparent" }}
        />
        <h1>LỊCH LÀM VIỆC KHOA</h1>
        <p>Khoa Chẩn Đoán Hình Ảnh</p>
        <label>
          Tên đăng nhập
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoFocus />
        </label>
        <label>
          Mật khẩu
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete="current-password"
          />
        </label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button type="submit" className="primary-btn wide" disabled={busy}>
          {busy ? "Đang đăng nhập..." : "Đăng nhập"}
        </button>
      </form>
    </main>
  );
}

function Tab({ id, view, setView, label }: { id: View; view: View; setView: (view: View) => void; label: string }) {
  return (
    <button type="button" className={view === id ? "active" : ""} onClick={() => setView(id)}>
      {label}
    </button>
  );
}

function PanelTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="panel-title">
      {icon}
      <span>{title}</span>
    </div>
  );
}

function StaffSearchSelect({
  value,
  options,
  onChange,
  placeholder = "Tìm nhân sự",
  disabled = false,
  ariaLabel
}: {
  value: number | "";
  options: Staff[];
  onChange: (value: number | "") => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const listId = useRef(`staff-list-${Math.random().toString(36).slice(2)}`).current;
  const [text, setText] = useState("");

  useEffect(() => {
    const selected = options.find((staff) => staff.id === value);
    setText(selected ? staffOptionLabel(selected) : "");
  }, [value, options]);

  return (
    <>
      <input
        list={listId}
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel || placeholder}
        onChange={(event) => {
          const nextText = event.target.value;
          setText(nextText);
          if (!nextText) {
            onChange("");
            return;
          }
          const match = options.find((staff) => staffOptionLabel(staff) === nextText || staff.name === nextText);
          onChange(match?.id ?? "");
        }}
        onBlur={() => {
          const selected = options.find((staff) => staff.id === value);
          if (value && selected) setText(staffOptionLabel(selected));
          if (!value) setText("");
        }}
      />
      <datalist id={listId}>
        {options.map((staff) => (
          <option key={staff.id} value={staffOptionLabel(staff)} />
        ))}
      </datalist>
    </>
  );
}

function staffOptionLabel(staff: Staff): string {
  return `${staff.type}. ${staff.name}`;
}

function Roster({ title, staff, onDrag }: { title: string; staff: Staff[]; onDrag: (staffId: number | null) => void }) {
  return (
    <div className="roster">
      <h2>{title}</h2>
      <div className="staff-chips">
        {staff.length === 0 && <span className="empty-note">Chưa có dữ liệu</span>}
        {staff.map((item) => (
          <button
            key={item.id}
            type="button"
            draggable
            className={`staff-chip ${item.type.toLowerCase()}`}
            onDragStart={() => onDrag(item.id)}
            onDragEnd={() => onDrag(null)}
            title="Kéo vào ô lịch"
          >
            {item.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function ScheduleTable({
  data,
  user,
  isAdmin,
  showLunar,
  draggedStaffId,
  draggedAssignmentId,
  draggedRowId,
  tableRef,
  onDragAssignment,
  onOpenDutySwap,
  onDragRow,
  onOpenRotation,
  onContinueRotation,
  onDropStaff,
  onMoveAssignment,
  onReorderRows,
  onAdd,
  onDelete
}: {
  data: ScheduleResponse;
  user: User;
  isAdmin: boolean;
  showLunar: boolean;
  draggedStaffId: number | null;
  draggedAssignmentId: number | null;
  draggedRowId: number | null;
  tableRef: MutableRefObject<HTMLDivElement | null>;
  onDragAssignment: (assignmentId: number | null) => void;
  onOpenDutySwap: (assignment: Assignment) => void;
  onDragRow: (unitId: number | null) => void;
  onOpenRotation: (unit: ScheduleUnit) => void;
  onContinueRotation: (unit: ScheduleUnit) => void;
  onDropStaff: (unit: ScheduleUnit, date: string, staffId: number) => void;
  onMoveAssignment: (assignmentId: number, unit: ScheduleUnit, date: string) => void;
  onReorderRows: (section: "II" | "III", fromId: number, toId: number) => void;
  onAdd: (unit: ScheduleUnit, date: string, staffId: number) => void;
  onDelete: (id: number) => void;
}) {
  const [selectedStaff, setSelectedStaff] = useState<Record<string, number>>({});
  const groupedUnits = groupBySection(data.units);

  return (
    <div className="schedule-table-wrap" ref={tableRef}>
      <div className="schedule-grid day-header-row">
        <div className="unit-head">KHU VỰC</div>
        {data.days.map((day, index) => (
          <div className="day-head" key={day}>
            <strong>{DAYS[index]}</strong>
            <span>{formatDate(day)}</span>
            {showLunar && <small>{formatLunarDate(day)}</small>}
          </div>
        ))}
      </div>
      {Object.entries(groupedUnits).map(([section, units]) => (
        <div key={section} className="section-block">
          <div className="section-label">
            <span className="section-label-text">{SECTION_LABELS[section]}</span>
          </div>
          {units.map((unit) => (
            <div className="schedule-grid schedule-row" key={unit.id}>
              <div
                className={`unit-name unit-${unit.section.toLowerCase()} ${isAdmin && (unit.section === "II" || unit.section === "III") && !unit.computed ? "row-draggable" : ""}`}
                draggable={isAdmin && (unit.section === "II" || unit.section === "III") && !unit.computed}
                onDragStart={() => onDragRow(unit.id)}
                onDragOver={(event) => {
                  if (draggedRowId && draggedRowId !== unit.id && (unit.section === "II" || unit.section === "III")) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggedRowId && draggedRowId !== unit.id && (unit.section === "II" || unit.section === "III")) {
                    onReorderRows(unit.section, draggedRowId, unit.id);
                  }
                  onDragRow(null);
                }}
                onDragEnd={() => onDragRow(null)}
                title={unit.section === "II" || unit.section === "III" ? "Kéo để đổi vị trí row" : undefined}
              >
                <span>{unit.label}</span>
                {isAdmin && !unit.computed && (
                  <div className="unit-actions">
                    <button
                      type="button"
                      className="unit-action"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenRotation(unit);
                      }}
                    >
                      Tua
                    </button>
                    <button
                      type="button"
                      className="unit-action"
                      onClick={(event) => {
                        event.stopPropagation();
                        onContinueRotation(unit);
                      }}
                    >
                      Áp tiếp
                    </button>
                  </div>
                )}
              </div>
              {data.days.map((date) => {
                const allowedStaffTypes = staffTypesForUnit(unit.type);
                const choices = allowedStaffTypes.length
                  ? data.staff.filter((staff) => staff.active && allowedStaffTypes.includes(staff.type))
                  : [];
                const key = `${unit.id}-${date}`;
                return (
                  <div
                    key={date}
                    className={`day-cell ${unit.computed ? "computed" : ""}`}
                    onDragOver={(event) => {
                      if (!unit.computed && ((isAdmin && draggedStaffId) || draggedAssignmentId)) event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (unit.computed) return;
                      if (draggedAssignmentId) onMoveAssignment(draggedAssignmentId, unit, date);
                      else if (isAdmin && draggedStaffId) onDropStaff(unit, date, draggedStaffId);
                    }}
                  >
                    <CellContent
                      unit={unit}
                      date={date}
                      data={data}
                      isAdmin={isAdmin}
                      user={user}
                      onDelete={onDelete}
                      onDragAssignment={onDragAssignment}
                      onOpenDutySwap={onOpenDutySwap}
                    />
                    {isAdmin && !unit.computed && (
                      <div className="cell-add">
                        <StaffSearchSelect
                          ariaLabel={`Chọn nhân sự cho ${unit.label} ngày ${date}`}
                          value={selectedStaff[key] || ""}
                          options={choices}
                          placeholder="Tìm"
                          onChange={(value) => setSelectedStaff((prev) => ({ ...prev, [key]: Number(value) || 0 }))}
                        />
                        <button
                          type="button"
                          className="mini-icon-btn"
                          disabled={!selectedStaff[key]}
                          onClick={() => onAdd(unit, date, selectedStaff[key])}
                          aria-label="Thêm phân công"
                        >
                          <Plus size={15} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function CellContent({
  unit,
  date,
  data,
  isAdmin,
  user,
  onDelete,
  onDragAssignment,
  onOpenDutySwap
}: {
  unit: ScheduleUnit;
  date: string;
  data: ScheduleResponse;
  isAdmin: boolean;
  user: User;
  onDelete: (id: number) => void;
  onDragAssignment: (id: number | null) => void;
  onOpenDutySwap: (assignment: Assignment) => void;
}) {
  const assignments = data.assignments.filter((item) => item.unitId === unit.id && item.date === date);
  if (unit.type === "duty_common") {
    return (
      <AssignmentList
        assignments={data.assignments.filter((item) => (item.unitCode === "duty_bs" || item.unitCode === "duty_ktv") && item.date === date)}
        stacked
      />
    );
  }
  if (unit.type === "leave") {
    const leaves = data.leaveDays.filter((item) => item.date === date);
    if (leaves.length === 0) return <span className="empty-note">Không có</span>;
    return (
      <div className="assignment-list">
        {leaves.map((leave) => (
          <span key={leave.id} className={`person-pill leave ${leave.staffType.toLowerCase()}`}>
            {leave.staffType}. {leave.staffName}
          </span>
        ))}
      </div>
    );
  }
  return (
    <AssignmentList
      assignments={assignments}
      unit={unit}
      isAdmin={isAdmin}
      user={user}
      onDelete={onDelete}
      onDragAssignment={onDragAssignment}
      onOpenDutySwap={onOpenDutySwap}
    />
  );
}

function AssignmentList({
  assignments,
  unit,
  isAdmin = false,
  user,
  onDelete,
  onDragAssignment,
  onOpenDutySwap,
  stacked = false
}: {
  assignments: Assignment[];
  unit?: ScheduleUnit;
  isAdmin?: boolean;
  user?: User;
  onDelete?: (id: number) => void;
  onDragAssignment?: (id: number | null) => void;
  onOpenDutySwap?: (assignment: Assignment) => void;
  stacked?: boolean;
}) {
  if (assignments.length === 0) return <span className="empty-note">Trống</span>;
  const today = todayInVietnam();
  return (
    <div className={`assignment-list ${stacked ? "stacked-assignment-list" : ""}`}>
      {assignments.map((assignment) => (
        <AssignmentPill
          key={assignment.id}
          assignment={assignment}
          canDrag={isAdmin}
          canSwap={
            !isAdmin &&
            !!user?.staffId &&
            !!unit &&
            isDutyUnit(unit) &&
            assignment.staffId !== user.staffId &&
            assignment.date >= today &&
            assignment.staffType === roleStaffType(user.role)
          }
          canDelete={isAdmin}
          onDelete={onDelete}
          onDragAssignment={onDragAssignment}
          onOpenDutySwap={onOpenDutySwap}
        />
      ))}
    </div>
  );
}

function AssignmentPill({
  assignment,
  canDrag,
  canSwap,
  canDelete,
  onDelete,
  onDragAssignment,
  onOpenDutySwap
}: {
  assignment: Assignment;
  canDrag: boolean;
  canSwap: boolean;
  canDelete: boolean;
  onDelete?: (id: number) => void;
  onDragAssignment?: (id: number | null) => void;
  onOpenDutySwap?: (assignment: Assignment) => void;
}) {
  return (
    <span
      className={`person-pill ${assignment.staffType.toLowerCase()} ${canDrag ? "draggable-pill" : ""}`}
      draggable={canDrag}
      onDragStart={() => canDrag && onDragAssignment?.(assignment.id)}
      onDragEnd={() => onDragAssignment?.(null)}
      title={canDrag ? "Kéo sang ô người khác để đổi lịch" : undefined}
    >
      {assignment.staffType}. {assignment.staffName}
      {canDelete && onDelete && (
        <button type="button" onClick={() => onDelete(assignment.id)} aria-label={`Xóa ${assignment.staffName}`}>
          <Trash2 size={12} />
        </button>
      )}
      {canSwap && onOpenDutySwap && (
        <button type="button" className="pill-icon-btn" onClick={() => onOpenDutySwap(assignment)} aria-label={`Đổi trực với ${assignment.staffName}`}>
          <ArrowLeftRight size={12} />
        </button>
      )}
    </span>
  );
}

function RotationDialog({
  unit,
  data,
  onClose,
  onSave,
  onApply
}: {
  unit: ScheduleUnit;
  data: ScheduleResponse;
  onClose: () => void;
  onSave: (payload: { startDate: string; mode: "daily" | "weekly"; turns: number[][] }) => void;
  onApply: (weeks: number, payload: { startDate: string; mode: "daily" | "weekly"; turns: number[][] }) => void;
}) {
  const rotations = Array.isArray(data.rotations) ? data.rotations : [];
  const existing = rotations.find((item) => item.unitId === unit.id);
  const existingTurns = Array.isArray(existing?.turns)
    ? existing.turns
        .filter((turn) => Array.isArray(turn))
        .map((turn) => turn.map((member) => Number(member?.staffId)).filter((staffId) => Number.isFinite(staffId)))
    : [];
  const allowedStaffTypes = staffTypesForUnit(unit.type);
  const staffList = Array.isArray(data.staff) ? data.staff : [];
  const choices = staffList.filter((staff) => staff.active && (allowedStaffTypes.length === 0 || allowedStaffTypes.includes(staff.type)));
  const forceDailyMode = unit.section === "I";
  const [startDate, setStartDate] = useState(existing?.startDate || data.weekStart);
  const [mode, setMode] = useState<"daily" | "weekly">(forceDailyMode ? "daily" : existing?.mode || "daily");
  const [turns, setTurns] = useState<number[][]>(
    existingTurns.length ? existingTurns : [[]]
  );
  const [draggedTurnIndex, setDraggedTurnIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [applyMenuOpen, setApplyMenuOpen] = useState(false);

  function addStaff(turnIndex: number, staffId: number) {
    setTurns((prev) =>
      prev.map((turn, index) => {
        if (index !== turnIndex || turn.includes(staffId)) return turn;
        return [...turn, staffId];
      })
    );
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-panel">
        <div className="modal-head">
          <div>
            <h2>{unit.section === "I" ? "Tua trực" : "Lịch làm việc"} - {unit.label}</h2>
            <p>Tua 1 bắt đầu từ ngày chọn, các ngày sau xoay theo thứ tự tua.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Đóng">×</button>
        </div>
        <label className="field">
          Ngày bắt đầu tua 1
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
        {!forceDailyMode && (
          <label className="field">
            Chế độ tua
            <select value={mode} onChange={(event) => setMode(event.target.value as "daily" | "weekly")}>
              <option value="daily">Tua ngày</option>
              <option value="weekly">Tua tuần</option>
            </select>
          </label>
        )}
        <div className="turn-list">
          {turns.map((turn, turnIndex) => (
            <div
              className={`turn-card draggable ${draggedTurnIndex === turnIndex ? "dragging" : ""} ${dragOverIndex === turnIndex ? "drag-over" : ""}`}
              key={turnIndex}
              draggable
              onDragStart={(e) => {
                setDraggedTurnIndex(turnIndex);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => {
                setDraggedTurnIndex(null);
                setDragOverIndex(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (draggedTurnIndex !== turnIndex) {
                  setDragOverIndex(turnIndex);
                }
              }}
              onDragLeave={() => {
                if (dragOverIndex === turnIndex) {
                  setDragOverIndex(null);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (draggedTurnIndex !== null && draggedTurnIndex !== turnIndex) {
                  setTurns((prev) => {
                    const next = [...prev];
                    const [moved] = next.splice(draggedTurnIndex, 1);
                    next.splice(turnIndex, 0, moved);
                    return next;
                  });
                }
                setDraggedTurnIndex(null);
                setDragOverIndex(null);
              }}
            >
              <div className="turn-head">
                <strong>Tua {turnIndex + 1}</strong>
                <button
                  type="button"
                  className="ghost-danger"
                  onClick={() => setTurns((prev) => prev.filter((_, index) => index !== turnIndex))}
                  disabled={turns.length === 1}
                >
                  Xóa
                </button>
              </div>
              <div className="assignment-list">
                {turn.map((staffId) => {
                  const staff = data.staff.find((item) => item.id === staffId);
                  if (!staff) return null;
                  return (
                    <span key={staffId} className={`person-pill ${staff.type.toLowerCase()}`}>
                      {staff.type}. {staff.name}
                      <button
                        type="button"
                        onClick={() => setTurns((prev) => prev.map((t, index) => index === turnIndex ? t.filter((id) => id !== staffId) : t))}
                      >
                        <Trash2 size={12} />
                      </button>
                    </span>
                  );
                })}
                {turn.length === 0 && <span className="empty-note">Chưa có nhân sự</span>}
              </div>
              <StaffSearchSelect
                value=""
                options={choices}
                placeholder="Tìm nhân sự thêm vào tua"
                onChange={(value) => {
                  if (value) addStaff(turnIndex, value);
                }}
              />
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" className="tool-btn" onClick={() => setTurns((prev) => [...prev, []])}>
            <Plus size={16} /> Thêm tua
          </button>
          <button type="button" className="tool-btn" onClick={() => onSave({ startDate, mode: forceDailyMode ? "daily" : mode, turns })}>
            <Save size={16} /> Lưu tua
          </button>
          <div className="action-menu">
            <button type="button" className="primary-btn" onClick={() => setApplyMenuOpen((open) => !open)}>
              <CalendarCheck size={16} /> Áp dụng <ChevronDown size={16} />
            </button>
            {applyMenuOpen && (
              <div className="action-menu-panel upward right-align" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setApplyMenuOpen(false);
                    onApply(1, { startDate, mode: forceDailyMode ? "daily" : mode, turns });
                  }}
                >
                  Áp dụng tuần này
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setApplyMenuOpen(false);
                    onApply(4, { startDate, mode: forceDailyMode ? "daily" : mode, turns });
                  }}
                >
                  Áp dụng 4 tuần
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setApplyMenuOpen(false);
                    onApply(8, { startDate, mode: forceDailyMode ? "daily" : mode, turns });
                  }}
                >
                  Áp dụng 8 tuần
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setApplyMenuOpen(false);
                    onApply(12, { startDate, mode: forceDailyMode ? "daily" : mode, turns });
                  }}
                >
                  Áp dụng 12 tuần
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DutySwapDialog({
  currentData,
  user,
  target,
  onClose,
  onSwap
}: {
  currentData: ScheduleResponse;
  user: User;
  target: Assignment;
  onClose: () => void;
  onSwap: (source: Assignment, target: Assignment) => Promise<void>;
}) {
  const [sourceId, setSourceId] = useState<number | "">("");
  const [sourceItems, setSourceItems] = useState<Array<{ assignment: Assignment; data: ScheduleResponse }>>([]);
  const [loadingSources, setLoadingSources] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const firstWeek = normalizeWeekStart(todayIso());
    const weekStarts = Array.from({ length: 8 }, (_, index) => addDays(firstWeek, index * 7));
    setLoadingSources(true);
    setError("");
    Promise.all(weekStarts.map((week) => (week === currentData.weekStart ? Promise.resolve(currentData) : api.schedule(week))))
      .then((weeks) => {
        if (cancelled) return;
        const seen = new Set<number>();
        const items = weeks.flatMap((weekData) =>
          weekData.assignments
            .filter((assignment) => {
              const unit = weekData.units.find((item) => item.id === assignment.unitId);
              if (!unit || !isDutyUnit(unit)) return false;
              if (assignment.id === target.id || seen.has(assignment.id)) return false;
              if (assignment.date < todayIso()) return false;
              if (assignment.staffType !== target.staffType) return false;
              if (assignment.staffId !== user.staffId) return false;
              seen.add(assignment.id);
              return true;
            })
            .map((assignment) => ({ assignment, data: weekData }))
        );
        setSourceItems(items);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Không tải được lịch trực tương lai.");
      })
      .finally(() => {
        if (!cancelled) setLoadingSources(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentData, target, user.staffId]);

  const sourceItem = sourceItems.find((item) => item.assignment.id === sourceId);
  const source = sourceItem?.assignment;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!source) {
      setError("Cần chọn một ca trực của bạn để đổi.");
      return;
    }
    setBusy(true);
    try {
      await onSwap(source, target);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không đổi trực được.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal-panel swap-panel" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <h2>Đổi trực với {target.staffType}. {target.staffName}</h2>
            <p>{assignmentOptionLabel(currentData, target)}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Đóng">×</button>
        </div>
        <div className="swap-duty-list" role="radiogroup" aria-label="Ca trực của bạn">
          {loadingSources && <span className="empty-note">Đang tải lịch trực của bạn...</span>}
          {!loadingSources && sourceItems.length === 0 && <span className="empty-note">Bạn chưa có ca trực hiện tại hoặc tương lai để đổi.</span>}
          {sourceItems.map((item) => (
            <label key={item.assignment.id} className={`swap-duty-option ${sourceId === item.assignment.id ? "checked" : ""}`}>
              <input
                type="radio"
                name="source-assignment"
                checked={sourceId === item.assignment.id}
                onChange={() => setSourceId(item.assignment.id)}
              />
              <span>{assignmentOptionLabel(item.data, item.assignment)}</span>
            </label>
          ))}
        </div>
        {source && sourceItem && (
          <div className="swap-summary">
            <span>{assignmentOptionLabel(sourceItem.data, source)}</span>
            <ArrowLeftRight size={16} />
            <span>{assignmentOptionLabel(currentData, target)}</span>
          </div>
        )}
        {currentData.approveSwap && user.role !== "admin" && (
          <p className="swap-note" style={{ color: "#d97706", fontSize: "0.9rem", margin: "8px 0 0", textAlign: "center", fontWeight: "500" }}>
            Lưu ý: {target.staffType}. {target.staffName} đồng ý thì yêu cầu này mới được chấp nhận
          </p>
        )}
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="tool-btn" onClick={onClose}>Hủy</button>
          <button type="submit" className="primary-btn" disabled={busy || !source}>
            <ArrowLeftRight size={16} /> {busy ? "Đang đổi..." : "Đổi trực"}
          </button>
        </div>
      </form>
    </div>
  );
}

function assignmentOptionLabel(data: ScheduleResponse, assignment: Assignment): string {
  const dow = getDayOfWeekLabel(assignment.date);
  const formattedDate = formatDate(assignment.date);
  return `${assignment.staffType}. ${assignment.staffName} trực ${dow} ngày ${formattedDate}`;
}

function isDutyUnit(unit: ScheduleUnit): boolean {
  return unit.type === "duty_bs" || unit.type === "duty_ktv";
}

function roleStaffType(role: Role): "BS" | "KTV" | null {
  if (role === "bs") return "BS";
  if (role === "ktv") return "KTV";
  return null;
}

function roleNeedsStaff(role: Role): boolean {
  return role === "bs" || role === "ktv" || role === "tkyk";
}

function roleCanLinkStaff(role: Role): boolean {
  return role === "admin" || roleNeedsStaff(role);
}

function staffOptionsForRole(staff: Staff[], role: Role): Staff[] {
  const active = staff.filter((item) => item.active);
  if (role === "admin") return active;
  if (role === "bs" || role === "ktv") return active.filter((item) => item.type.toLowerCase() === role);
  if (role === "tkyk") return active.filter((item) => item.type === "TKYK");
  return [];
}

function roleLabel(role: Role): string {
  if (role === "tkyk") return "TKYK";
  return role.toUpperCase();
}

function todayIso(): string {
  return todayInVietnam();
}

function LeaveView({
  data,
  user,
  onCreate,
  onCancel,
  showLunar,
  onRefresh
}: {
  data: ScheduleResponse;
  user: User;
  onCreate: (payload: { staffId?: number; dates: string[]; reason?: string }) => Promise<boolean>;
  onCancel: (leaveDayId: number) => void;
  showLunar: boolean;
  onRefresh?: () => void;
}) {
  const [staffId, setStaffId] = useState<number | "">(user.role === "admin" ? "" : user.staffId || "");
  const [dates, setDates] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const scheduleMonth = data.weekStart.slice(0, 7);
  const [leaveMonth, setLeaveMonth] = useState(scheduleMonth);
  const [calendarLeaveDays, setCalendarLeaveDays] = useState<LeaveDay[]>(data.monthLeaveDays ?? []);
  const [leaveMonthLoading, setLeaveMonthLoading] = useState(false);
  const [leaveMonthError, setLeaveMonthError] = useState("");
  const leaveMonthRequest = useRef(0);
  const showMonthCalendar = user.role === "admin" || data.showLeaveMonthCalendar === true;
  const ownStaff = user.role === "admin" ? data.staff.filter((staff) => staff.active) : data.staff.filter((staff) => staff.id === user.staffId);
  const sortLeaveDays = (items: LeaveDay[]) => [...items].sort((a, b) => a.date.localeCompare(b.date) || a.staffName.localeCompare(b.staffName));
  const leaveStaffTypeOrder: Record<LeaveDay["staffType"], number> = { BS: 0, KTV: 1, TKYK: 2 };
  const leaveDays = sortLeaveDays(data.leaveDays);
  const nextWeekLeaveDays = sortLeaveDays(data.nextWeekLeaveDays ?? []);
  const monthLeaveDays = [...calendarLeaveDays].sort((a, b) =>
    a.date.localeCompare(b.date)
    || leaveStaffTypeOrder[a.staffType] - leaveStaffTypeOrder[b.staffType]
    || a.staffName.localeCompare(b.staffName, "vi")
  );
  const pendingLeaves = data.pendingLeaves ?? [];
  const showPendingApproval = !!data.approveLeaveBs || !!data.approveLeaveKtv;
  const today = todayInVietnam();
  const selectedStaff = ownStaff.find((staff) => staff.id === Number(staffId));
  const selectedDateBlockReason = (day: string) => selectedStaff
    ? getLeaveDateBlockReason(selectedStaff, day, data.leaveDays, 2)
    : "Hãy chọn nhân sự trước.";
  const hasBlockedSelectedDate = dates.some((day) => !!selectedDateBlockReason(day));

  useEffect(() => {
    leaveMonthRequest.current += 1;
    setLeaveMonth(scheduleMonth);
    setCalendarLeaveDays(data.monthLeaveDays ?? []);
    setLeaveMonthLoading(false);
    setLeaveMonthError("");
  }, [scheduleMonth]);

  useEffect(() => {
    if (leaveMonth === scheduleMonth) setCalendarLeaveDays(data.monthLeaveDays ?? []);
  }, [data.monthLeaveDays, leaveMonth, scheduleMonth]);

  async function moveLeaveMonth(offset: number) {
    const [year, month] = leaveMonth.split("-").map(Number);
    const target = new Date(Date.UTC(year, month - 1 + offset, 1));
    const nextMonth = `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}`;
    const requestId = ++leaveMonthRequest.current;
    setLeaveMonth(nextMonth);
    setLeaveMonthError("");
    if (nextMonth === scheduleMonth) {
      setCalendarLeaveDays(data.monthLeaveDays ?? []);
      setLeaveMonthLoading(false);
      return;
    }
    setLeaveMonthLoading(true);
    try {
      const result = await api.leaveMonth(nextMonth);
      if (requestId === leaveMonthRequest.current) setCalendarLeaveDays(result.leaveDays);
    } catch (error) {
      if (requestId === leaveMonthRequest.current) {
        setCalendarLeaveDays([]);
        setLeaveMonthError(error instanceof Error ? error.message : "Không tải được lịch phép tháng.");
      }
    } finally {
      if (requestId === leaveMonthRequest.current) setLeaveMonthLoading(false);
    }
  }

  const renderLeavePanel = (title: string, items: LeaveDay[], emptyText: string, className = "") => (
    <section className={`panel leave-recorded-panel ${className}`.trim()}>
      <PanelTitle icon={<CalendarCheck size={17} />} title={title} />
      <div className="leave-list">
        {items.length === 0 && <span className="empty-note">{emptyText}</span>}
        {items.map((day) => {
          const canCancel = user.role === "admin" || (user.staffId === day.staffId && day.date >= today);
          const registeredAt = formatLeaveRegistrationDateTime(day.registeredAt);
          const weekday = getDayOfWeekLabel(day.date);
          const leaveDateBadge = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${formatDate(day.date)}${showLunar ? ` ${formatLunarDate(day.date)}` : ""}`;
          return (
            <div className="leave-card" key={day.id}>
              <div>
                <div className="leave-card-heading">
                  <span className="leave-date-badge">{leaveDateBadge}</span>
                  <strong>{day.staffType}. {day.staffName}</strong>
                </div>
                {registeredAt && <span className="leave-registered-at">Đăng ký: {registeredAt}</span>}
                {day.reason && <small>{day.reason}</small>}
              </div>
              {(user.role === "admin" || user.staffId === day.staffId) && (
                <button
                  type="button"
                  className="ghost-danger"
                  disabled={!canCancel}
                  title={!canCancel ? "Ngày nghỉ đã qua, liên hệ admin nếu cần chỉnh dữ liệu" : undefined}
                  onClick={() => onCancel(day.id)}
                >
                  <Trash2 size={15} /> Hủy ngày này
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );

  const currentWeekPanel = renderLeavePanel("Nghỉ phép tuần này", leaveDays, "Chưa có nghỉ phép trong tuần này.");
  const nextWeekPanel = renderLeavePanel("Nghỉ phép tuần sau", nextWeekLeaveDays, "Chưa có nghỉ phép trong tuần sau.");
  const [monthYear, monthNumber] = leaveMonth.split("-").map(Number);
  const monthStart = `${monthYear}-${String(monthNumber).padStart(2, "0")}-01`;
  const daysInMonth = new Date(Date.UTC(monthYear, monthNumber, 0)).getUTCDate();
  const leadingDays = (new Date(`${monthStart}T00:00:00Z`).getUTCDay() + 6) % 7;
  const calendarSlotCount = Math.ceil((leadingDays + daysInMonth) / 7) * 7;
  const monthLabel = new Intl.DateTimeFormat("vi-VN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${monthStart}T00:00:00Z`));
  const leaveDaysByDate = new Map<string, LeaveDay[]>();
  for (const day of monthLeaveDays) {
    const daysOnDate = leaveDaysByDate.get(day.date) ?? [];
    daysOnDate.push(day);
    leaveDaysByDate.set(day.date, daysOnDate);
  }
  const mobileLeaveDates = [...leaveDaysByDate.entries()];
  const monthPanel = (
    <section className="panel leave-month-panel">
      <PanelTitle icon={<Calendar size={17} />} title="Nghỉ phép tháng này" />
      <div className="leave-calendar-toolbar">
        <button type="button" onClick={() => void moveLeaveMonth(-1)} disabled={leaveMonthLoading} aria-label="Xem tháng trước" title="Tháng trước">
          <ChevronLeft size={19} />
        </button>
        <p aria-live="polite">{monthLabel}</p>
        <button type="button" onClick={() => void moveLeaveMonth(1)} disabled={leaveMonthLoading} aria-label="Xem tháng sau" title="Tháng sau">
          <ChevronRight size={19} />
        </button>
      </div>
      {leaveMonthError && <span className="leave-calendar-error" role="alert">{leaveMonthError}</span>}
      <div className="leave-calendar" aria-label={`Lịch nghỉ phép ${monthLabel}`} aria-busy={leaveMonthLoading}>
        <div className="leave-calendar-weekdays" aria-hidden="true">
          {DAYS.map((label) => <span key={label}>{label}</span>)}
        </div>
        <div className="leave-calendar-grid">
          {Array.from({ length: calendarSlotCount }, (_, slotIndex) => {
            const dayNumber = slotIndex - leadingDays + 1;
            if (dayNumber < 1 || dayNumber > daysInMonth) {
              return <div className="leave-calendar-day is-outside" aria-hidden="true" key={`outside-${slotIndex}`} />;
            }
            const date = `${monthYear}-${String(monthNumber).padStart(2, "0")}-${String(dayNumber).padStart(2, "0")}`;
            const daysOnDate = leaveDaysByDate.get(date) ?? [];
            const isToday = date === today;
            return (
              <div
                className={`leave-calendar-day${isToday ? " is-today" : ""}${daysOnDate.length > 0 ? " has-leave" : ""}`}
                key={date}
                aria-label={`${formatDate(date)}${daysOnDate.length ? `, ${daysOnDate.length} người nghỉ` : ", không có người nghỉ"}`}
              >
                <div className="leave-calendar-date">
                  <span>{dayNumber}</span>
                  {showLunar && <small>{formatLunarDate(date)}</small>}
                </div>
                <div className="leave-calendar-people">
                  {daysOnDate.map((day) => {
                    const canCancel = user.role === "admin" || (user.staffId === day.staffId && day.date >= today);
                    const details = `${day.staffType}. ${day.staffName}${day.reason ? ` · ${day.reason}` : ""}`;
                    return (
                      <div className={`leave-calendar-person ${day.staffType.toLowerCase()}`} key={day.id} title={details}>
                        <span>{day.staffType}. {day.staffName}</span>
                        {(user.role === "admin" || user.staffId === day.staffId) && (
                          <button
                            type="button"
                            disabled={!canCancel}
                            aria-label={`Hủy nghỉ phép ${day.staffName} ngày ${formatDate(day.date)}`}
                            title={!canCancel ? "Ngày nghỉ đã qua" : `Hủy: ${details}`}
                            onClick={() => onCancel(day.id)}
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="leave-calendar-mobile-list" aria-label={`Danh sách nghỉ phép ${monthLabel}`} aria-busy={leaveMonthLoading}>
        {mobileLeaveDates.map(([date, daysOnDate]) => (
          <section className={`leave-mobile-day${date === today ? " is-today" : ""}`} key={date}>
            <header>
              <strong>{getDayOfWeekLabel(date)}, {formatDate(date)}</strong>
              <span>{daysOnDate.length} người nghỉ</span>
            </header>
            <div className="leave-mobile-people">
              {daysOnDate.map((day) => {
                const canCancel = user.role === "admin" || (user.staffId === day.staffId && day.date >= today);
                const details = `${day.staffType}. ${day.staffName}${day.reason ? ` · ${day.reason}` : ""}`;
                return (
                  <div className="leave-mobile-person" key={day.id}>
                    <span className={`leave-mobile-type ${day.staffType.toLowerCase()}`}>{day.staffType}</span>
                    <div>
                      <strong>{day.staffName}</strong>
                      {day.reason && <small>{day.reason}</small>}
                    </div>
                    {(user.role === "admin" || user.staffId === day.staffId) && (
                      <button
                        type="button"
                        disabled={!canCancel}
                        aria-label={`Hủy nghỉ phép ${day.staffName} ngày ${formatDate(day.date)}`}
                        title={!canCancel ? "Ngày nghỉ đã qua" : `Hủy: ${details}`}
                        onClick={() => onCancel(day.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      {leaveMonthLoading && <span className="empty-note leave-calendar-empty">Đang tải lịch phép...</span>}
      {!leaveMonthLoading && monthLeaveDays.length === 0 && <span className="empty-note leave-calendar-empty">Chưa có nghỉ phép trong tháng này.</span>}
    </section>
  );

  return (
    <main className={showMonthCalendar ? "leave-admin-grid" : "content-grid"}>
      <section className="panel">
        <PanelTitle icon={<ClipboardList size={17} />} title="Xin nghỉ phép" />
        <form
          className="form-stack"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!staffId) return;
            const pastDates = dates.filter((d) => d < today);
            if (user.role !== "admin" && pastDates.length > 0) {
              alert(`Không thể xin nghỉ phép cho các ngày trong quá khứ: ${pastDates.map(d => formatDate(d)).join(", ")}`);
              return;
            }
            const saved = await onCreate({ staffId: Number(staffId), dates, reason });
            if (saved) {
              setDates([]);
              setReason("");
            }
          }}
        >
          <label>
            Nhân sự
            <StaffSearchSelect
              value={staffId}
              options={ownStaff}
              disabled={user.role !== "admin"}
              placeholder="Tìm nhân sự"
              onChange={(value) => {
                setStaffId(value);
                setDates([]);
              }}
            />
          </label>
          <fieldset className="date-checks">
            <legend>Chọn ngày trong tuần</legend>
            {data.days.map((day, index) => {
              const isPast = day < today;
              const capacityReason = selectedDateBlockReason(day);
              const disabledReason = user.role !== "admin" && isPast
                ? "Không thể xin nghỉ phép cho ngày trong quá khứ."
                : capacityReason;
              const disabled = !dates.includes(day) && !!disabledReason;
              return (
                <label
                  key={day}
                  className={`${dates.includes(day) ? "checked" : ""}${disabled ? " disabled" : ""}`}
                  aria-disabled={disabled}
                  title={disabledReason || undefined}
                >
                  <input
                    type="checkbox"
                    checked={dates.includes(day)}
                    disabled={disabled}
                    onChange={(event) => {
                      setDates((prev) =>
                        event.target.checked ? [...prev, day].sort() : prev.filter((item) => item !== day)
                      );
                    }}
                  />
                  <span>{DAYS[index]}</span>
                  <small>
                    {formatDate(day)}{showLunar ? ` - ${formatLunarDate(day)}` : ""}
                    {capacityReason ? ` · ${capacityReason}` : ""}
                  </small>
                </label>
              );
            })}
          </fieldset>
          <label>
            Lý do
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} />
          </label>
          <button type="submit" className="primary-btn" disabled={!staffId || dates.length === 0 || hasBlockedSelectedDate}>
            <Plus size={16} /> Gửi nghỉ phép
          </button>
        </form>
      </section>

      {showMonthCalendar ? (
        <>
          <div className="leave-side-stack">
            {currentWeekPanel}
            {nextWeekPanel}
          </div>
          <div className="leave-side-stack">
            {monthPanel}
            {user.role === "admin"
              ? showPendingApproval && <PendingLeavesPanel requests={pendingLeaves} canApprove onRefresh={onRefresh} />
              : pendingLeaves.length > 0 && <PendingLeavesPanel requests={pendingLeaves} canApprove={false} onRefresh={onRefresh} />}
          </div>
        </>
      ) : (
        <div className="leave-side-stack">
          {pendingLeaves.length > 0 && <PendingLeavesPanel requests={pendingLeaves} canApprove={false} onRefresh={onRefresh} />}
          {currentWeekPanel}
          {nextWeekPanel}
        </div>
      )}
    </main>
  );
}

function PendingLeavesPanel({
  requests,
  canApprove,
  onRefresh
}: {
  requests: PendingLeave[];
  canApprove: boolean;
  onRefresh?: () => void;
}) {
  return (
    <section className="panel leave-pending-panel">
      <PanelTitle icon={<ClipboardList size={17} />} title={`Nghỉ phép chờ duyệt (${requests.length})`} />
      <div className="leave-list pending-leave-list">
        {requests.length === 0 && <span className="empty-note">Không có yêu cầu chờ duyệt.</span>}
        {requests.map((req) => (
          <div className="leave-card pending-leave-card" key={req.id}>
            <div>
              <strong>{req.staffType}. {req.staffName}</strong>
              <span>{req.dates.map((date) => formatDate(date)).join(", ")}</span>
              {req.reason && <small>{req.reason}</small>}
              <span className="status-badge pending">Chờ duyệt</span>
            </div>
            {canApprove && (
              <div className="pending-leave-actions">
                <button
                  type="button"
                  className="primary-btn"
                  onClick={async () => {
                    try {
                      await api.approveLeave(req.id);
                      await onRefresh?.();
                    } catch (error) {
                      alert(error instanceof Error ? error.message : "Duyệt phép thất bại.");
                    }
                  }}
                >
                  Duyệt
                </button>
                <button
                  type="button"
                  className="ghost-danger"
                  onClick={async () => {
                    if (!window.confirm(`Từ chối yêu cầu nghỉ phép của ${req.staffName}?`)) return;
                    try {
                      await api.rejectLeave(req.id);
                      await onRefresh?.();
                    } catch (error) {
                      alert(error instanceof Error ? error.message : "Từ chối phép thất bại.");
                    }
                  }}
                >
                  Từ chối
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function StaffView({
  staff,
  onCreate,
  onToggle,
  onUpdate,
  onDelete
}: {
  staff: Staff[];
  onCreate: (payload: { familyMiddleName: string; name: string; type: StaffType }) => void;
  onToggle: (staff: Staff) => void;
  onUpdate: (id: number, payload: { familyMiddleName: string; name: string; type: StaffType }) => void;
  onDelete: (id: number) => void;
}) {
  const [familyMiddleName, setFamilyMiddleName] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<StaffType>("BS");
  const [editing, setEditing] = useState<Record<number, { familyMiddleName: string; name: string; type: StaffType }>>({});
  return (
    <main className="content-grid">
      <section className="panel">
        <PanelTitle icon={<Users size={17} />} title="Thêm nhân sự" />
        <form
          className="form-inline"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            onCreate({ familyMiddleName: familyMiddleName.trim(), name: name.trim(), type });
            setFamilyMiddleName("");
            setName("");
          }}
        >
          <input
            value={familyMiddleName}
            onChange={(event) => setFamilyMiddleName(event.target.value)}
            placeholder="Họ và tên đệm"
            aria-label="Họ và tên đệm"
          />
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Tên" aria-label="Tên" />
          <select value={type} onChange={(event) => setType(event.target.value as StaffType)}>
            <option value="BS">BS</option>
            <option value="KTV">KTV</option>
            <option value="TKYK">TKYK</option>
          </select>
          <button type="submit" className="primary-btn"><Plus size={16} /> Thêm</button>
        </form>
      </section>
      <section className="panel wide-panel">
        <PanelTitle icon={<ClipboardList size={17} />} title="Danh sách nhân sự" />
        <div className="staff-table" role="table" aria-label="Danh sách nhân sự">
          <div className="staff-table-head" role="row">
            <span role="columnheader">Họ và tên đệm</span>
            <span role="columnheader">Tên</span>
            <span role="columnheader">Loại</span>
            <span role="columnheader">Trạng thái</span>
            <span role="columnheader">Thao tác</span>
          </div>
          {staff.map((item) => (
            <div className="staff-row" role="row" key={item.id}>
              {editing[item.id] ? (
                <>
                  <input
                    value={editing[item.id].familyMiddleName}
                    aria-label={`Họ và tên đệm của ${item.name}`}
                    onChange={(event) => setEditing((prev) => ({ ...prev, [item.id]: { ...prev[item.id], familyMiddleName: event.target.value } }))}
                  />
                  <input
                    value={editing[item.id].name}
                    aria-label={`Tên của ${item.name}`}
                    onChange={(event) => setEditing((prev) => ({ ...prev, [item.id]: { ...prev[item.id], name: event.target.value } }))}
                  />
                  <select
                    value={editing[item.id].type}
                    onChange={(event) => setEditing((prev) => ({ ...prev, [item.id]: { ...prev[item.id], type: event.target.value as StaffType } }))}
                  >
                    <option value="BS">BS</option>
                    <option value="KTV">KTV</option>
                    <option value="TKYK">TKYK</option>
                  </select>
                </>
              ) : (
                <>
                  <span>{item.familyMiddleName || "—"}</span>
                  <strong>{item.name}</strong>
                  <span>{item.type}</span>
                </>
              )}
              <span className={item.active ? "status-ok" : "status-off"}>{item.active ? "Đang dùng" : "Đã tắt"}</span>
              <div className="staff-actions">
                {editing[item.id] ? (
                  <button
                    type="button"
                    className="tool-btn"
                    onClick={() => {
                      const next = editing[item.id];
                      if (next.name.trim()) onUpdate(item.id, {
                        familyMiddleName: next.familyMiddleName.trim(),
                        name: next.name.trim(),
                        type: next.type
                      });
                      setEditing((prev) => {
                        const copy = { ...prev };
                        delete copy[item.id];
                        return copy;
                      });
                    }}
                  >
                    Lưu
                  </button>
                ) : (
                  <button type="button" className="tool-btn" onClick={() => setEditing((prev) => ({
                    ...prev,
                    [item.id]: { familyMiddleName: item.familyMiddleName, name: item.name, type: item.type }
                  }))}>
                    Sửa
                  </button>
                )}
                <button type="button" className="tool-btn" onClick={() => onToggle(item)}>
                  {item.active ? "Tắt" : "Bật"}
                </button>
                <button
                  type="button"
                  className="ghost-danger"
                  onClick={() => {
                    if (window.confirm(`Xóa nhân sự ${item.name}?`)) onDelete(item.id);
                  }}
                >
                  Xóa
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

const toBase64 = (file: File, maxWidth = 240): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Không tạo được context 2D"));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = (error) => reject(error);
    };
    reader.onerror = (error) => reject(error);
  });

function UsersView({
  staff,
  onSaved,
  notify
}: {
  staff: Staff[];
  onSaved: () => void;
  notify: (message: string) => void;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [signature, setSignature] = useState<string | null>(null);
  const [form, setForm] = useState<{ username: string; password: string; role: Role; staffId: number | "" }>({
    username: "",
    password: "",
    role: "bs",
    staffId: ""
  });
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Record<number, { username: string; role: Role; staffId: number | "" }>>({});

  async function load() {
    try {
      setUsers((await api.users()).users);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được tài khoản.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <main className="content-grid">
      <section className="panel">
        <PanelTitle icon={<Shield size={17} />} title="Tạo tài khoản" />
        <form
          className="form-stack"
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            if (roleNeedsStaff(form.role) && !form.staffId) {
              setError("Hãy chọn nhân sự liên kết trước khi tạo tài khoản.");
              return;
            }
            try {
              const res = await api.createUser({
                username: form.username,
                password: form.password,
                role: form.role,
                staffId: roleCanLinkStaff(form.role) ? form.staffId || null : null,
                signature
              });
              setUsers(res.users);
              setForm({ username: "", password: "", role: "bs", staffId: "" });
              setSignature(null);
              onSaved();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Không tạo được tài khoản.");
            }
          }}
        >
          <input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder="Username" />
          <input
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            placeholder="Mật khẩu tối thiểu 6 ký tự"
            type="password"
          />
          <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Role, staffId: "" })}>
            <option value="bs">BS</option>
            <option value="ktv">KTV</option>
            <option value="tkyk">TKYK</option>
            <option value="admin">Admin</option>
          </select>
          {roleCanLinkStaff(form.role) && (
            <StaffSearchSelect
              value={form.staffId}
              options={staffOptionsForRole(staff, form.role)}
              placeholder={roleNeedsStaff(form.role) ? "Chọn nhân sự liên kết (bắt buộc)" : "Chọn nhân sự liên kết (không bắt buộc)"}
              onChange={(value) => setForm({ ...form, staffId: value })}
            />
          )}
          
          <label style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 650, color: "#475569" }}>Chữ ký mẫu (PNG/JPG)</span>
            {signature ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <img src={signature} alt="Chữ ký mẫu" style={{ height: "40px", maxWidth: "120px", objectFit: "contain", border: "1px solid #cbd5e1", background: "#fff", padding: 2 }} />
                <button type="button" className="ghost-danger" onClick={() => setSignature(null)} style={{ minHeight: "32px", padding: "4px 8px" }}>Xóa</button>
              </div>
            ) : (
              <input
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    try {
                      const b64 = await toBase64(file);
                      setSignature(b64);
                    } catch (err) {
                      alert("Lỗi đọc file.");
                    }
                  }
                }}
                style={{ fontSize: "0.85rem", padding: "4px 0", minHeight: "auto", border: "none" }}
              />
            )}
          </label>

          {error && <div className="form-error">{error}</div>}
          <button type="submit" className="primary-btn" disabled={roleNeedsStaff(form.role) && !form.staffId}>
            <Plus size={16} /> Tạo tài khoản
          </button>
        </form>
      </section>
      <section className="panel wide-panel">
        <PanelTitle icon={<Users size={17} />} title="Tài khoản hiện có" />
        <div className="user-table">
          <div className="user-table-head" aria-hidden="true">
            <span>Tài khoản</span>
            <span>Vai trò</span>
            <span>Nhân sự</span>
            <span>Chữ ký</span>
            <span>Mật khẩu</span>
            <span>Thao tác</span>
          </div>
          {users.map((item) => (
            <div className="user-row" key={item.id}>
              {editing[item.id] ? (
                <>
                  <input
                    value={editing[item.id].username}
                    onChange={(event) => setEditing((prev) => ({ ...prev, [item.id]: { ...prev[item.id], username: event.target.value } }))}
                  />
                  <select
                    value={editing[item.id].role}
                    onChange={(event) =>
                      setEditing((prev) => ({ ...prev, [item.id]: { ...prev[item.id], role: event.target.value as Role, staffId: "" } }))
                    }
                  >
                    <option value="bs">BS</option>
                    <option value="ktv">KTV</option>
                    <option value="tkyk">TKYK</option>
                    <option value="admin">Admin</option>
                  </select>
                  {!roleCanLinkStaff(editing[item.id].role) ? (
                    <span>Không liên kết</span>
                  ) : (
                    <StaffSearchSelect
                      value={editing[item.id].staffId}
                      options={staffOptionsForRole(staff, editing[item.id].role)}
                      placeholder={roleNeedsStaff(editing[item.id].role) ? "Tìm nhân sự" : "Tìm nhân sự (không bắt buộc)"}
                      onChange={(value) => setEditing((prev) => ({ ...prev, [item.id]: { ...prev[item.id], staffId: value } }))}
                    />
                  )}
                  <UserSignatureEditor
                    user={item}
                    onUpdated={(nextUsers) => {
                      setUsers(nextUsers);
                      onSaved();
                    }}
                    onError={setError}
                  />
                  <ResetPassword
                    user={item}
                    onDone={(nextUsers) => {
                      setUsers(nextUsers);
                      notify(`Đã đổi mật khẩu cho ${item.username}`);
                    }}
                    onError={setError}
                  />
                  <div className="user-actions">
                    <button
                      type="button"
                      className="tool-btn"
                      onClick={async () => {
                        const next = editing[item.id];
                        const res = await api.updateUser(item.id, {
                          username: next.username.trim(),
                          role: next.role,
                          staffId: roleCanLinkStaff(next.role) ? next.staffId || null : null
                        });
                        setUsers(res.users);
                        setEditing((prev) => {
                          const copy = { ...prev };
                          delete copy[item.id];
                          return copy;
                        });
                        onSaved();
                      }}
                    >
                      Lưu
                    </button>
                    <button
                      type="button"
                      className="ghost-danger"
                      onClick={async () => {
                        if (!window.confirm(`Xóa tài khoản ${item.username}?`)) return;
                        const res = await api.deleteUser(item.id);
                        setUsers(res.users);
                        onSaved();
                      }}
                    >
                      Xóa
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <strong>{item.username}</strong>
                  <span className="user-role">{roleLabel(item.role)}</span>
                  <span>{linkedStaffLabel(item, staff)}</span>
                  <UserSignatureEditor
                    user={item}
                    onUpdated={(nextUsers) => {
                      setUsers(nextUsers);
                      onSaved();
                    }}
                    onError={setError}
                  />
                  <ResetPassword
                    user={item}
                    onDone={(nextUsers) => {
                      setUsers(nextUsers);
                      notify(`Đã đổi mật khẩu cho ${item.username}`);
                    }}
                    onError={setError}
                  />
                  <div className="user-actions">
                    <button
                      type="button"
                      className="tool-btn"
                      onClick={() =>
                        setEditing((prev) => ({
                          ...prev,
                          [item.id]: { username: item.username, role: item.role, staffId: item.staffId || "" }
                        }))
                      }
                    >
                      Sửa
                    </button>
                    <button
                      type="button"
                      className="ghost-danger"
                      onClick={async () => {
                        if (!window.confirm(`Xóa tài khoản ${item.username}?`)) return;
                        const res = await api.deleteUser(item.id);
                        setUsers(res.users);
                        onSaved();
                      }}
                    >
                      Xóa
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function linkedStaffLabel(user: User, staff: Staff[]): string {
  if (!user.staffName) return "Không liên kết";
  const linkedStaff = staff.find((item) => item.id === user.staffId);
  const prefix = linkedStaff?.type || roleLabel(user.role);
  return `${prefix}. ${user.staffName}`;
}

function UserSignatureEditor({
  user,
  onUpdated,
  onError
}: {
  user: User;
  onUpdated: (users: User[]) => void;
  onError: (message: string) => void;
}) {
  const [saving, setSaving] = useState(false);

  async function saveSignature(signature: string | null) {
    setSaving(true);
    onError("");
    try {
      const response = await api.updateUser(user.id, { signature });
      onUpdated(response.users);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Không cập nhật được chữ ký.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="user-signature-cell">
      {user.signature ? (
        <img src={user.signature} alt={`Chữ ký mẫu của ${user.username}`} />
      ) : (
        <span className="signature-empty">Chưa có</span>
      )}
      <div className="user-signature-actions">
        <label className={`tool-btn signature-upload-btn compact-signature-upload ${saving ? "disabled" : ""}`}>
          {saving ? "Đang lưu..." : user.signature ? "Thay ảnh" : "Upload"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={saving}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              try {
                await saveSignature(await toBase64(file, 480));
              } catch {
                onError("Không đọc được ảnh chữ ký.");
              }
            }}
          />
        </label>
        {user.signature && (
          <button type="button" className="ghost-danger compact-signature-delete" disabled={saving} onClick={() => void saveSignature(null)}>
            Xóa
          </button>
        )}
      </div>
    </div>
  );
}

function ResetPassword({
  user,
  onDone,
  onError
}: {
  user: User;
  onDone: (users: User[]) => void;
  onError: (message: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <form
      className="reset-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (password.length < 6) return;
        setSaving(true);
        onError("");
        try {
          const response = await api.updateUser(user.id, { password });
          setPassword("");
          onDone(response.users);
        } catch (error) {
          onError(error instanceof Error ? error.message : "Không đổi được mật khẩu.");
        } finally {
          setSaving(false);
        }
      }}
    >
      <input
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="Mật khẩu mới"
        type="password"
        autoComplete="new-password"
        aria-label={`Mật khẩu mới cho ${user.username}`}
        disabled={saving}
      />
      <button type="submit" className="tool-btn" disabled={saving || password.length < 6}>
        {saving ? "Đang đổi..." : "Đổi"}
      </button>
    </form>
  );
}

function ProfileSettingsView({
  user,
  onUserUpdated,
  notify
}: {
  user: User;
  onUserUpdated: (user: User) => void;
  notify: (message: string) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [signatureError, setSignatureError] = useState("");
  const [signature, setSignature] = useState<string | null>(user.signature ?? null);
  const [savingPassword, setSavingPassword] = useState(false);
  const [savingSignature, setSavingSignature] = useState(false);
  const savedSignature = user.signature ?? null;

  useEffect(() => {
    setSignature(user.signature ?? null);
  }, [user.id, user.signature]);

  return (
    <main className="profile-settings-layout">
      <section className="settings-panel profile-settings-card">
        <div className="settings-panel-title">
          <KeyRound size={20} />
          <span>Đổi mật khẩu</span>
        </div>
        <p className="profile-settings-intro">Nhập mật khẩu hiện tại để bảo vệ tài khoản. Mật khẩu mới cần ít nhất 6 ký tự.</p>
        <form
          className="form-stack profile-settings-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setPasswordError("");
            if (newPassword.length < 6) {
              setPasswordError("Mật khẩu mới cần ít nhất 6 ký tự.");
              return;
            }
            if (newPassword !== confirmPassword) {
              setPasswordError("Mật khẩu xác nhận chưa khớp.");
              return;
            }
            setSavingPassword(true);
            try {
              const response = await api.updateProfile({ currentPassword, newPassword });
              onUserUpdated(response.user);
              setCurrentPassword("");
              setNewPassword("");
              setConfirmPassword("");
              notify("Đã đổi mật khẩu");
            } catch (error) {
              setPasswordError(error instanceof Error ? error.message : "Không đổi được mật khẩu.");
            } finally {
              setSavingPassword(false);
            }
          }}
        >
          <label>
            <span>Mật khẩu hiện tại</span>
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <label>
            <span>Mật khẩu mới</span>
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
            />
          </label>
          <label>
            <span>Nhập lại mật khẩu mới</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
            />
          </label>
          {passwordError && <div className="form-error" role="alert">{passwordError}</div>}
          <button type="submit" className="primary-btn profile-save-btn" disabled={savingPassword}>
            <KeyRound size={16} /> {savingPassword ? "Đang lưu..." : "Đổi mật khẩu"}
          </button>
        </form>
      </section>

      <section className="settings-panel profile-settings-card">
        <div className="settings-panel-title">
          <PenLine size={20} />
          <span>Chữ ký mẫu</span>
        </div>
        <p className="profile-settings-intro">Tải ảnh PNG, JPG hoặc WebP. Ảnh bên dưới là bản xem trước dùng khi ký báo cáo.</p>
        <div className="signature-preview" aria-live="polite">
          {signature ? (
            <img src={signature} alt="Xem trước chữ ký mẫu" />
          ) : (
            <span>Chưa có chữ ký mẫu</span>
          )}
        </div>
        <div className="signature-profile-actions">
          <label className="tool-btn signature-upload-btn">
            Chọn ảnh chữ ký
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                setSignatureError("");
                try {
                  setSignature(await toBase64(file, 480));
                } catch {
                  setSignatureError("Không đọc được ảnh chữ ký.");
                }
              }}
            />
          </label>
          {signature && (
            <button type="button" className="ghost-danger" onClick={() => setSignature(null)}>
              Xóa chữ ký
            </button>
          )}
        </div>
        {signatureError && <div className="form-error" role="alert">{signatureError}</div>}
        <button
          type="button"
          className="primary-btn profile-save-btn"
          disabled={savingSignature || signature === savedSignature}
          onClick={async () => {
            setSignatureError("");
            setSavingSignature(true);
            try {
              const response = await api.updateProfile({ signature });
              onUserUpdated(response.user);
              notify(signature ? "Đã lưu chữ ký mẫu" : "Đã xóa chữ ký mẫu");
            } catch (error) {
              setSignatureError(error instanceof Error ? error.message : "Không lưu được chữ ký mẫu.");
            } finally {
              setSavingSignature(false);
            }
          }}
        >
          <Save size={16} /> {savingSignature ? "Đang lưu..." : "Lưu chữ ký"}
        </button>
      </section>
    </main>
  );
}

function HistoryView({
  data,
  weekStart,
  isAdmin,
  notify
}: {
  data: ScheduleResponse;
  weekStart: string;
  isAdmin: boolean;
  notify: (message: string) => void;
}) {
  const [logs, setLogs] = useState(data.auditLogs);
  const [filters, setFilters] = useState({ actor: "", action: "", q: "" });
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(logs.length / pageSize));
  const visibleLogs = logs.slice((page - 1) * pageSize, page * pageSize);
  const firstVisible = logs.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastVisible = Math.min(page * pageSize, logs.length);

  useEffect(() => {
    setLogs(data.auditLogs);
    setPage(1);
  }, [data.auditLogs]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  async function applyFilters() {
    const res = await api.audit(weekStart, filters);
    setLogs(res.auditLogs);
    setPage(1);
  }

  async function handleClearHistory() {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa toàn bộ lịch sử thay đổi của tuần ${weekStart}?`)) {
      return;
    }
    try {
      await api.clearAudit(weekStart);
      notify("Đã xóa lịch sử thay đổi tuần này!");
      const res = await api.audit(weekStart, filters);
      setLogs(res.auditLogs);
      setPage(1);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Xóa lịch sử thất bại");
    }
  }

  return (
    <main className="panel history-panel">
      <PanelTitle icon={<ClipboardList size={17} />} title="Lịch sử thay đổi tuần" />
      {isAdmin && (
        <form
          className="history-filters"
          onSubmit={(event) => {
            event.preventDefault();
            void applyFilters();
          }}
        >
          <input
            value={filters.actor}
            onChange={(event) => setFilters((prev) => ({ ...prev, actor: event.target.value }))}
            placeholder="Người thao tác"
            aria-label="Lọc theo người thao tác"
          />
          <select
            value={filters.action}
            onChange={(event) => setFilters((prev) => ({ ...prev, action: event.target.value }))}
            aria-label="Lọc theo hành động"
          >
            <option value="">Mọi hành động</option>
            <option value="create">Tạo</option>
            <option value="update">Sửa</option>
            <option value="delete">Xóa</option>
            <option value="swap">Đổi trực</option>
            <option value="move">Đổi lịch trực tiếp</option>
            <option value="approve">Duyệt nghỉ phép</option>
            <option value="reject">Từ chối nghỉ phép</option>
            <option value="apply">Áp dụng tua</option>
            <option value="recalculate">Cập nhật lại</option>
            <option value="login">Đăng nhập</option>
          </select>
          <input
            value={filters.q}
            onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))}
            placeholder="Tìm nội dung"
            aria-label="Tìm nội dung lịch sử"
          />
          <button type="submit" className="tool-btn">Lọc</button>
          <button
            type="button"
            className="tool-btn danger-tool"
            onClick={handleClearHistory}
            style={{ marginLeft: "auto" }}
          >
            <Trash2 size={16} /> Xóa lịch sử tuần này
          </button>
        </form>
      )}
      <div className="history-list">
        {logs.length === 0 && <span className="empty-note">Chưa có thay đổi trong tuần này.</span>}
        {visibleLogs.map((item) => (
          <div className="history-item" key={item.id}>
            <time>{formatDateTime(item.createdAt)}</time>
            <strong>{item.summary}</strong>
            <span>{item.actorUsername || "Hệ thống"}</span>
          </div>
        ))}
      </div>
      {logs.length > 0 && (
        <nav className="history-pagination" aria-label="Phân trang lịch sử thay đổi">
          <span className="history-page-summary">
            Hiển thị {firstVisible}–{lastVisible} / {logs.length}
          </span>
          <div className="history-page-controls">
            <button
              type="button"
              className="tool-btn history-page-btn"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page === 1}
              aria-label="Trang lịch sử trước"
            >
              <ChevronLeft size={17} /> Trước
            </button>
            <span className="history-page-current" aria-live="polite">Trang {page} / {pageCount}</span>
            <button
              type="button"
              className="tool-btn history-page-btn"
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              disabled={page === pageCount}
              aria-label="Trang lịch sử sau"
            >
              Sau <ChevronRight size={17} />
            </button>
          </div>
        </nav>
      )}
    </main>
  );
}

function groupBySection(units: ScheduleUnit[]): Record<string, ScheduleUnit[]> {
  return units.reduce<Record<string, ScheduleUnit[]>>((acc, unit) => {
    (acc[unit.section] ||= []).push(unit);
    return acc;
  }, {});
}

function groupLeaveByRequest(leaveDays: LeaveDay[]) {
  const map = new Map<number, { requestId: number; staffId: number; staffName: string; staffType: string; reason: string | null; dates: string[] }>();
  for (const day of leaveDays) {
    if (!map.has(day.requestId)) {
      map.set(day.requestId, {
        requestId: day.requestId,
        staffId: day.staffId,
        staffName: day.staffName,
        staffType: day.staffType,
        reason: day.reason,
        dates: []
      });
    }
    map.get(day.requestId)!.dates.push(day.date);
  }
  return [...map.values()];
}

function moveId(ids: number[], fromId: number, toId: number): number[] {
  const next = [...ids];
  const from = next.indexOf(fromId);
  const to = next.indexOf(toId);
  if (from < 0 || to < 0 || from === to) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function formatLunarDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const [lunarDay, lunarMonth, lunarYear, leap] = convertSolar2Lunar(day, month, year, 7);
  const yearText = lunarDay === 1 && lunarMonth === 1 ? `/${lunarYear}` : "";
  return `(${lunarDay}/${lunarMonth}${leap ? "N" : ""}${yearText} ÂL)`;
}

function formatWeekLabel(weekStart: string): string {
  const days = getWeekDays(normalizeWeekStart(weekStart));
  return `${formatDate(days[0])} - ${formatDate(days[6])}`;
}

function formatMonthLabel(weekStart: string): string {
  const [year, month] = normalizeWeekStart(weekStart).split("-");
  return `${month}/${year}`;
}

function jdFromDate(dd: number, mm: number, yy: number): number {
  const a = Math.floor((14 - mm) / 12);
  const y = yy + 4800 - a;
  const m = mm + 12 * a - 3;
  let jd = dd + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
  if (jd < 2299161) jd = dd + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - 32083;
  return jd;
}

function newMoon(k: number): number {
  const t = k / 1236.85;
  const t2 = t * t;
  const t3 = t2 * t;
  const dr = Math.PI / 180;
  let jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * t2 - 0.000000155 * t3;
  jd1 += 0.00033 * Math.sin((166.56 + 132.87 * t - 0.009173 * t2) * dr);
  const m = 359.2242 + 29.10535608 * k - 0.0000333 * t2 - 0.00000347 * t3;
  const mpr = 306.0253 + 385.81691806 * k + 0.0107306 * t2 + 0.00001236 * t3;
  const f = 21.2964 + 390.67050646 * k - 0.0016528 * t2 - 0.00000239 * t3;
  let c1 = (0.1734 - 0.000393 * t) * Math.sin(m * dr) + 0.0021 * Math.sin(2 * dr * m);
  c1 -= 0.4068 * Math.sin(mpr * dr) + 0.0161 * Math.sin(2 * dr * mpr);
  c1 -= 0.0004 * Math.sin(3 * dr * mpr);
  c1 += 0.0104 * Math.sin(2 * dr * f) - 0.0051 * Math.sin((m + mpr) * dr);
  c1 -= 0.0074 * Math.sin((m - mpr) * dr) + 0.0004 * Math.sin((2 * f + m) * dr);
  c1 -= 0.0004 * Math.sin((2 * f - m) * dr) - 0.0006 * Math.sin((2 * f + mpr) * dr);
  c1 += 0.001 * Math.sin((2 * f - mpr) * dr) + 0.0005 * Math.sin((2 * mpr + m) * dr);
  const deltaT = t < -11 ? 0.001 + 0.000839 * t + 0.0002261 * t2 - 0.00000845 * t3 - 0.000000081 * t * t3 : -0.000278 + 0.000265 * t + 0.000262 * t2;
  return jd1 + c1 - deltaT;
}

function getNewMoonDay(k: number, timeZone: number): number {
  return Math.floor(newMoon(k) + 0.5 + timeZone / 24);
}

function getSunLongitude(jdn: number, timeZone: number): number {
  const t = (jdn - 2451545.5 - timeZone / 24) / 36525;
  const t2 = t * t;
  const dr = Math.PI / 180;
  const m = 357.5291 + 35999.0503 * t - 0.0001559 * t2 - 0.00000048 * t * t2;
  const l0 = 280.46645 + 36000.76983 * t + 0.0003032 * t2;
  let dl = (1.9146 - 0.004817 * t - 0.000014 * t2) * Math.sin(dr * m);
  dl += (0.019993 - 0.000101 * t) * Math.sin(2 * dr * m) + 0.00029 * Math.sin(3 * dr * m);
  let l = (l0 + dl) * dr;
  l -= Math.PI * 2 * Math.floor(l / (Math.PI * 2));
  return Math.floor((l / Math.PI) * 6);
}

function getLunarMonth11(yy: number, timeZone: number): number {
  const off = jdFromDate(31, 12, yy) - 2415021;
  const k = Math.floor(off / 29.530588853);
  let nm = getNewMoonDay(k, timeZone);
  if (getSunLongitude(nm, timeZone) >= 9) nm = getNewMoonDay(k - 1, timeZone);
  return nm;
}

function getLeapMonthOffset(a11: number, timeZone: number): number {
  const k = Math.floor((a11 - 2415021.076998695) / 29.530588853 + 0.5);
  let last = 0;
  let i = 1;
  let arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
  do {
    last = arc;
    i += 1;
    arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
  } while (arc !== last && i < 14);
  return i - 1;
}

function convertSolar2Lunar(dd: number, mm: number, yy: number, timeZone: number): [number, number, number, number] {
  const dayNumber = jdFromDate(dd, mm, yy);
  const k = Math.floor((dayNumber - 2415021.076998695) / 29.530588853);
  let monthStart = getNewMoonDay(k + 1, timeZone);
  if (monthStart > dayNumber) monthStart = getNewMoonDay(k, timeZone);
  let a11 = getLunarMonth11(yy, timeZone);
  let b11 = a11;
  let lunarYear: number;
  if (a11 >= monthStart) {
    lunarYear = yy;
    a11 = getLunarMonth11(yy - 1, timeZone);
  } else {
    lunarYear = yy + 1;
    b11 = getLunarMonth11(yy + 1, timeZone);
  }
  const lunarDay = dayNumber - monthStart + 1;
  const diff = Math.floor((monthStart - a11) / 29);
  let lunarLeap = 0;
  let lunarMonth = diff + 11;
  if (b11 - a11 > 365) {
    const leapMonthDiff = getLeapMonthOffset(a11, timeZone);
    if (diff >= leapMonthDiff) {
      lunarMonth = diff + 10;
      if (diff === leapMonthDiff) lunarLeap = 1;
    }
  }
  if (lunarMonth > 12) lunarMonth -= 12;
  if (lunarMonth >= 11 && diff < 4) lunarYear -= 1;
  return [lunarDay, lunarMonth, lunarYear, lunarLeap];
}

function formatDateTime(value: string): string {
  return formatVietnamDateTime(value) || value || "—";
}

function exportPng(data: ScheduleResponse | null, showLunar = false) {
  if (!data) return;
  const canvas = document.createElement("canvas");
  const unitWidth = 280;
  const dayWidth = 170;
  const rowHeight = 72;
  const titleHeight = 92;
  const rows = data.units.length;
  canvas.width = unitWidth + dayWidth * 7;
  canvas.height = titleHeight + rowHeight * (rows + 1);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0f172a";
  ctx.font = "700 28px Arial";
  ctx.fillText("LỊCH LÀM VIỆC KHOA", 24, 38);
  ctx.font = "500 16px Arial";
  ctx.fillText("Khoa Chẩn Đoán Hình Ảnh", 24, 60);
  ctx.fillText(formatWeekLabel(data.weekStart), 24, 80);

  let y = titleHeight;
  drawCell(ctx, 0, y, unitWidth, rowHeight, "KHU VỰC", "#0f766e", "#ffffff", true);
  data.days.forEach((day, index) =>
    drawCell(
      ctx,
      unitWidth + index * dayWidth,
      y,
      dayWidth,
      rowHeight,
      `${DAYS[index]}\n${formatDate(day)}${showLunar ? `\n${formatLunarDate(day)}` : ""}`,
      "#0f766e",
      "#ffffff",
      true
    )
  );
  y += rowHeight;

  data.units.forEach((unit) => {
    drawCell(ctx, 0, y, unitWidth, rowHeight, unit.label, sectionColor(unit.section), "#ffffff", true);
    data.days.forEach((day, index) => {
      const text = exportCellText(unit, day, data);
      drawCell(ctx, unitWidth + index * dayWidth, y, dayWidth, rowHeight, text || "-", "#ffffff", "#0f172a", false);
    });
    y += rowHeight;
  });

  const link = document.createElement("a");
  link.download = `lich-truc-cdha-${data.weekStart}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function exportExcel(data: ScheduleResponse | null, showLunar = false) {
  if (!data) return;
  const headerCells = [
    "<th>KHU VỰC</th>",
    ...data.days.map((day, index) => `<th>${escapeHtml(DAYS[index])}<br>${escapeHtml(formatDate(day))}${showLunar ? `<br>${escapeHtml(formatLunarDate(day))}` : ""}</th>`)
  ].join("");
  const bodyRows = data.units.map((unit) => {
    const cells = data.days
      .map((day) => `<td>${escapeHtml(exportCellText(unit, day, data)).replace(/\n/g, "<br>") || "-"}</td>`)
      .join("");
    return `<tr><th>${escapeHtml(unit.label)}</th>${cells}</tr>`;
  }).join("");
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    table { border-collapse: collapse; font-family: Arial, sans-serif; }
    caption { font-size: 18px; font-weight: 700; margin-bottom: 8px; text-align: left; }
    th, td { border: 1px solid #94a3b8; padding: 8px; vertical-align: top; mso-number-format: "\\@"; }
    th { background: #0f766e; color: #ffffff; font-weight: 700; }
    td { min-width: 130px; white-space: normal; }
  </style>
</head>
<body>
  <table>
    <caption>LỊCH LÀM VIỆC KHOA - ${escapeHtml(formatWeekLabel(data.weekStart))}</caption>
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
</body>
</html>`;
  const blob = new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8" });
  downloadBlob(blob, `lich-truc-cdha-${data.weekStart}.xls`);
}

function downloadBlob(blob: Blob, filename: string) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.download = filename;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function exportCellText(unit: ScheduleUnit, date: string, data: ScheduleResponse): string {
  if (unit.type === "duty_common") {
    return data.assignments
      .filter((item) => (item.unitCode === "duty_bs" || item.unitCode === "duty_ktv") && item.date === date)
      .map((item) => `${item.staffType}. ${item.staffName}`)
      .join("\n");
  }
  if (unit.type === "leave") {
    return data.leaveDays
      .filter((item) => item.date === date)
      .map((item) => `${item.staffType}. ${item.staffName}`)
      .join("\n");
  }
  return data.assignments
    .filter((item) => item.unitId === unit.id && item.date === date)
    .map((item) => `${item.staffType}. ${item.staffName}`)
    .join("\n");
}

function drawCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  fill: string,
  color: string,
  bold: boolean
) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "#cbd5e1";
  ctx.strokeRect(x, y, width, height);
  ctx.fillStyle = color;
  ctx.font = `${bold ? "700" : "500"} 15px Arial`;
  const lines = wrapLines(ctx, text, width - 16).slice(0, 3);
  lines.forEach((line, index) => ctx.fillText(line, x + 8, y + 24 + index * 18));
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const rawLine of text.split("\n")) {
    const words = rawLine.split(" ");
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function sectionColor(section: string): string {
  if (section === "I") return "#0f766e";
  if (section === "II") return "#1d4ed8";
  return "#7c3aed";
}

function SettingsView({ units, onRefresh }: { units: ScheduleUnit[]; onRefresh: () => Promise<void> }) {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [blockedDates, setBlockedDates] = useState<string[]>([]);
  const [newDate, setNewDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function loadSettings() {
    try {
      setLoading(true);
      const data = await api.getSettings();
      setSettings({
        approve_leave_bs: data.approve_leave_bs,
        approve_leave_ktv: data.approve_leave_ktv,
        approve_swap: data.approve_swap,
        show_staff_rail: data.show_staff_rail,
        show_leave_month_calendar: data.show_leave_month_calendar
      });
      setBlockedDates(data.blocked_dates);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được cấu hình.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSettings();
  }, []);

  async function toggleSetting(key: keyof SystemSettings) {
    if (!settings) return;
    const nextVal = !settings[key];
    try {
      setError("");
      setSuccess("");
      await api.saveSettings({ [key]: nextVal });
      setSettings((current) => current ? { ...current, [key]: nextVal } : current);
      await onRefresh();
      setSuccess("Cập nhật cài đặt thành công.");
      setTimeout(() => setSuccess(""), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cập nhật thất bại.");
    }
  }

  async function handleAddDate(e: FormEvent) {
    e.preventDefault();
    if (!newDate) return;
    try {
      setError("");
      setSuccess("");
      await api.addBlockedDate(newDate);
      setBlockedDates((prev) => [...prev, newDate].sort());
      setNewDate("");
      setSuccess("Đã thêm ngày không được nghỉ phép.");
      setTimeout(() => setSuccess(""), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thêm được ngày.");
    }
  }

  async function handleDeleteDate(date: string) {
    if (!window.confirm(`Xóa ngày bị khóa nghỉ phép ${date}?`)) return;
    try {
      setError("");
      setSuccess("");
      await api.deleteBlockedDate(date);
      setBlockedDates((prev) => prev.filter((d) => d !== date));
      setSuccess("Đã xóa ngày không được nghỉ phép.");
      setTimeout(() => setSuccess(""), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không xóa được ngày.");
    }
  }

  if (loading) return <div className="settings-panel" style={{padding: 24}}>Đang tải cấu hình...</div>;

  return (
    <main className="content-grid settings-layout">
      <section className="settings-panel">
        <div className="settings-panel-title">
          <Shield size={18} />
          <span>Cấu hình hệ thống</span>
        </div>
        {error && (
          <div className="alert-box error">
            <AlertCircle size={18} className="alert-icon" />
            <span className="alert-message">{error}</span>
          </div>
        )}
        {success && (
          <div className="alert-box success">
            <Check size={18} className="alert-icon" />
            <span className="alert-message">{success}</span>
          </div>
        )}
        {settings && (
          <div className="form-stack">
            <div className="setting-row">
              <div className="setting-info">
                <span className="setting-title">Yêu cầu duyệt nghỉ phép Bác sĩ</span>
                <span className="setting-desc">Mọi yêu cầu nghỉ phép của bác sĩ cần được admin phê duyệt trước khi cập nhật lịch trực.</span>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.approve_leave_bs}
                  onChange={() => toggleSetting("approve_leave_bs")}
                />
                <span className="switch-slider"></span>
              </label>
            </div>

            <div className="setting-row">
              <div className="setting-info">
                <span className="setting-title">Yêu cầu duyệt nghỉ phép Kỹ thuật viên</span>
                <span className="setting-desc">Mọi yêu cầu nghỉ phép của KTV cần được admin phê duyệt trước khi cập nhật lịch trực.</span>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.approve_leave_ktv}
                  onChange={() => toggleSetting("approve_leave_ktv")}
                />
                <span className="switch-slider"></span>
              </label>
            </div>

            <div className="setting-row">
              <div className="setting-info">
                <span className="setting-title">Yêu cầu duyệt đổi trực (xác nhận 2 chiều)</span>
                <span className="setting-desc">Yêu cầu đổi trực phải được nhân sự liên quan xác nhận trước khi admin duyệt.</span>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.approve_swap}
                  onChange={() => toggleSetting("approve_swap")}
                />
                <span className="switch-slider"></span>
              </label>
            </div>

            <div className="setting-row">
              <div className="setting-info">
                <span className="setting-title">Hiển thị thanh nhân sự trên lịch</span>
                <span className="setting-desc">Bật thanh kéo thả nhân sự bên trái màn hình lịch tuần của admin.</span>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.show_staff_rail}
                  onChange={() => toggleSetting("show_staff_rail")}
                />
                <span className="switch-slider"></span>
              </label>
            </div>

            <div className="setting-row">
              <div className="setting-info">
                <span className="setting-title">Hiện lịch phép tháng cho user</span>
                <span className="setting-desc">Cho phép tài khoản nhân sự xem lịch nghỉ phép theo tháng và chuyển qua lại giữa các tháng.</span>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.show_leave_month_calendar}
                  onChange={() => toggleSetting("show_leave_month_calendar")}
                />
                <span className="switch-slider"></span>
              </label>
            </div>
          </div>
        )}
      </section>

      <section className="settings-panel">
        <div className="settings-panel-title">
          <CalendarCheck size={18} />
          <span>Ngày không được nghỉ phép</span>
        </div>
        <form className="form-inline" onSubmit={handleAddDate} style={{marginBottom: 16}}>
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            required
            style={{flex: 1}}
          />
          <button type="submit" className="primary-btn"><Plus size={16} /> Thêm</button>
        </form>

        <div className="blocked-dates-list" style={{display: "grid", gap: 8, maxHeight: 300, overflowY: "auto"}}>
          {blockedDates.length === 0 && <span className="empty-note">Không có ngày nào bị khóa nghỉ phép.</span>}
          {blockedDates.map((date) => (
            <div key={date} className="blocked-date-item">
              <div className="blocked-date-info">
                <div className="blocked-date-icon">
                  <Calendar size={18} />
                </div>
                <div className="blocked-date-text">
                  <span className="blocked-date-formatted">{formatDate(date)}</span>
                  <span className="blocked-date-raw">{date}</span>
                </div>
              </div>
              <button
                type="button"
                className="blocked-date-delete"
                onClick={() => handleDeleteDate(date)}
                title="Xóa ngày này"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="settings-panel wide-panel">
        <div className="settings-panel-title">
          <ClipboardList size={18} />
          <span>Quản lý phòng/việc làm việc</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 24, marginTop: 16 }}>
          {/* Section: BS Work Units */}
          <div>
            <h3 style={{ fontSize: "0.95rem", fontWeight: 700, color: "#334155", marginBottom: 12, borderBottom: "2px solid #e2e8f0", paddingBottom: 6 }}>
              Lịch làm việc Bác sĩ (Phần II)
            </h3>
            <UnitManagerList
              units={units.filter((u) => u.type === "work_bs")}
              type="work_bs"
              onRefresh={onRefresh}
            />
          </div>

          {/* Section: KTV Work Units */}
          <div>
            <h3 style={{ fontSize: "0.95rem", fontWeight: 700, color: "#334155", marginBottom: 12, borderBottom: "2px solid #e2e8f0", paddingBottom: 6 }}>
              Lịch làm việc KTV (Phần III)
            </h3>
            <UnitManagerList
              units={units.filter((u) => u.type === "work_ktv")}
              type="work_ktv"
              onRefresh={onRefresh}
            />
          </div>
        </div>
      </section>
    </main>
  );
}

function UnitManagerList({
  units,
  type,
  onRefresh
}: {
  units: ScheduleUnit[];
  type: "work_bs" | "work_ktv";
  onRefresh: () => Promise<void>;
}) {
  const [newLabel, setNewLabel] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!newLabel.trim()) return;
    try {
      setLoading(true);
      setError("");
      await api.createUnit({ label: newLabel.trim(), type });
      setNewLabel("");
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thêm được.");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveEdit = async (id: number) => {
    if (!editingLabel.trim()) return;
    try {
      setLoading(true);
      setError("");
      await api.updateUnit(id, { label: editingLabel.trim() });
      setEditingId(null);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không lưu được.");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number, label: string) => {
    if (!window.confirm(`Xóa phòng/việc "${label}"? Tất cả phân công trực liên quan cũng sẽ bị xóa.`)) {
      return;
    }
    try {
      setLoading(true);
      setError("");
      await api.deleteUnit(id);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không xóa được.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {error && <div className="form-error" style={{ margin: 0 }}>{error}</div>}

      <form className="form-inline" onSubmit={handleAdd}>
        <input
          type="text"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Tên phòng/việc mới..."
          required
          disabled={loading}
          style={{ flex: 1 }}
        />
        <button type="submit" className="primary-btn" disabled={loading}>
          <Plus size={16} /> Thêm
        </button>
      </form>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 350, overflowY: "auto", paddingRight: 4 }}>
        {units.length === 0 && <span className="empty-note">Không có phòng/việc nào.</span>}
        {units.map((unit) => (
          <div key={unit.id} className="blocked-date-item" style={{ minHeight: "52px", padding: "8px 12px" }}>
            {editingId === unit.id ? (
              <div style={{ display: "flex", gap: 8, width: "100%", alignItems: "center" }}>
                <input
                  type="text"
                  value={editingLabel}
                  onChange={(e) => setEditingLabel(e.target.value)}
                  style={{ flex: 1, minHeight: "36px" }}
                  required
                />
                <button
                  type="button"
                  className="tool-btn"
                  onClick={() => handleSaveEdit(unit.id)}
                  disabled={loading}
                  style={{ minHeight: "36px" }}
                >
                  Lưu
                </button>
                <button
                  type="button"
                  className="ghost-danger"
                  onClick={() => setEditingId(null)}
                  disabled={loading}
                  style={{ minHeight: "36px" }}
                >
                  Hủy
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                <span style={{ fontWeight: 650, color: "#1e293b" }}>{unit.label}</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    className="tool-btn"
                    onClick={() => {
                      setEditingId(unit.id);
                      setEditingLabel(unit.label);
                    }}
                    style={{ minHeight: "32px", padding: "4px 8px" }}
                  >
                    Sửa
                  </button>
                  <button
                    type="button"
                    className="blocked-date-delete"
                    onClick={() => handleDelete(unit.id, unit.label)}
                    style={{ minHeight: "32px", width: "32px", display: "flex", alignItems: "center", justifyContent: "center" }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

import type { SwapRequest as TSwapRequest } from "../shared/types";

function SwapAcceptScreen({ token, onDone }: { token: string; onDone: () => void }) {
  const [request, setRequest] = useState<TSwapRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function loadRequest() {
    try {
      setLoading(true);
      setError("");
      const data = await api.getSwapRequest(token);
      setRequest(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được yêu cầu đổi trực.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRequest();
  }, [token]);

  async function handleAccept() {
    try {
      setError("");
      setSuccess("");
      await api.acceptSwap(token);
      setSuccess("Đã đồng ý đổi trực thành công!");
      await loadRequest();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đồng ý đổi trực thất bại.");
    }
  }

  async function handleReject() {
    if (!window.confirm("Từ chối yêu cầu đổi trực này?")) return;
    try {
      setError("");
      setSuccess("");
      await api.rejectSwap(token);
      setSuccess("Đã từ chối đổi trực.");
      await loadRequest();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Từ chối đổi trực thất bại.");
    }
  }

  if (loading) return <div className="boot">Đang tải thông tin yêu cầu đổi trực...</div>;

  return (
    <main className="login-page">
      <div className="login-card" style={{ width: "min(500px, 100%)" }}>
        <img
          className="brand-mark large"
          src="https://bvtn.org.vn/wp-content/uploads/2023/12/logo-bvtn-148x148.png.webp"
          alt="Logo BVTN"
          style={{ objectFit: "contain", background: "transparent", margin: "0 auto 18px" }}
        />
        <h1 style={{textAlign: "center", fontSize: "1.5rem"}}>XÁC NHẬN ĐỔI TRỰC</h1>
        <p style={{textAlign: "center", marginBottom: 20}}>Hệ thống xếp lịch khoa CDHA</p>

        {error && <div className="form-error" style={{marginTop: 16, marginBottom: 16}} role="alert">{error}</div>}
        {success && <div className="form-success" style={{color: "var(--ok)", fontWeight: "bold", marginTop: 16, marginBottom: 16, textAlign: "center"}}>{success}</div>}

        {request && (() => {
          const type1 = request.unitLabel1.toUpperCase().includes("KTV") ? "KTV" : "BS";
          const type2 = request.unitLabel2.toUpperCase().includes("KTV") ? "KTV" : "BS";
          const dow1 = getDayOfWeekLabel(request.date1);
          const dow2 = getDayOfWeekLabel(request.date2);
          return (
            <div style={{ display: "grid", gap: 16 }}>
              <div className="leave-card" style={{ borderLeft: "4px solid var(--primary)", paddingLeft: 12 }}>
                <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>Người yêu cầu</p>
                <strong style={{ fontSize: "1.05rem" }}>{type1}. {request.staffName1}</strong>
                <p style={{ margin: "4px 0 0", fontSize: "0.9rem" }}>Trực {dow1} ngày {formatDate(request.date1)}</p>
              </div>

              <div style={{ display: "flex", justifyContent: "center", color: "var(--muted)", margin: "4px 0" }}>
                <ArrowLeftRight size={24} />
              </div>

              <div className="leave-card" style={{ borderLeft: "4px solid var(--violet)", paddingLeft: 12 }}>
                <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>Người được đổi (Bạn)</p>
                <strong style={{ fontSize: "1.05rem" }}>{type2}. {request.staffName2}</strong>
                <p style={{ margin: "4px 0 0", fontSize: "0.9rem" }}>Trực {dow2} ngày {formatDate(request.date2)}</p>
              </div>

              <div style={{ marginTop: 12, padding: "12px 0", borderTop: "1px solid var(--line)" }}>
                <p style={{margin: 0}}>Trạng thái:{" "}
                  {request.status === "pending" && <span style={{ color: "#d97706", fontWeight: "bold" }}>Chờ bạn xác nhận</span>}
                  {request.status === "approved" && <span style={{ color: "var(--ok)", fontWeight: "bold" }}>Đã đồng ý đổi</span>}
                  {request.status === "rejected" && <span style={{ color: "var(--danger)", fontWeight: "bold" }}>Đã từ chối đổi</span>}
                </p>
              </div>

              {request.status === "pending" && !success && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
                  <button type="button" className="tool-btn" onClick={handleReject} style={{minHeight: 44}}>Từ chối</button>
                  <button type="button" className="primary-btn" style={{ background: "var(--ok)", borderColor: "var(--ok)", minHeight: 44 }} onClick={handleAccept}>Đồng ý đổi</button>
                </div>
              )}

              <button type="button" className="tool-btn" style={{ marginTop: 12, width: "100%", minHeight: 44 }} onClick={onDone}>
                Về trang xếp lịch
              </button>
            </div>
          );
        })()}
      </div>
    </main>
  );
}

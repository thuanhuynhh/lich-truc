import {
  ArrowLeftRight,
  Bell,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  ListOrdered,
  LogOut,
  PenLine,
  RefreshCw,
  Shield,
  Trash2
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { ScheduleView } from "./ScheduleView";
import { PositionsManager, RotationDialog, WorkDaysView } from "./ScheduleTools";
import { DepartmentsView, HistoryView, ProfileView, SettingsView, UsersView } from "./AdminViews";
import { ReportView } from "./ReportView";
import { APP_TITLE, exportExcel, exportPng } from "./scheduleExport";
import type {
  Assignment,
  CoordinatorAssignment,
  NotificationItem,
  Position,
  ScheduleResponse,
  Section,
  SwapRequest,
  User,
  WorkDay
} from "../shared/types";
import {
  addMonths,
  currentMonthInVietnam,
  formatFullDate,
  formatMonthLabel,
  formatVietnamDateTime,
  normalizeMonth
} from "../shared/schedule";
import { canManageSchedule, roleLabel } from "../shared/validation";

type View = "schedule" | "workdays" | "report" | "departments" | "users" | "history" | "settings" | "profile";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loginError, setLoginError] = useState("");
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => currentMonthInVietnam());
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [view, setView] = useState<View>("schedule");
  const [toast, setToast] = useState("");
  const [showLunar, setShowLunar] = useState(false);
  const [rotationPosition, setRotationPosition] = useState<Position | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [reportNavigation, setReportNavigation] = useState<{ date: string; requestId: number } | null>(null);
  const [pendingSwapLink, setPendingSwapLink] = useState<string | null>(null);
  const [swapToken, setSwapToken] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("swapToken")
  );

  const tableRef = useRef<HTMLDivElement | null>(null);
  const refreshSequence = useRef(0);
  const currentMonthRef = useRef(month);
  const currentUserRef = useRef<User | null>(user);
  currentMonthRef.current = month;
  currentUserRef.current = user;

  const isAdmin = user?.role === "admin";
  const canSchedule = !!user && canManageSchedule(user.role);

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
      void refresh(month, user.id).catch((error) => {
        notify(error instanceof Error ? error.message : "Không thể tải lịch.");
      });
    }
  }, [user, month]);

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
      // Lỗi tải thông báo không được làm gián đoạn việc xem lịch.
    } finally {
      if (showLoading) setNotificationsLoading(false);
    }
  }

  async function refresh(targetMonth = month, targetUserId = user?.id) {
    const sequence = ++refreshSequence.current;
    const response = await api.schedule(targetMonth);
    if (
      sequence === refreshSequence.current &&
      targetMonth === currentMonthRef.current &&
      targetUserId === currentUserRef.current?.id
    ) {
      setData(response);
    }
  }

  function clearUserScopedState() {
    refreshSequence.current += 1;
    setData(null);
    setView("schedule");
    setRotationPosition(null);
    setNotifications([]);
    setNotificationsOpen(false);
    setReportNavigation(null);
    setPendingSwapLink(null);
  }

  if (loading) return <div className="boot">Đang tải ứng dụng...</div>;

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
        notify={notify}
        onDone={() => {
          setSwapToken(null);
          const url = new URL(window.location.href);
          url.searchParams.delete("swapToken");
          window.history.replaceState({}, document.title, url.pathname + url.search);
          void refresh();
          void refreshNotifications(false);
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-top">
          <div className="brand">
            <img
              className="brand-mark"
              src="/favicon.png"
              alt="Logo Bệnh viện Thống Nhất"
              style={{ objectFit: "contain", background: "transparent" }}
            />
            <div>
              <h1>{APP_TITLE}</h1>
              <p>{user.departmentName ? `${roleLabel(user.role)} · ${user.departmentName}` : roleLabel(user.role)}</p>
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
              <LogOut size={16} /> <span className="avatar-name">{user.fullName || user.username}</span>
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
                  setNotifications((await api.markNotificationRead(item.id)).notifications);
                } catch (error) {
                  notify(error instanceof Error ? error.message : "Không đánh dấu được thông báo.");
                } finally {
                  setNotificationsLoading(false);
                }
              }}
              onMarkAllRead={async () => {
                setNotificationsLoading(true);
                try {
                  setNotifications((await api.markAllNotificationsRead()).notifications);
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
                  await api.acceptCoordinatorSwap(item.swapToken);
                  await Promise.all([refreshNotifications(false), refresh()]);
                  notify("Đã đồng ý đổi ngày làm");
                } catch (error) {
                  notify(error instanceof Error ? error.message : "Đồng ý đổi ngày làm thất bại.");
                } finally {
                  setNotificationsLoading(false);
                }
              }}
              onRejectSwap={async (item) => {
                if (!item.swapToken || !window.confirm("Từ chối yêu cầu đổi ngày làm này?")) return;
                setNotificationsLoading(true);
                try {
                  await api.rejectCoordinatorSwap(item.swapToken);
                  await refreshNotifications(false);
                  notify("Đã từ chối đổi ngày làm");
                } catch (error) {
                  notify(error instanceof Error ? error.message : "Từ chối đổi ngày làm thất bại.");
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
                if (item.actionDate) {
                  setMonth(normalizeMonth(item.actionDate));
                  if (item.actionView === "report") {
                    setReportNavigation((current) => ({
                      date: item.actionDate as string,
                      requestId: (current?.requestId || 0) + 1
                    }));
                  }
                }
                if (item.actionView === "report") setView("report");
                else if (item.actionView === "schedule") setView("schedule");
              }}
            />
          </div>
        </div>

        <div className="header-controls">
          <div className="week-tools" aria-label="Điều hướng tháng">
            <button
              type="button"
              className="icon-btn"
              onClick={() => setMonth(addMonths(month, -1))}
              aria-label="Tháng trước"
            >
              <ChevronLeft size={18} />
            </button>
            <button type="button" className="week-pill" onClick={() => setMonth(currentMonthInVietnam())}>
              {formatMonthLabel(month)}
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setMonth(addMonths(month, 1))}
              aria-label="Tháng sau"
            >
              <ChevronRight size={18} />
            </button>
            <label className="toggle-pill">
              <input type="checkbox" checked={showLunar} onChange={(event) => setShowLunar(event.target.checked)} />
              <span className="lunar-text-desktop">Âm lịch</span>
              <span className="lunar-text-mobile">ÂL</span>
            </label>
          </div>

          <div className="header-actions">
            <button
              type="button"
              className="icon-btn"
              title="Tải lại lịch"
              onClick={() => void run(() => refresh(), "Đã cập nhật lịch")}
              aria-label="Tải lại lịch"
            >
              <RefreshCw size={16} />
            </button>
            {canSchedule && (
              <button
                type="button"
                className="tool-btn"
                title="Áp tua của mọi vị trí cho tháng đang xem"
                onClick={() => {
                  if (!window.confirm(`Áp tua của mọi vị trí cho ${formatMonthLabel(month).toLowerCase()}?`)) return;
                  void run(async () => {
                    const result = await api.applyRotation(null, { month });
                    await refresh();
                    notify(`Đã áp tua: ${result.created} phân công, giữ lại ${result.restored} người đã điền`);
                  });
                }}
              >
                <ListOrdered size={16} /> <span className="btn-text">Áp tua tất cả</span>
              </button>
            )}
            {canSchedule && (
              <button
                type="button"
                className="icon-btn danger-tool"
                title="Xóa toàn bộ phân công tháng này"
                aria-label="Xóa toàn bộ phân công tháng này"
                onClick={() => {
                  if (!window.confirm(`Xóa toàn bộ phân công khoa phòng của ${formatMonthLabel(month).toLowerCase()}?`)) {
                    return;
                  }
                  void run(async () => {
                    const result = await api.clearSchedule({ month });
                    await refresh();
                    notify(`Đã xóa ${result.deleted} phân công`);
                  });
                }}
              >
                <Trash2 size={16} />
              </button>
            )}
            <button
              type="button"
              className="tool-btn"
              title="Xuất PNG"
              onClick={() => exportPng(data, showLunar)}
              disabled={!data}
            >
              <Download size={16} /> <span className="btn-text">Xuất PNG</span>
            </button>
            {canSchedule && (
              <button
                type="button"
                className="tool-btn"
                title="Xuất Excel"
                onClick={() => exportExcel(data, showLunar)}
                disabled={!data}
              >
                <FileSpreadsheet size={16} /> <span className="btn-text">Excel</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <nav className="tabs" aria-label="Khu vực chức năng">
        <Tab id="schedule" view={view} setView={setView} label="Lịch khám" icon={<CalendarDays size={15} />} />
        {canSchedule && <Tab id="workdays" view={view} setView={setView} label="Ngày làm việc" />}
        <Tab
          id="report"
          view={view}
          setView={(nextView) => {
            setReportNavigation(null);
            setView(nextView);
          }}
          label="Báo cáo làm việc"
          icon={<PenLine size={15} />}
        />
        {isAdmin && <Tab id="departments" view={view} setView={setView} label="Khoa phòng" icon={<Building2 size={15} />} />}
        {isAdmin && <Tab id="users" view={view} setView={setView} label="Tài khoản" icon={<Shield size={15} />} />}
        <Tab id="history" view={view} setView={setView} label="Lịch sử" />
        {isAdmin && <Tab id="settings" view={view} setView={setView} label="Cấu hình" />}
        <Tab id="profile" view={view} setView={setView} label="Cá nhân" />
      </nav>

      {view === "schedule" && data && (
        <main className="main-grid schedule-only">
          <section className="schedule-area">
            <ScheduleView
              data={data}
              user={user}
              showLunar={showLunar}
              tableRef={tableRef}
              onAddAssignment={(positionId, date, departmentId) =>
                void run(async () => {
                  await api.putAssignment({ positionId, date, departmentId });
                  await refresh();
                }, "Đã thêm phân công")
              }
              onDeleteAssignment={(assignment: Assignment, position: Position) => {
                if (
                  !window.confirm(
                    `Xóa phân công ${assignment.departmentName} ở ${position.label} ngày ${formatFullDate(assignment.date)}?`
                  )
                ) {
                  return;
                }
                void run(async () => {
                  await api.deleteAssignment(assignment.id);
                  await refresh();
                }, "Đã xóa phân công");
              }}
              onMoveAssignment={(assignmentId, positionId, date) =>
                void run(async () => {
                  await api.moveAssignment(assignmentId, { positionId, date });
                  await refresh();
                }, "Đã chuyển phân công")
              }
              onOpenRotation={setRotationPosition}
              onApplyRotation={(position) => {
                if (!window.confirm(`Áp tua của ${position.label} cho ${formatMonthLabel(month).toLowerCase()}?`)) return;
                void run(async () => {
                  const result = await api.applyRotation(position.id, { month });
                  await refresh();
                  notify(`Đã áp tua ${position.label}: ${result.created} phân công, giữ lại ${result.restored} người đã điền`);
                });
              }}
              onSavePerson={(assignment, personName, personPhone) =>
                run(async () => {
                  await api.updateAssignmentPerson(assignment.id, { personName, personPhone });
                  await refresh();
                }, "Đã lưu người làm việc")
              }
              onAddCoordinator={(date, userId) =>
                void run(async () => {
                  await api.putCoordinatorAssignment({ date, userId });
                  await refresh();
                }, "Đã xếp điều phối")
              }
              onDeleteCoordinator={(item: CoordinatorAssignment) => {
                if (!window.confirm(`Bỏ điều phối ${item.fullName || item.username} ngày ${formatFullDate(item.date)}?`)) {
                  return;
                }
                void run(async () => {
                  await api.deleteCoordinatorAssignment(item.id);
                  await refresh();
                }, "Đã bỏ điều phối");
              }}
              onMoveCoordinator={(id, date) =>
                void run(async () => {
                  await api.moveCoordinatorAssignment(id, { date });
                  await refresh();
                }, "Đã chuyển điều phối")
              }
              onRequestSwap={(source, target) =>
                void run(async () => {
                  const res = await api.requestCoordinatorSwap({
                    assignmentId: source.id,
                    targetAssignmentId: target.id
                  });
                  await refresh();
                  if (res?.pending && res?.token) {
                    setPendingSwapLink(`${window.location.origin}/?swapToken=${res.token}`);
                  } else {
                    notify("Đã đổi ngày làm");
                  }
                })
              }
            />
          </section>
        </main>
      )}

      {view === "workdays" && data && canSchedule && (
        <WorkDaysView
          data={data}
          onCreate={(payload) =>
            run(async () => {
              await api.createWorkDay(payload);
              await refresh();
            }, "Đã thêm ngày làm")
          }
          onUpdate={(date, payload) =>
            void run(async () => {
              await api.updateWorkDay(date, payload);
              await refresh();
            }, "Đã cập nhật ngày làm")
          }
          onDelete={(workDay: WorkDay) => {
            if (
              !window.confirm(
                `Xóa ngày làm ${formatFullDate(workDay.date)}? Toàn bộ phân công và báo cáo của ngày này sẽ bị xóa theo.`
              )
            ) {
              return;
            }
            void run(async () => {
              await api.deleteWorkDay(workDay.date);
              await refresh();
            }, "Đã xóa ngày làm");
          }}
        />
      )}

      {view === "report" && (
        <ReportView
          key={reportNavigation?.requestId || "default"}
          user={user}
          notify={notify}
          navigationTarget={reportNavigation}
        />
      )}

      {view === "departments" && isAdmin && data && (
        <DepartmentsView
          departments={data.departments}
          onCreate={(payload) =>
            run(async () => {
              await api.createDepartment(payload);
              await refresh();
            }, "Đã thêm khoa phòng")
          }
          onUpdate={(id, payload) =>
            void run(async () => {
              await api.updateDepartment(id, payload);
              await refresh();
            }, "Đã cập nhật khoa phòng")
          }
          onDelete={(department) => {
            if (!window.confirm(`Xóa khoa phòng ${department.name}? Mọi phân công của khoa phòng này sẽ bị xóa.`)) return;
            void run(async () => {
              await api.deleteDepartment(department.id);
              await refresh();
            }, "Đã xóa khoa phòng");
          }}
        />
      )}

      {view === "users" && isAdmin && data && (
        <UsersView departments={data.departments} onSaved={() => void refresh()} notify={notify} />
      )}

      {view === "history" && data && (
        <HistoryView data={data} month={month} isAdmin={isAdmin} notify={notify} />
      )}

      {view === "settings" && isAdmin && (
        <SettingsView
          notify={notify}
          positionsManager={
            data && (
              <PositionsManager
                sections={data.sections}
                positions={data.positions}
                onCreateSection={(label) =>
                  run(async () => {
                    await api.createSection({ label });
                    await refresh();
                  }, "Đã thêm mục")
                }
                onUpdateSection={(id, payload) =>
                  void run(async () => {
                    await api.updateSection(id, payload);
                    await refresh();
                  })
                }
                onDeleteSection={(section: Section) => {
                  if (!window.confirm(`Xóa mục ${section.label}? Mọi vị trí khám trong mục sẽ bị xóa theo.`)) return;
                  void run(async () => {
                    await api.deleteSection(section.id);
                    await refresh();
                  }, "Đã xóa mục");
                }}
                onCreatePosition={(sectionId, label) =>
                  run(async () => {
                    await api.createPosition({ sectionId, label });
                    await refresh();
                  }, "Đã thêm vị trí khám")
                }
                onUpdatePosition={(id, payload) =>
                  void run(async () => {
                    await api.updatePosition(id, payload);
                    await refresh();
                  })
                }
                onDeletePosition={(position: Position) => {
                  if (
                    !window.confirm(
                      `Xóa vị trí ${position.label}? Toàn bộ phân công và tua của vị trí này sẽ bị xóa theo.`
                    )
                  ) {
                    return;
                  }
                  void run(async () => {
                    await api.deletePosition(position.id);
                    await refresh();
                  }, "Đã xóa vị trí khám");
                }}
              />
            )
          }
        />
      )}

      {view === "profile" && (
        <ProfileView
          user={user}
          onUserUpdated={(next) => {
            setUser(next);
            notify("Đã cập nhật thông tin");
          }}
          notify={notify}
        />
      )}

      {rotationPosition && data && (
        <RotationDialog
          month={month}
          position={rotationPosition}
          departments={data.departments}
          rotation={data.rotations.find((item) => item.positionId === rotationPosition.id) || null}
          workDayCount={data.workDays.length}
          onClose={() => setRotationPosition(null)}
          onSave={(payload) =>
            void run(async () => {
              await api.saveRotation(rotationPosition.id, payload);
              await refresh();
            }, `Đã lưu tua ${rotationPosition.label}`)
          }
          onApply={(payload) =>
            void run(async () => {
              await api.saveRotation(rotationPosition.id, payload);
              const result = await api.applyRotation(rotationPosition.id, { month });
              await refresh();
              setRotationPosition(null);
              notify(`Đã áp tua ${rotationPosition.label}: ${result.created} phân công, giữ lại ${result.restored} người đã điền`);
            })
          }
        />
      )}

      {pendingSwapLink && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-panel" style={{ maxWidth: 500 }}>
            <div className="modal-head">
              <h2>Yêu cầu đổi ngày làm chờ duyệt</h2>
              <button type="button" className="icon-btn" onClick={() => setPendingSwapLink(null)}>×</button>
            </div>
            <div style={{ padding: "16px 0", display: "grid", gap: 12 }}>
              <p>
                Hệ thống đã tạo yêu cầu đổi ngày làm ở trạng thái <strong>Chờ duyệt</strong>. Đối phương sẽ thấy yêu cầu
                trong phần thông báo, hoặc bạn có thể gửi trực tiếp link dưới đây:
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  readOnly
                  value={pendingSwapLink}
                  onClick={(event) => (event.target as HTMLInputElement).select()}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => {
                    void navigator.clipboard.writeText(pendingSwapLink);
                    notify("Đã copy link!");
                  }}
                >
                  Copy
                </button>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="primary-btn" onClick={() => setPendingSwapLink(null)}>Đóng</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function Tab({
  id,
  view,
  setView,
  label,
  icon
}: {
  id: View;
  view: View;
  setView: (view: View) => void;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <button type="button" className={view === id ? "active" : ""} onClick={() => setView(id)}>
      {icon}
      {label}
    </button>
  );
}

function LoginScreen({
  error,
  onSubmit
}: {
  error: string;
  onSubmit: (username: string, password: string) => Promise<void>;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  return (
    <main className="login-page">
      <form
        className="login-card"
        onSubmit={async (event: FormEvent) => {
          event.preventDefault();
          setSubmitting(true);
          await onSubmit(username.trim(), password);
          setSubmitting(false);
        }}
      >
        <img
          className="brand-mark large"
          src="/favicon.png"
          alt="Logo Bệnh viện Thống Nhất"
          style={{ objectFit: "contain", background: "transparent" }}
        />
        <h1>{APP_TITLE}</h1>
        <p>Đăng nhập để xem và cập nhật lịch khám.</p>
        <label>
          Tên đăng nhập
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </label>
        <label>
          Mật khẩu
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button type="submit" className="primary-btn wide" disabled={submitting}>
          {submitting ? "Đang đăng nhập..." : "Đăng nhập"}
        </button>
      </form>
    </main>
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
        aria-label={unreadCount ? `Thông báo, ${unreadCount} mục chưa đọc` : "Thông báo"}
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
              <span>{loading ? "Đang tải..." : `${unreadCount} mục chưa đọc`}</span>
            </div>
            {items.length > 0 && (
              <button type="button" className="tool-btn mini-btn" onClick={() => void onMarkAllRead()}>
                Đọc tất cả
              </button>
            )}
          </div>
          <div className="notification-list">
            {items.length === 0 && <div className="empty-list-text">Không có thông báo nào.</div>}
            {items.map((item) => (
              <div key={item.id} className={`notification-item${item.read ? "" : " unread"}`}>
                <button type="button" className="notification-item-main" onClick={() => onSelect(item)}>
                  <strong>{item.title}</strong>
                  <span>{item.message}</span>
                  <time>{formatVietnamDateTime(item.createdAt) || item.createdAt}</time>
                </button>
                <div className="notification-item-actions">
                  {item.swapToken ? (
                    <>
                      <button type="button" className="tool-btn mini-btn" onClick={() => void onAcceptSwap(item)}>
                        <ArrowLeftRight size={13} /> Đồng ý
                      </button>
                      <button type="button" className="ghost-danger mini-btn" onClick={() => void onRejectSwap(item)}>
                        Từ chối
                      </button>
                    </>
                  ) : (
                    !item.read && (
                      <button type="button" className="tool-btn mini-btn" onClick={() => void onMarkRead(item)}>
                        Đã đọc
                      </button>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SwapAcceptScreen({
  token,
  notify,
  onDone
}: {
  token: string;
  notify: (message: string) => void;
  onDone: () => void;
}) {
  const [swap, setSwap] = useState<SwapRequest | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    api
      .getCoordinatorSwap(token)
      .then((res) => setSwap(res.swap))
      .catch((err) => setError(err instanceof Error ? err.message : "Không tải được yêu cầu đổi ngày làm."));
  }, [token]);

  return (
    <main className="login-page">
      <div className="login-card" style={{ maxWidth: 520 }}>
        <img
          className="brand-mark large"
          src="/favicon.png"
          alt="Logo Bệnh viện Thống Nhất"
          style={{ objectFit: "contain", background: "transparent" }}
        />
        <h1>Yêu cầu đổi ngày làm</h1>
        {error && <div className="form-error" role="alert">{error}</div>}
        {!swap && !error && <p>Đang tải yêu cầu...</p>}
        {swap && (
          <>
            <p>
              <strong>{swap.name1}</strong> đang làm ngày <strong>{formatFullDate(swap.date1)}</strong> muốn đổi với{" "}
              <strong>{swap.name2}</strong> ngày <strong>{formatFullDate(swap.date2)}</strong>.
            </p>
            <p>
              Trạng thái:{" "}
              <strong>
                {swap.status === "pending"
                  ? "Chờ duyệt"
                  : swap.status === "approved"
                    ? "Đã đồng ý"
                    : swap.status === "rejected"
                      ? "Đã từ chối"
                      : "Đã hủy"}
              </strong>
            </p>
            {swap.status === "pending" && (
              <div className="modal-actions">
                <button
                  type="button"
                  className="primary-btn"
                  disabled={working}
                  onClick={async () => {
                    setWorking(true);
                    try {
                      await api.acceptCoordinatorSwap(token);
                      notify("Đã đồng ý đổi ngày làm");
                      onDone();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Đồng ý thất bại.");
                    } finally {
                      setWorking(false);
                    }
                  }}
                >
                  Đồng ý đổi
                </button>
                <button
                  type="button"
                  className="ghost-danger"
                  disabled={working}
                  onClick={async () => {
                    setWorking(true);
                    try {
                      await api.rejectCoordinatorSwap(token);
                      notify("Đã từ chối đổi ngày làm");
                      onDone();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Từ chối thất bại.");
                    } finally {
                      setWorking(false);
                    }
                  }}
                >
                  Từ chối
                </button>
              </div>
            )}
          </>
        )}
        <button type="button" className="tool-btn wide" onClick={onDone}>Về trang lịch</button>
      </div>
    </main>
  );
}

import React, { useEffect, useState } from "react";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  KeyRound,
  PenLine,
  Plus,
  Save,
  Shield,
  Sliders,
  Trash2,
  Users
} from "lucide-react";
import { api } from "./api";
import { PanelTitle, toBase64 } from "./common";
import type { AuditLog, Department, Role, ScheduleResponse, SystemSettings, User } from "../shared/types";
import { formatVietnamDateTime } from "../shared/schedule";
import { roleLabel } from "../shared/validation";

const ROLES: Role[] = ["admin", "dieu_phoi", "khoa_phong"];

export function DepartmentsView({
  departments,
  onCreate,
  onUpdate,
  onDelete
}: {
  departments: Department[];
  onCreate: (payload: { name: string }) => Promise<boolean>;
  onUpdate: (id: number, payload: { name?: string; active?: boolean }) => void;
  onDelete: (department: Department) => void;
}) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<Record<number, string>>({});

  return (
    <main className="content-grid">
      <section className="panel">
        <PanelTitle icon={<Building2 size={17} />} title="Thêm khoa phòng" />
        <form
          className="form-inline"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!name.trim()) return;
            const created = await onCreate({ name: name.trim() });
            if (created) setName("");
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Tên khoa phòng"
            aria-label="Tên khoa phòng"
            maxLength={160}
          />
          <button type="submit" className="primary-btn"><Plus size={16} /> Thêm</button>
        </form>
      </section>

      <section className="panel wide-panel">
        <PanelTitle icon={<ClipboardList size={17} />} title="Danh sách khoa phòng" />
        <div className="staff-table" role="table" aria-label="Danh sách khoa phòng">
          <div className="staff-table-head" role="row">
            <span role="columnheader">Khoa phòng</span>
            <span role="columnheader">Trạng thái</span>
            <span role="columnheader">Thao tác</span>
          </div>
          {departments.length === 0 && <span className="empty-note">Chưa có khoa phòng nào.</span>}
          {departments.map((department) => (
            <div className="staff-row department-row" role="row" key={department.id}>
              {editing[department.id] !== undefined ? (
                <input
                  value={editing[department.id]}
                  aria-label={`Tên khoa phòng ${department.name}`}
                  onChange={(event) => setEditing((prev) => ({ ...prev, [department.id]: event.target.value }))}
                />
              ) : (
                <strong>{department.name}</strong>
              )}
              <span className={department.active ? "status-ok" : "status-off"}>
                {department.active ? "Đang dùng" : "Đã tắt"}
              </span>
              <div className="staff-actions">
                {editing[department.id] !== undefined ? (
                  <button
                    type="button"
                    className="tool-btn"
                    onClick={() => {
                      const next = editing[department.id].trim();
                      if (next) onUpdate(department.id, { name: next });
                      setEditing((prev) => {
                        const copy = { ...prev };
                        delete copy[department.id];
                        return copy;
                      });
                    }}
                  >
                    Lưu
                  </button>
                ) : (
                  <button
                    type="button"
                    className="tool-btn"
                    onClick={() => setEditing((prev) => ({ ...prev, [department.id]: department.name }))}
                  >
                    Sửa
                  </button>
                )}
                <button type="button" className="tool-btn" onClick={() => onUpdate(department.id, { active: !department.active })}>
                  {department.active ? "Tắt" : "Bật"}
                </button>
                <button type="button" className="ghost-danger" onClick={() => onDelete(department)}>
                  <Trash2 size={15} /> Xóa
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

export function UsersView({
  departments,
  onSaved,
  notify
}: {
  departments: Department[];
  onSaved: () => void;
  notify: (message: string) => void;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState<{
    username: string;
    password: string;
    role: Role;
    departmentId: number | "";
    fullName: string;
  }>({ username: "", password: "", role: "khoa_phong", departmentId: "", fullName: "" });
  const [editing, setEditing] = useState<
    Record<number, { username: string; role: Role; departmentId: number | ""; fullName: string }>
  >({});

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

  const needsDepartment = (role: Role) => role === "khoa_phong";

  return (
    <main className="content-grid">
      <section className="panel">
        <PanelTitle icon={<Shield size={17} />} title="Tạo tài khoản" />
        <form
          className="form-stack"
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            if (needsDepartment(form.role) && !form.departmentId) {
              setError("Tài khoản khoa phòng cần chọn khoa phòng liên kết.");
              return;
            }
            try {
              const res = await api.createUser({
                username: form.username.trim(),
                password: form.password,
                role: form.role,
                departmentId: needsDepartment(form.role) ? Number(form.departmentId) : null,
                fullName: form.fullName.trim()
              });
              setUsers(res.users);
              setForm({ username: "", password: "", role: "khoa_phong", departmentId: "", fullName: "" });
              onSaved();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Không tạo được tài khoản.");
            }
          }}
        >
          <input
            value={form.username}
            onChange={(event) => setForm({ ...form, username: event.target.value })}
            placeholder="Username"
            aria-label="Username"
          />
          <input
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            placeholder="Mật khẩu tối thiểu 6 ký tự"
            type="password"
          />
          <input
            value={form.fullName}
            onChange={(event) => setForm({ ...form, fullName: event.target.value })}
            placeholder="Họ và tên người dùng"
            aria-label="Họ và tên"
          />
          <select
            value={form.role}
            onChange={(event) => setForm({ ...form, role: event.target.value as Role, departmentId: "" })}
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>{roleLabel(role)}</option>
            ))}
          </select>
          {needsDepartment(form.role) && (
            <select
              value={form.departmentId}
              aria-label="Khoa phòng liên kết"
              onChange={(event) => setForm({ ...form, departmentId: Number(event.target.value) || "" })}
            >
              <option value="">Chọn khoa phòng liên kết</option>
              {departments.filter((department) => department.active).map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </select>
          )}
          {error && <div className="form-error">{error}</div>}
          <button type="submit" className="primary-btn">
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
            <span>Khoa phòng</span>
            <span>Chữ ký</span>
            <span>Mật khẩu</span>
            <span>Thao tác</span>
          </div>
          {users.map((item) => {
            const draft = editing[item.id];
            return (
              <div className="user-row" key={item.id}>
                {draft ? (
                  <>
                    <input
                      value={draft.username}
                      onChange={(event) =>
                        setEditing((prev) => ({ ...prev, [item.id]: { ...prev[item.id], username: event.target.value } }))
                      }
                    />
                    <select
                      value={draft.role}
                      onChange={(event) =>
                        setEditing((prev) => ({
                          ...prev,
                          [item.id]: { ...prev[item.id], role: event.target.value as Role, departmentId: "" }
                        }))
                      }
                    >
                      {ROLES.map((role) => (
                        <option key={role} value={role}>{roleLabel(role)}</option>
                      ))}
                    </select>
                    {needsDepartment(draft.role) ? (
                      <select
                        value={draft.departmentId}
                        aria-label="Khoa phòng liên kết"
                        onChange={(event) =>
                          setEditing((prev) => ({
                            ...prev,
                            [item.id]: { ...prev[item.id], departmentId: Number(event.target.value) || "" }
                          }))
                        }
                      >
                        <option value="">Chọn khoa phòng</option>
                        {departments.map((department) => (
                          <option key={department.id} value={department.id}>{department.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span>Không liên kết</span>
                    )}
                  </>
                ) : (
                  <>
                    <strong>
                      {item.username}
                      {item.fullName && <small> · {item.fullName}</small>}
                    </strong>
                    <span className="user-role">{roleLabel(item.role)}</span>
                    <span>{item.departmentName || "Không liên kết"}</span>
                  </>
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
                  {draft ? (
                    <button
                      type="button"
                      className="tool-btn"
                      onClick={async () => {
                        setError("");
                        try {
                          const res = await api.updateUser(item.id, {
                            username: draft.username.trim(),
                            role: draft.role,
                            departmentId: needsDepartment(draft.role) ? Number(draft.departmentId) || null : null,
                            fullName: draft.fullName.trim()
                          });
                          setUsers(res.users);
                          setEditing((prev) => {
                            const copy = { ...prev };
                            delete copy[item.id];
                            return copy;
                          });
                          onSaved();
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "Không lưu được tài khoản.");
                        }
                      }}
                    >
                      Lưu
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="tool-btn"
                      onClick={() =>
                        setEditing((prev) => ({
                          ...prev,
                          [item.id]: {
                            username: item.username,
                            role: item.role,
                            departmentId: item.departmentId || "",
                            fullName: item.fullName || ""
                          }
                        }))
                      }
                    >
                      Sửa
                    </button>
                  )}
                  <button
                    type="button"
                    className="ghost-danger"
                    onClick={async () => {
                      if (!window.confirm(`Xóa tài khoản ${item.username}?`)) return;
                      setError("");
                      try {
                        const res = await api.deleteUser(item.id);
                        setUsers(res.users);
                        onSaved();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Không xóa được tài khoản.");
                      }
                    }}
                  >
                    Xóa
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
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
          <button
            type="button"
            className="ghost-danger compact-signature-delete"
            disabled={saving}
            onClick={() => void saveSignature(null)}
          >
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

export function HistoryView({
  data,
  isAdmin,
  notify
}: {
  data: ScheduleResponse;
  isAdmin: boolean;
  notify: (message: string) => void;
}) {
  const [logs, setLogs] = useState<AuditLog[]>(data.auditLogs);
  const [filters, setFilters] = useState({ actor: "", action: "", q: "" });
  const [page, setPage] = useState(1);
  const pageSize = 12;
  const pageCount = Math.max(1, Math.ceil(logs.length / pageSize));
  const visibleLogs = logs.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setLogs(data.auditLogs);
    setPage(1);
  }, [data.auditLogs]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  return (
    <main className="panel history-panel">
      <PanelTitle icon={<ClipboardList size={17} />} title="Lịch sử thay đổi" />
      {isAdmin && (
        <form
          className="history-filters"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              const res = await api.audit(filters);
              setLogs(res.auditLogs);
              setPage(1);
            } catch (error) {
              notify(error instanceof Error ? error.message : "Không tải được lịch sử.");
            }
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
            <option value="person">Điền người làm việc</option>
            <option value="swap">Đổi ngày làm</option>
            <option value="move">Chuyển phân công</option>
            <option value="apply">Áp dụng tua</option>
            <option value="sign">Ký báo cáo</option>
            <option value="attendance">Điểm danh</option>
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
            style={{ marginLeft: "auto" }}
            onClick={async () => {
              if (!window.confirm("Xóa toàn bộ lịch sử thay đổi của hệ thống? Không thể hoàn tác.")) return;
              try {
                const result = await api.clearAudit();
                const res = await api.audit(filters);
                setLogs(res.auditLogs);
                setPage(1);
                notify(`Đã xóa ${result.deleted} dòng lịch sử`);
              } catch (error) {
                notify(error instanceof Error ? error.message : "Xóa lịch sử thất bại.");
              }
            }}
          >
            <Trash2 size={16} /> Xóa toàn bộ lịch sử
          </button>
        </form>
      )}
      <div className="history-list">
        {logs.length === 0 && <span className="empty-note">Chưa có thay đổi nào được ghi nhận.</span>}
        {visibleLogs.map((item) => (
          <div className="history-item" key={item.id}>
            <time>{formatVietnamDateTime(item.createdAt) || item.createdAt}</time>
            <strong>{item.summary}</strong>
            <span>{item.actorUsername || "Hệ thống"}</span>
          </div>
        ))}
      </div>
      {logs.length > 0 && (
        <nav className="history-pagination" aria-label="Phân trang lịch sử">
          <span className="history-page-summary">
            Hiển thị {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, logs.length)} / {logs.length}
          </span>
          <div className="history-page-controls">
            <button
              type="button"
              className="tool-btn history-page-btn"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page === 1}
            >
              <ChevronLeft size={17} /> Trước
            </button>
            <span className="history-page-current">Trang {page} / {pageCount}</span>
            <button
              type="button"
              className="tool-btn history-page-btn"
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              disabled={page === pageCount}
            >
              Sau <ChevronRight size={17} />
            </button>
          </div>
        </nav>
      )}
    </main>
  );
}

export function SettingsView({
  notify,
  positionsManager
}: {
  notify: (message: string) => void;
  positionsManager?: React.ReactNode;
}) {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then(setSettings)
      .catch((error) => notify(error instanceof Error ? error.message : "Không tải được cấu hình."));
  }, []);

  async function save(next: Partial<SystemSettings>) {
    setSaving(true);
    try {
      setSettings(await api.saveSettings(next));
      notify("Đã lưu cấu hình");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không lưu được cấu hình.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="profile-settings-layout">
      <section className="settings-panel profile-settings-card">
        <div className="settings-panel-title">
          <Sliders size={20} />
          <span>Cấu hình hệ thống</span>
        </div>
        <p className="profile-settings-intro">
          Cấu hình áp dụng cho toàn bộ hệ thống. Thay đổi được lưu ngay khi bấm.
        </p>
        {!settings ? (
          <span className="empty-note">Đang tải cấu hình...</span>
        ) : (
          <div className="settings-toggle-list">
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.lock_person_on_workday}
                disabled={saving}
                onChange={(event) => void save({ lock_person_on_workday: event.target.checked })}
              />
              <span>
                <strong>Khóa sửa người làm việc từ đầu ngày làm</strong>
                <small>
                  Bật: khoa phòng phải điền xong trước ngày khám. Tắt: vẫn sửa được trong chính ngày khám, chỉ khóa khi
                  ngày đã qua.
                </small>
              </span>
            </label>
          </div>
        )}
      </section>
      {positionsManager}
    </main>
  );
}

export function ProfileView({
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
  const [fullName, setFullName] = useState(user.fullName || "");
  const [signature, setSignature] = useState<string | null>(user.signature ?? null);
  const [signatureError, setSignatureError] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    setSignature(user.signature ?? null);
    setFullName(user.fullName || "");
  }, [user.id, user.signature, user.fullName]);

  const profileDirty = signature !== (user.signature ?? null) || fullName !== (user.fullName || "");

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
          <span>Họ tên và chữ ký</span>
        </div>
        <p className="profile-settings-intro">
          Họ và tên dùng khi ký báo cáo làm việc. Ảnh chữ ký chấp nhận PNG, JPG hoặc WebP.
        </p>
        <label className="field">
          Họ và tên
          <input value={fullName} onChange={(event) => setFullName(event.target.value)} maxLength={120} />
        </label>
        <div className="signature-preview" aria-live="polite">
          {signature ? <img src={signature} alt="Xem trước chữ ký mẫu" /> : <span>Chưa có chữ ký mẫu</span>}
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
          disabled={savingProfile || !profileDirty}
          onClick={async () => {
            setSignatureError("");
            setSavingProfile(true);
            try {
              const response = await api.updateProfile({ signature, fullName: fullName.trim() });
              onUserUpdated(response.user);
              notify("Đã lưu thông tin cá nhân");
            } catch (error) {
              setSignatureError(error instanceof Error ? error.message : "Không lưu được thông tin.");
            } finally {
              setSavingProfile(false);
            }
          }}
        >
          <Save size={16} /> {savingProfile ? "Đang lưu..." : "Lưu thông tin"}
        </button>
      </section>
    </main>
  );
}

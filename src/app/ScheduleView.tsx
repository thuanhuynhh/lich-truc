import { MutableRefObject, useState } from "react";
import { ArrowLeftRight, Check, Phone, Plus, Trash2, UserRound } from "lucide-react";
import type {
  Assignment,
  CoordinatorAssignment,
  Department,
  ScheduleResponse,
  User,
  WorkDay
} from "../shared/types";
import {
  SESSION_LABELS,
  SESSION_SHORT_LABELS,
  canEditPersonOnDate,
  formatDate,
  getWeekdayLabel,
  todayInVietnam
} from "../shared/schedule";
import { canManageSchedule } from "../shared/validation";
import { formatLunarDate } from "./lunar";

export interface ScheduleViewProps {
  data: ScheduleResponse;
  user: User;
  showLunar: boolean;
  lockPersonOnWorkDay: boolean;
  tableRef: MutableRefObject<HTMLDivElement | null>;
  onAddAssignment: (date: string, departmentId: number) => void;
  onDeleteAssignment: (assignment: Assignment) => void;
  onMoveAssignment: (assignmentId: number, date: string) => void;
  onSavePerson: (assignment: Assignment, personName: string, personPhone: string) => Promise<boolean>;
  onAddCoordinator: (date: string, userId: number) => void;
  onDeleteCoordinator: (item: CoordinatorAssignment) => void;
  onMoveCoordinator: (id: number, date: string) => void;
  onRequestSwap: (source: CoordinatorAssignment, target: CoordinatorAssignment) => void;
}

export function ScheduleView({
  data,
  user,
  showLunar,
  lockPersonOnWorkDay,
  tableRef,
  onAddAssignment,
  onDeleteAssignment,
  onMoveAssignment,
  onSavePerson,
  onAddCoordinator,
  onDeleteCoordinator,
  onMoveCoordinator,
  onRequestSwap
}: ScheduleViewProps) {
  const [draggedAssignmentId, setDraggedAssignmentId] = useState<number | null>(null);
  const [draggedCoordinatorId, setDraggedCoordinatorId] = useState<number | null>(null);
  const [selectedCoordinator, setSelectedCoordinator] = useState<Record<string, number | "">>({});
  const [swapSource, setSwapSource] = useState<CoordinatorAssignment | null>(null);

  const isAdmin = user.role === "admin";
  const canSchedule = canManageSchedule(user.role);
  const isCoordinator = user.role === "dieu_phoi";
  const today = todayInVietnam();
  const visibleDepartments = departmentsToShow(data);

  if (data.workDays.length === 0) {
    return (
      <div className="empty-schedule-card">
        <h2>Tháng này chưa có ngày làm việc</h2>
        <p>
          {canSchedule
            ? "Hãy mở tab “Ngày làm việc” để thêm ngày khám và chọn buổi làm (sáng, chiều hoặc cả buổi)."
            : "Quản lý chưa mở ngày khám nào cho tháng này."}
        </p>
      </div>
    );
  }

  const gridStyle = { "--day-count": data.workDays.length } as React.CSSProperties;

  return (
    <div className="schedule-table-wrap" ref={tableRef} style={gridStyle}>
      <div className="schedule-grid day-header-row">
        <div className="unit-head">KHOA PHÒNG</div>
        {data.workDays.map((workDay) => (
          <div className="day-head" key={workDay.date}>
            <strong>{getWeekdayLabel(workDay.date)} {formatDate(workDay.date)}</strong>
            <span className={`session-badge session-${workDay.session}`}>{SESSION_LABELS[workDay.session]}</span>
            {showLunar && <small>{formatLunarDate(workDay.date)}</small>}
            {workDay.note && <small className="day-head-note" title={workDay.note}>{workDay.note}</small>}
          </div>
        ))}
      </div>

      <div className="section-label">
        <span className="section-label-text">I. ĐIỀU PHỐI</span>
      </div>
      <div className="schedule-grid schedule-row">
        <div className="unit-name row-coordinator">
          <span>ĐIỀU PHỐI</span>
          <small>Phụ trách buổi khám</small>
        </div>
        {data.workDays.map((workDay) => {
          const cellKey = `coordinator-${workDay.date}`;
          const items = data.coordinatorAssignments.filter((item) => item.date === workDay.date);
          const availableCoordinators = data.coordinators.filter(
            (coordinator) => !items.some((item) => item.userId === coordinator.id)
          );
          return (
            <div
              key={workDay.date}
              className="day-cell"
              onDragOver={(event) => {
                if (isAdmin && draggedCoordinatorId) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (isAdmin && draggedCoordinatorId) onMoveCoordinator(draggedCoordinatorId, workDay.date);
                setDraggedCoordinatorId(null);
              }}
            >
              {items.length === 0 && <span className="empty-note">Trống</span>}
              <div className="assignment-list">
                {items.map((item) => {
                  const isMine = item.userId === user.id;
                  const canSwapWith = isCoordinator && !isMine && item.date >= today && myFutureDays(data, user, today).length > 0;
                  return (
                    <span
                      key={item.id}
                      className={`person-pill coordinator ${isMine ? "mine" : ""} ${isAdmin ? "draggable-pill" : ""}`}
                      draggable={isAdmin}
                      onDragStart={() => isAdmin && setDraggedCoordinatorId(item.id)}
                      onDragEnd={() => setDraggedCoordinatorId(null)}
                      title={isAdmin ? "Kéo sang ngày khác để chuyển" : undefined}
                    >
                      {item.fullName || item.username}
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => onDeleteCoordinator(item)}
                          aria-label={`Bỏ điều phối ${item.fullName || item.username}`}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                      {canSwapWith && (
                        <button
                          type="button"
                          className="pill-icon-btn"
                          onClick={() => setSwapSource(item)}
                          aria-label={`Xin đổi ngày làm với ${item.fullName || item.username}`}
                        >
                          <ArrowLeftRight size={12} />
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
              {isAdmin && availableCoordinators.length > 0 && (
                <div className="cell-add">
                  <select
                    value={selectedCoordinator[cellKey] || ""}
                    aria-label={`Chọn điều phối cho ngày ${workDay.date}`}
                    onChange={(event) =>
                      setSelectedCoordinator((prev) => ({ ...prev, [cellKey]: Number(event.target.value) || "" }))
                    }
                  >
                    <option value="">Chọn</option>
                    {availableCoordinators.map((coordinator) => (
                      <option key={coordinator.id} value={coordinator.id}>
                        {coordinator.fullName || coordinator.username}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="mini-icon-btn"
                    disabled={!selectedCoordinator[cellKey]}
                    aria-label="Thêm điều phối"
                    onClick={() => {
                      const userId = Number(selectedCoordinator[cellKey]);
                      if (!userId) return;
                      onAddCoordinator(workDay.date, userId);
                      setSelectedCoordinator((prev) => ({ ...prev, [cellKey]: "" }));
                    }}
                  >
                    <Plus size={15} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="section-label">
        <span className="section-label-text">II. KHOA PHÒNG THAM GIA</span>
      </div>
      {visibleDepartments.map((department) => (
        <div className="schedule-grid schedule-row" key={department.id}>
          <div className="unit-name row-department">
            <span>{department.name}</span>
            {!department.active && <small>Đã ngừng hoạt động</small>}
          </div>
          {data.workDays.map((workDay) => {
            const assignment = data.assignments.find(
              (item) => item.departmentId === department.id && item.date === workDay.date
            );
            const canEditOwnPerson =
              !!assignment &&
              user.role === "khoa_phong" &&
              user.departmentId === department.id &&
              canEditPersonOnDate(workDay.date, today, lockPersonOnWorkDay);

            return (
              <div
                key={workDay.date}
                className="day-cell"
                onDragOver={(event) => {
                  if (canSchedule && draggedAssignmentId) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (canSchedule && draggedAssignmentId) onMoveAssignment(draggedAssignmentId, workDay.date);
                  setDraggedAssignmentId(null);
                }}
              >
                {assignment ? (
                  <PersonCell
                    assignment={assignment}
                    canDrag={canSchedule}
                    canDelete={canSchedule}
                    canEdit={canSchedule || canEditOwnPerson}
                    onDelete={() => onDeleteAssignment(assignment)}
                    onDragStart={() => setDraggedAssignmentId(assignment.id)}
                    onDragEnd={() => setDraggedAssignmentId(null)}
                    onSave={(name, phone) => onSavePerson(assignment, name, phone)}
                  />
                ) : (
                  <span className="empty-note">Trống</span>
                )}
                {canSchedule && !assignment && department.active && (
                  <button
                    type="button"
                    className="cell-add-btn"
                    aria-label={`Phân công ${department.name} ngày ${workDay.date}`}
                    onClick={() => onAddAssignment(workDay.date, department.id)}
                  >
                    <Plus size={14} /> Phân công
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {swapSource && (
        <SwapDialog
          data={data}
          user={user}
          target={swapSource}
          today={today}
          onClose={() => setSwapSource(null)}
          onSubmit={(mine) => {
            onRequestSwap(mine, swapSource);
            setSwapSource(null);
          }}
        />
      )}
    </div>
  );
}

/** Khoa phòng có phân công trong tháng, cộng thêm khoa phòng đang hoạt động. */
function departmentsToShow(data: ScheduleResponse): Department[] {
  const assigned = new Set(data.assignments.map((assignment) => assignment.departmentId));
  return data.departments.filter((department) => department.active || assigned.has(department.id));
}

function myFutureDays(data: ScheduleResponse, user: User, today: string): CoordinatorAssignment[] {
  return data.coordinatorAssignments.filter((item) => item.userId === user.id && item.date >= today);
}

function PersonCell({
  assignment,
  canDrag,
  canDelete,
  canEdit,
  onDelete,
  onDragStart,
  onDragEnd,
  onSave
}: {
  assignment: Assignment;
  canDrag: boolean;
  canDelete: boolean;
  canEdit: boolean;
  onDelete: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onSave: (personName: string, personPhone: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(assignment.personName);
  const [phone, setPhone] = useState(assignment.personPhone);
  const [saving, setSaving] = useState(false);

  if (editing) {
    return (
      <form
        className="person-edit-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          const saved = await onSave(name.trim(), phone.trim());
          setSaving(false);
          if (saved) setEditing(false);
        }}
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Họ và tên"
          aria-label="Họ và tên người làm việc"
          autoFocus
        />
        <input
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="Số điện thoại"
          aria-label="Số điện thoại liên hệ"
          inputMode="tel"
        />
        <div className="person-edit-actions">
          <button type="submit" className="mini-icon-btn" disabled={saving} aria-label="Lưu người làm việc">
            <Check size={15} />
          </button>
          <button
            type="button"
            className="mini-icon-btn"
            onClick={() => {
              setName(assignment.personName);
              setPhone(assignment.personPhone);
              setEditing(false);
            }}
            aria-label="Hủy"
          >
            ×
          </button>
        </div>
      </form>
    );
  }

  return (
    <div
      className={`person-cell ${canDrag ? "draggable-pill" : ""} ${assignment.personName ? "" : "person-cell-empty"}`}
      draggable={canDrag}
      onDragStart={() => canDrag && onDragStart()}
      onDragEnd={onDragEnd}
      title={canDrag ? "Kéo sang ngày khác để chuyển phân công" : undefined}
    >
      <span className="person-name">
        <UserRound size={13} aria-hidden="true" />
        {assignment.personName || "Chưa điền tên"}
      </span>
      {assignment.personPhone && (
        <a className="person-phone" href={`tel:${assignment.personPhone.replace(/[^\d+]/g, "")}`}>
          <Phone size={12} aria-hidden="true" />
          {assignment.personPhone}
        </a>
      )}
      <div className="person-cell-actions">
        {canEdit && (
          <button type="button" className="cell-link-btn" onClick={() => setEditing(true)}>
            {assignment.personName ? "Sửa" : "Điền tên"}
          </button>
        )}
        {canDelete && (
          <button type="button" className="cell-link-btn danger" onClick={onDelete}>
            Xóa
          </button>
        )}
      </div>
    </div>
  );
}

function SwapDialog({
  data,
  user,
  target,
  today,
  onClose,
  onSubmit
}: {
  data: ScheduleResponse;
  user: User;
  target: CoordinatorAssignment;
  today: string;
  onClose: () => void;
  onSubmit: (mine: CoordinatorAssignment) => void;
}) {
  const options = myFutureDays(data, user, today);
  const [selectedId, setSelectedId] = useState<number | "">(options[0]?.id ?? "");
  const sessionOf = (date: string) => {
    const workDay = data.workDays.find((item) => item.date === date);
    return workDay ? SESSION_SHORT_LABELS[workDay.session] : "";
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-panel" style={{ maxWidth: 480 }}>
        <div className="modal-head">
          <div>
            <h2>Xin đổi ngày làm</h2>
            <p>
              Đổi với <strong>{target.fullName || target.username}</strong> ngày{" "}
              {formatDate(target.date)} ({sessionOf(target.date)}). Yêu cầu chỉ có hiệu lực khi đối phương đồng ý.
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Đóng">×</button>
        </div>
        {options.length === 0 ? (
          <p className="empty-note">Bạn chưa có ngày làm nào sắp tới để đổi.</p>
        ) : (
          <label className="field">
            Ngày làm của bạn dùng để đổi
            <select value={selectedId} onChange={(event) => setSelectedId(Number(event.target.value) || "")}>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {formatDate(option.date)} ({sessionOf(option.date)})
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="tool-btn" onClick={onClose}>Hủy</button>
          <button
            type="button"
            className="primary-btn"
            disabled={!selectedId}
            onClick={() => {
              const mine = options.find((option) => option.id === Number(selectedId));
              if (mine) onSubmit(mine);
            }}
          >
            <ArrowLeftRight size={16} /> Gửi yêu cầu đổi
          </button>
        </div>
      </div>
    </div>
  );
}

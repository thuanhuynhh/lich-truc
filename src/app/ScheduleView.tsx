import { MutableRefObject, useState } from "react";
import { ArrowLeftRight, Check, ListOrdered, Phone, Plus, RefreshCw, Trash2, UserRound } from "lucide-react";
import type {
  Assignment,
  CoordinatorAssignment,
  Position,
  ScheduleResponse,
  Section,
  User
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
import { DepartmentSearchSelect } from "./common";

export interface ScheduleViewProps {
  data: ScheduleResponse;
  user: User;
  showLunar: boolean;
  tableRef: MutableRefObject<HTMLDivElement | null>;
  onAddAssignment: (positionId: number, date: string, departmentId: number) => void;
  onDeleteAssignment: (assignment: Assignment, position: Position) => void;
  onMoveAssignment: (assignmentId: number, positionId: number, date: string) => void;
  onSavePerson: (assignment: Assignment, personName: string, personPhone: string) => Promise<boolean>;
  onOpenRotation: (position: Position) => void;
  onApplyRotation: (position: Position) => void;
  onAddCoordinator: (date: string, userId: number) => void;
  onDeleteCoordinator: (item: CoordinatorAssignment) => void;
  onMoveCoordinator: (id: number, date: string) => void;
  onRequestSwap: (source: CoordinatorAssignment, target: CoordinatorAssignment) => void;
}

export function ScheduleView({
  data,
  user,
  showLunar,
  tableRef,
  onAddAssignment,
  onDeleteAssignment,
  onMoveAssignment,
  onSavePerson,
  onOpenRotation,
  onApplyRotation,
  onAddCoordinator,
  onDeleteCoordinator,
  onMoveCoordinator,
  onRequestSwap
}: ScheduleViewProps) {
  const [draggedAssignmentId, setDraggedAssignmentId] = useState<number | null>(null);
  const [draggedCoordinatorId, setDraggedCoordinatorId] = useState<number | null>(null);
  const [picker, setPicker] = useState<Record<string, number | "">>({});
  const [selectedCoordinator, setSelectedCoordinator] = useState<Record<string, number | "">>({});
  const [swapSource, setSwapSource] = useState<CoordinatorAssignment | null>(null);

  const isAdmin = user.role === "admin";
  const canSchedule = canManageSchedule(user.role);
  const isCoordinator = user.role === "dieu_phoi";
  const today = todayInVietnam();
  const lockPerson = !!data.lockPersonOnWorkDay;
  const activeDepartments = data.departments.filter((department) => department.active);

  if (data.workDays.length === 0) {
    return (
      <div className="empty-schedule-card">
        <h2>Tuần này chưa có ngày làm việc</h2>
        <p>
          {canSchedule
            ? "Chuyển sang tuần khác, hoặc mở tab “Ngày làm việc” để thêm ngày khám và chọn buổi làm (sáng, chiều hoặc cả buổi)."
            : "Quản lý chưa mở ngày khám nào trong tuần này. Hãy thử chuyển sang tuần khác."}
        </p>
      </div>
    );
  }

  if (data.positions.length === 0) {
    return (
      <div className="empty-schedule-card">
        <h2>Chưa có vị trí khám nào</h2>
        <p>
          {isAdmin
            ? "Vào tab “Cấu hình” để thêm mục và vị trí khám (ví dụ Khám nội, Khám ngoại). Mỗi vị trí là một hàng của bảng lịch và có tua riêng."
            : "Quản lý chưa cấu hình vị trí khám nào."}
        </p>
      </div>
    );
  }

  const gridStyle = { "--day-count": data.workDays.length } as React.CSSProperties;
  const sections = [...data.sections].sort((left, right) => left.sortOrder - right.sortOrder);
  const orphanPositions = data.positions.filter(
    (position) => !sections.some((section) => section.id === position.sectionId)
  );
  const groups: Array<{ section: Section; positions: Position[] }> = [
    ...sections.map((section) => ({
      section,
      positions: data.positions.filter((position) => position.sectionId === section.id)
    })),
    ...(orphanPositions.length > 0
      ? [{ section: { id: 0, label: "Chưa phân mục", sortOrder: 9999 }, positions: orphanPositions }]
      : [])
  ];

  return (
    <div className="schedule-table-wrap" ref={tableRef} style={gridStyle}>
      <div className="schedule-grid day-header-row">
        <div className="unit-head">VỊ TRÍ KHÁM</div>
        {data.workDays.map((workDay) => (
          <div className="day-head" key={workDay.date}>
            <strong>{getWeekdayLabel(workDay.date)}</strong>
            <span className="day-head-date">{formatDate(workDay.date)}</span>
            <span className={`session-badge session-${workDay.session}`}>{SESSION_LABELS[workDay.session]}</span>
            {showLunar && <small>{formatLunarDate(workDay.date)}</small>}
            {workDay.note && <small className="day-head-note" title={workDay.note}>{workDay.note}</small>}
          </div>
        ))}
      </div>

      <div className="section-label">
        <span className="section-label-text">ĐIỀU PHỐI</span>
      </div>
      <div className="schedule-grid schedule-row">
        <div className="unit-name row-coordinator">
          <span>ĐIỀU PHỐI</span>
          <small>Phụ trách buổi khám</small>
        </div>
        {data.workDays.map((workDay) => {
          const cellKey = `coordinator-${workDay.date}`;
          const items = data.coordinatorAssignments.filter((item) => item.date === workDay.date);
          const available = data.coordinators.filter(
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
                  const canSwapWith =
                    isCoordinator && !isMine && item.date >= today && myFutureDays(data, user, today).length > 0;
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
              {isAdmin && available.length > 0 && (
                <div className="cell-add">
                  <select
                    value={selectedCoordinator[cellKey] || ""}
                    aria-label={`Chọn điều phối cho ngày ${workDay.date}`}
                    onChange={(event) =>
                      setSelectedCoordinator((prev) => ({ ...prev, [cellKey]: Number(event.target.value) || "" }))
                    }
                  >
                    <option value="">Chọn</option>
                    {available.map((coordinator) => (
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

      {groups.map(({ section, positions }) => (
        <div key={section.id}>
          <div className="section-label">
            <span className="section-label-text">{section.label}</span>
          </div>
          {positions.length === 0 && (
            <div className="schedule-grid schedule-row">
              <div className="unit-name row-position empty-position">
                <span>Mục này chưa có vị trí khám</span>
              </div>
              {data.workDays.map((workDay) => (
                <div className="day-cell" key={workDay.date} />
              ))}
            </div>
          )}
          {positions.map((position) => {
            const rotation = data.rotations.find((item) => item.positionId === position.id);
            const hasTurns = !!rotation && rotation.turns.some((turn) => turn.length > 0);
            return (
              <div className="schedule-grid schedule-row" key={position.id}>
                <div className="unit-name row-position">
                  <span>{position.label}</span>
                  {!position.active && <small>Đã ngừng hoạt động</small>}
                  {hasTurns && (
                    <small>{rotation!.turns.length} tua · từ {formatDate(rotation!.startDate)}</small>
                  )}
                  {canSchedule && (
                    <div className="unit-actions">
                      <button
                        type="button"
                        className="unit-action"
                        onClick={() => onOpenRotation(position)}
                        title="Cấu hình tua cho vị trí này"
                      >
                        <ListOrdered size={12} /> Tua
                      </button>
                      {hasTurns && (
                        <button
                          type="button"
                          className="unit-action"
                          onClick={() => onApplyRotation(position)}
                          title="Áp tua của vị trí này cho tháng đang xem"
                        >
                          <RefreshCw size={12} /> Áp tua
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {data.workDays.map((workDay) => {
                  const cellKey = `${position.id}-${workDay.date}`;
                  const cells = data.assignments.filter(
                    (item) => item.positionId === position.id && item.date === workDay.date
                  );
                  return (
                    <div
                      key={workDay.date}
                      className="day-cell"
                      onDragOver={(event) => {
                        if (canSchedule && draggedAssignmentId) event.preventDefault();
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (canSchedule && draggedAssignmentId) {
                          onMoveAssignment(draggedAssignmentId, position.id, workDay.date);
                        }
                        setDraggedAssignmentId(null);
                      }}
                    >
                      {cells.length === 0 && <span className="empty-note">Trống</span>}
                      <div className="cell-stack">
                        {cells.map((assignment) => (
                          <AssignmentCell
                            key={assignment.id}
                            assignment={assignment}
                            canDrag={canSchedule}
                            canDelete={canSchedule}
                            canEdit={
                              canSchedule ||
                              (user.role === "khoa_phong" &&
                                user.departmentId === assignment.departmentId &&
                                canEditPersonOnDate(workDay.date, today, lockPerson))
                            }
                            onDelete={() => onDeleteAssignment(assignment, position)}
                            onDragStart={() => setDraggedAssignmentId(assignment.id)}
                            onDragEnd={() => setDraggedAssignmentId(null)}
                            onSave={(name, phone) => onSavePerson(assignment, name, phone)}
                          />
                        ))}
                      </div>
                      {canSchedule && position.active && (
                        <div className="cell-add">
                          <DepartmentSearchSelect
                            value={picker[cellKey] ?? ""}
                            options={activeDepartments.filter(
                              (department) => !cells.some((cell) => cell.departmentId === department.id)
                            )}
                            placeholder="Thêm khoa"
                            ariaLabel={`Thêm khoa phòng cho ${position.label} ngày ${workDay.date}`}
                            onChange={(value) => setPicker((prev) => ({ ...prev, [cellKey]: value }))}
                          />
                          <button
                            type="button"
                            className="mini-icon-btn"
                            disabled={!picker[cellKey]}
                            aria-label="Thêm phân công"
                            onClick={() => {
                              const departmentId = Number(picker[cellKey]);
                              if (!departmentId) return;
                              onAddAssignment(position.id, workDay.date, departmentId);
                              setPicker((prev) => ({ ...prev, [cellKey]: "" }));
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

function myFutureDays(data: ScheduleResponse, user: User, today: string): CoordinatorAssignment[] {
  return data.coordinatorAssignments.filter((item) => item.userId === user.id && item.date >= today);
}

function AssignmentCell({
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
        <strong className="person-department">{assignment.departmentName}</strong>
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
      title={canDrag ? "Kéo sang ô khác để chuyển phân công" : undefined}
    >
      <strong className="person-department">{assignment.departmentName}</strong>
      <span className="person-name">
        <UserRound size={12} aria-hidden="true" />
        {assignment.personName || "Chưa điền tên"}
      </span>
      {assignment.personPhone && (
        <a className="person-phone" href={`tel:${assignment.personPhone.replace(/[^\d+]/g, "")}`}>
          <Phone size={11} aria-hidden="true" />
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
              Đổi với <strong>{target.fullName || target.username}</strong> ngày {formatDate(target.date)} (
              {sessionOf(target.date)}). Yêu cầu chỉ có hiệu lực khi đối phương đồng ý.
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

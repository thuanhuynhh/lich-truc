import { useState } from "react";
import {
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  ChevronUp,
  LayoutList,
  ListOrdered,
  Plus,
  RefreshCw,
  Save,
  Trash2
} from "lucide-react";
import type { DaySession, Department, Position, Rotation, ScheduleResponse, Section, WorkDay } from "../shared/types";
import {
  DAY_SESSIONS,
  SESSION_LABELS,
  formatFullDate,
  formatMonthLabel,
  formatWeekLabel,
  getDayOfWeekLabel,
  monthRange,
  todayInVietnam,
  weekRange
} from "../shared/schedule";
import { DepartmentSearchSelect, PanelTitle } from "./common";

export function WorkDaysView({
  data,
  onCreate,
  onUpdate,
  onDelete
}: {
  data: ScheduleResponse;
  onCreate: (payload: { date: string; session: DaySession; note?: string }) => Promise<boolean>;
  onUpdate: (date: string, payload: { session?: DaySession; note?: string | null }) => void;
  onDelete: (workDay: WorkDay) => void;
}) {
  const { from } = monthRange(data.month);
  const [date, setDate] = useState(() => {
    const today = todayInVietnam();
    return today.slice(0, 7) === data.month ? today : from;
  });
  const workDays = data.monthWorkDays;
  const [session, setSession] = useState<DaySession>("full");
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<Record<string, { session: DaySession; note: string }>>({});

  const assignmentCount = (workDay: WorkDay) => workDay.assignmentCount ?? 0;

  return (
    <main className="content-grid">
      <section className="panel">
        <PanelTitle icon={<CalendarPlus size={17} />} title="Thêm ngày làm việc" />
        <form
          className="form-stack"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!date) return;
            const created = await onCreate({ date, session, note: note.trim() || undefined });
            if (created) setNote("");
          }}
        >
          <label>
            <span>Ngày khám</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
          </label>
          <label>
            <span>Buổi làm việc</span>
            <select value={session} onChange={(event) => setSession(event.target.value as DaySession)}>
              {DAY_SESSIONS.map((item) => (
                <option key={item} value={item}>{SESSION_LABELS[item]}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Ghi chú (địa điểm, đối tượng khám...)</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Ví dụ: Trạm y tế Phường 5"
              maxLength={300}
            />
          </label>
          <button type="submit" className="primary-btn">
            <Plus size={16} /> Thêm ngày làm
          </button>
        </form>
      </section>

      <section className="panel wide-panel">
        <PanelTitle icon={<CalendarDays size={17} />} title={`Ngày làm việc ${formatMonthLabel(data.month)}`} />
        {workDays.length === 0 ? (
          <span className="empty-note">Tháng này chưa có ngày làm việc nào.</span>
        ) : (
          <div className="workday-table" role="table">
            <div className="workday-table-head" role="row">
              <span role="columnheader">Ngày</span>
              <span role="columnheader">Buổi</span>
              <span role="columnheader">Ghi chú</span>
              <span role="columnheader">Phân công</span>
              <span role="columnheader">Thao tác</span>
            </div>
            {workDays.map((workDay) => {
              const draft = editing[workDay.date];
              return (
                <div className="workday-row" role="row" key={workDay.date}>
                  <strong>
                    {formatFullDate(workDay.date)}
                    <small> ({getDayOfWeekLabel(workDay.date)})</small>
                  </strong>
                  {draft ? (
                    <select
                      value={draft.session}
                      aria-label={`Buổi làm việc ngày ${workDay.date}`}
                      onChange={(event) =>
                        setEditing((prev) => ({
                          ...prev,
                          [workDay.date]: { ...prev[workDay.date], session: event.target.value as DaySession }
                        }))
                      }
                    >
                      {DAY_SESSIONS.map((item) => (
                        <option key={item} value={item}>{SESSION_LABELS[item]}</option>
                      ))}
                    </select>
                  ) : (
                    <span className={`session-badge session-${workDay.session}`}>{SESSION_LABELS[workDay.session]}</span>
                  )}
                  {draft ? (
                    <input
                      value={draft.note}
                      aria-label={`Ghi chú ngày ${workDay.date}`}
                      onChange={(event) =>
                        setEditing((prev) => ({
                          ...prev,
                          [workDay.date]: { ...prev[workDay.date], note: event.target.value }
                        }))
                      }
                    />
                  ) : (
                    <span>{workDay.note || "—"}</span>
                  )}
                  <span>{assignmentCount(workDay)} khoa phòng</span>
                  <div className="workday-actions">
                    {draft ? (
                      <>
                        <button
                          type="button"
                          className="tool-btn"
                          onClick={() => {
                            onUpdate(workDay.date, { session: draft.session, note: draft.note.trim() || null });
                            setEditing((prev) => {
                              const next = { ...prev };
                              delete next[workDay.date];
                              return next;
                            });
                          }}
                        >
                          <Save size={15} /> Lưu
                        </button>
                        <button
                          type="button"
                          className="tool-btn"
                          onClick={() =>
                            setEditing((prev) => {
                              const next = { ...prev };
                              delete next[workDay.date];
                              return next;
                            })
                          }
                        >
                          Hủy
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="tool-btn"
                        onClick={() =>
                          setEditing((prev) => ({
                            ...prev,
                            [workDay.date]: { session: workDay.session, note: workDay.note || "" }
                          }))
                        }
                      >
                        Sửa
                      </button>
                    )}
                    <button type="button" className="ghost-danger" onClick={() => onDelete(workDay)}>
                      <Trash2 size={15} /> Xóa
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

export function RotationDialog({
  weekStart,
  month,
  position,
  departments,
  rotation,
  weekWorkDayCount,
  monthWorkDayCount,
  onClose,
  onSave,
  onApply
}: {
  weekStart: string;
  month: string;
  position: Position;
  departments: Department[];
  rotation: Rotation | null;
  weekWorkDayCount: number;
  monthWorkDayCount: number;
  onClose: () => void;
  onSave: (payload: { startDate: string; turns: number[][] }) => void;
  onApply: (payload: { startDate: string; turns: number[][] }, scope: "week" | "month") => void;
}) {
  const activeDepartments = departments.filter((department) => department.active);
  const existingTurns = (rotation?.turns || [])
    .filter((turn) => Array.isArray(turn) && turn.length > 0)
    .map((turn) => turn.map((member) => member.departmentId));
  const [startDate, setStartDate] = useState(rotation?.startDate || weekRange(weekStart).from);
  const [turns, setTurns] = useState<number[][]>(existingTurns.length ? existingTurns : [[]]);
  const [picker, setPicker] = useState<Record<number, number | "">>({});
  const [draggedTurnIndex, setDraggedTurnIndex] = useState<number | null>(null);

  const valid = startDate && turns.length > 0 && turns.every((turn) => turn.length > 0);

  function addDepartment(turnIndex: number, departmentId: number) {
    setTurns((prev) =>
      prev.map((turn, index) => (index !== turnIndex || turn.includes(departmentId) ? turn : [...turn, departmentId]))
    );
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-panel">
        <div className="modal-head">
          <div>
            <h2>Tua khám · {position.label}</h2>
            <p>
              Tua 1 áp cho ngày làm đầu tiên tính từ ngày bắt đầu, các ngày làm tiếp theo xoay lần lượt theo thứ tự tua.
              Mỗi tua có thể gồm nhiều khoa phòng cùng đứng vị trí này. Tuần {formatWeekLabel(weekStart)} có{" "}
              {weekWorkDayCount} ngày làm, cả {formatMonthLabel(month).toLowerCase()} có{" "}
              {monthWorkDayCount} ngày làm.
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Đóng">×</button>
        </div>

        <label className="field">
          Ngày làm bắt đầu tua 1
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>

        <div className="turn-list">
          {turns.map((turn, turnIndex) => (
            <div
              className={`turn-card draggable ${draggedTurnIndex === turnIndex ? "dragging" : ""}`}
              key={turnIndex}
              draggable
              onDragStart={() => setDraggedTurnIndex(turnIndex)}
              onDragEnd={() => setDraggedTurnIndex(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (draggedTurnIndex === null || draggedTurnIndex === turnIndex) return;
                setTurns((prev) => {
                  const next = [...prev];
                  const [moved] = next.splice(draggedTurnIndex, 1);
                  next.splice(turnIndex, 0, moved);
                  return next;
                });
                setDraggedTurnIndex(null);
              }}
            >
              <div className="turn-head">
                <strong>Tua {turnIndex + 1}</strong>
                <button
                  type="button"
                  className="ghost-danger"
                  disabled={turns.length === 1}
                  onClick={() => setTurns((prev) => prev.filter((_, index) => index !== turnIndex))}
                >
                  Xóa tua
                </button>
              </div>
              <div className="assignment-list">
                {turn.map((departmentId) => {
                  const department = departments.find((item) => item.id === departmentId);
                  if (!department) return null;
                  return (
                    <span className="person-pill" key={departmentId}>
                      {department.name}
                      <button
                        type="button"
                        aria-label={`Bỏ ${department.name} khỏi tua ${turnIndex + 1}`}
                        onClick={() =>
                          setTurns((prev) =>
                            prev.map((item, index) =>
                              index === turnIndex ? item.filter((id) => id !== departmentId) : item
                            )
                          )
                        }
                      >
                        <Trash2 size={12} />
                      </button>
                    </span>
                  );
                })}
                {turn.length === 0 && <span className="empty-note">Chưa có khoa phòng</span>}
              </div>
              <div className="turn-add">
                <DepartmentSearchSelect
                  value={picker[turnIndex] ?? ""}
                  options={activeDepartments.filter((department) => !turn.includes(department.id))}
                  placeholder="Thêm khoa phòng vào tua"
                  onChange={(value) => setPicker((prev) => ({ ...prev, [turnIndex]: value }))}
                />
                <button
                  type="button"
                  className="tool-btn"
                  disabled={!picker[turnIndex]}
                  onClick={() => {
                    const departmentId = Number(picker[turnIndex]);
                    if (!departmentId) return;
                    addDepartment(turnIndex, departmentId);
                    setPicker((prev) => ({ ...prev, [turnIndex]: "" }));
                  }}
                >
                  <Plus size={15} /> Thêm
                </button>
              </div>
            </div>
          ))}
        </div>

        <button type="button" className="tool-btn" onClick={() => setTurns((prev) => [...prev, []])}>
          <ListOrdered size={15} /> Thêm tua
        </button>

        <div className="modal-actions">
          <button type="button" className="tool-btn" onClick={onClose}>Đóng</button>
          <button
            type="button"
            className="tool-btn"
            disabled={!valid}
            onClick={() => onSave({ startDate, turns })}
          >
            <Save size={15} /> Lưu tua
          </button>
          <button
            type="button"
            className="tool-btn"
            disabled={!valid}
            onClick={() => onApply({ startDate, turns }, "week")}
          >
            <RefreshCw size={15} /> Lưu và áp tuần này
          </button>
          <button
            type="button"
            className="primary-btn"
            disabled={!valid}
            onClick={() => onApply({ startDate, turns }, "month")}
          >
            <RefreshCw size={15} /> Lưu và áp cả tháng
          </button>
        </div>
      </div>
    </div>
  );
}


/** Quản lý mục lịch và vị trí khám. Chỉ tài khoản quản lý dùng được. */
export function PositionsManager({
  sections,
  positions,
  onCreateSection,
  onUpdateSection,
  onDeleteSection,
  onCreatePosition,
  onUpdatePosition,
  onDeletePosition
}: {
  sections: Section[];
  positions: Position[];
  onCreateSection: (label: string) => Promise<boolean>;
  onUpdateSection: (id: number, payload: { label?: string; sortOrder?: number }) => void;
  onDeleteSection: (section: Section) => void;
  onCreatePosition: (sectionId: number, label: string) => Promise<boolean>;
  onUpdatePosition: (
    id: number,
    payload: { label?: string; sectionId?: number; sortOrder?: number; active?: boolean }
  ) => void;
  onDeletePosition: (position: Position) => void;
}) {
  const [sectionLabel, setSectionLabel] = useState("");
  const [editingSection, setEditingSection] = useState<Record<number, string>>({});
  const [positionLabel, setPositionLabel] = useState<Record<number, string>>({});
  const [editingPosition, setEditingPosition] = useState<Record<number, string>>({});

  const ordered = [...sections].sort((left, right) => left.sortOrder - right.sortOrder);

  function move(list: Array<{ id: number; sortOrder: number }>, index: number, delta: number) {
    const target = list[index + delta];
    if (!target) return null;
    return { id: list[index].id, sortOrder: target.sortOrder, otherId: target.id, otherSortOrder: list[index].sortOrder };
  }

  return (
    <section className="settings-panel profile-settings-card">
      <div className="settings-panel-title">
        <LayoutList size={20} />
        <span>Mục và vị trí khám</span>
      </div>
      <p className="profile-settings-intro">
        Mỗi vị trí khám là một hàng của bảng lịch và có cấu hình tua riêng. Xóa mục sẽ xóa toàn bộ vị trí bên trong.
      </p>

      <form
        className="form-inline"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!sectionLabel.trim()) return;
          if (await onCreateSection(sectionLabel.trim())) setSectionLabel("");
        }}
      >
        <input
          value={sectionLabel}
          onChange={(event) => setSectionLabel(event.target.value)}
          placeholder="Tên mục, ví dụ: I. KHÁM LÂM SÀNG"
          aria-label="Tên mục lịch"
          maxLength={160}
        />
        <button type="submit" className="primary-btn"><Plus size={16} /> Thêm mục</button>
      </form>

      {ordered.length === 0 && <span className="empty-note">Chưa có mục nào. Hãy thêm mục đầu tiên.</span>}

      <div className="section-manager">
        {ordered.map((section, sectionIndex) => {
          const own = positions
            .filter((position) => position.sectionId === section.id)
            .sort((left, right) => left.sortOrder - right.sortOrder);
          const sectionDraft = editingSection[section.id];
          return (
            <article className="section-card" key={section.id}>
              <header className="section-card-head">
                {sectionDraft !== undefined ? (
                  <input
                    value={sectionDraft}
                    aria-label={`Tên mục ${section.label}`}
                    onChange={(event) =>
                      setEditingSection((prev) => ({ ...prev, [section.id]: event.target.value }))
                    }
                  />
                ) : (
                  <h3>{section.label}</h3>
                )}
                <div className="section-card-actions">
                  {sectionDraft !== undefined ? (
                    <>
                      <button
                        type="button"
                        className="tool-btn"
                        onClick={() => {
                          const next = sectionDraft.trim();
                          if (next) onUpdateSection(section.id, { label: next });
                          setEditingSection((prev) => {
                            const copy = { ...prev };
                            delete copy[section.id];
                            return copy;
                          });
                        }}
                      >
                        <Save size={15} /> Lưu
                      </button>
                      <button
                        type="button"
                        className="tool-btn"
                        onClick={() =>
                          setEditingSection((prev) => {
                            const copy = { ...prev };
                            delete copy[section.id];
                            return copy;
                          })
                        }
                      >
                        Hủy
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="tool-btn"
                      onClick={() => setEditingSection((prev) => ({ ...prev, [section.id]: section.label }))}
                    >
                      Sửa
                    </button>
                  )}
                  <button
                    type="button"
                    className="tool-btn"
                    disabled={sectionIndex === 0}
                    aria-label="Đưa mục lên trên"
                    onClick={() => {
                      const swap = move(ordered, sectionIndex, -1);
                      if (!swap) return;
                      onUpdateSection(swap.id, { sortOrder: swap.sortOrder });
                      onUpdateSection(swap.otherId, { sortOrder: swap.otherSortOrder });
                    }}
                  >
                    <ChevronUp size={15} />
                  </button>
                  <button
                    type="button"
                    className="tool-btn"
                    disabled={sectionIndex === ordered.length - 1}
                    aria-label="Đưa mục xuống dưới"
                    onClick={() => {
                      const swap = move(ordered, sectionIndex, 1);
                      if (!swap) return;
                      onUpdateSection(swap.id, { sortOrder: swap.sortOrder });
                      onUpdateSection(swap.otherId, { sortOrder: swap.otherSortOrder });
                    }}
                  >
                    <ChevronDown size={15} />
                  </button>
                  <button type="button" className="ghost-danger" onClick={() => onDeleteSection(section)}>
                    <Trash2 size={15} /> Xóa mục
                  </button>
                </div>
              </header>

              <div className="position-list">
                {own.length === 0 && <span className="empty-note">Chưa có vị trí khám trong mục này.</span>}
                {own.map((position, positionIndex) => {
                  const draft = editingPosition[position.id];
                  return (
                    <div className="position-row" key={position.id}>
                      {draft !== undefined ? (
                        <input
                          value={draft}
                          aria-label={`Tên vị trí ${position.label}`}
                          onChange={(event) =>
                            setEditingPosition((prev) => ({ ...prev, [position.id]: event.target.value }))
                          }
                        />
                      ) : (
                        <span className="position-name">
                          {position.label}
                          {!position.active && <em> (đã tắt)</em>}
                        </span>
                      )}
                      <div className="position-row-actions">
                        {draft !== undefined ? (
                          <>
                            <button
                              type="button"
                              className="tool-btn"
                              onClick={() => {
                                const next = draft.trim();
                                if (next) onUpdatePosition(position.id, { label: next });
                                setEditingPosition((prev) => {
                                  const copy = { ...prev };
                                  delete copy[position.id];
                                  return copy;
                                });
                              }}
                            >
                              <Save size={15} /> Lưu
                            </button>
                            <button
                              type="button"
                              className="tool-btn"
                              onClick={() =>
                                setEditingPosition((prev) => {
                                  const copy = { ...prev };
                                  delete copy[position.id];
                                  return copy;
                                })
                              }
                            >
                              Hủy
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="tool-btn"
                            onClick={() => setEditingPosition((prev) => ({ ...prev, [position.id]: position.label }))}
                          >
                            Sửa
                          </button>
                        )}
                        <button
                          type="button"
                          className="tool-btn"
                          disabled={positionIndex === 0}
                          aria-label="Đưa vị trí lên trên"
                          onClick={() => {
                            const swap = move(own, positionIndex, -1);
                            if (!swap) return;
                            onUpdatePosition(swap.id, { sortOrder: swap.sortOrder });
                            onUpdatePosition(swap.otherId, { sortOrder: swap.otherSortOrder });
                          }}
                        >
                          <ChevronUp size={15} />
                        </button>
                        <button
                          type="button"
                          className="tool-btn"
                          disabled={positionIndex === own.length - 1}
                          aria-label="Đưa vị trí xuống dưới"
                          onClick={() => {
                            const swap = move(own, positionIndex, 1);
                            if (!swap) return;
                            onUpdatePosition(swap.id, { sortOrder: swap.sortOrder });
                            onUpdatePosition(swap.otherId, { sortOrder: swap.otherSortOrder });
                          }}
                        >
                          <ChevronDown size={15} />
                        </button>
                        <button
                          type="button"
                          className="tool-btn"
                          onClick={() => onUpdatePosition(position.id, { active: !position.active })}
                        >
                          {position.active ? "Tắt" : "Bật"}
                        </button>
                        <button type="button" className="ghost-danger" onClick={() => onDeletePosition(position)}>
                          <Trash2 size={15} /> Xóa
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <form
                className="form-inline"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const label = (positionLabel[section.id] || "").trim();
                  if (!label) return;
                  if (await onCreatePosition(section.id, label)) {
                    setPositionLabel((prev) => ({ ...prev, [section.id]: "" }));
                  }
                }}
              >
                <input
                  value={positionLabel[section.id] || ""}
                  onChange={(event) =>
                    setPositionLabel((prev) => ({ ...prev, [section.id]: event.target.value }))
                  }
                  placeholder="Tên vị trí khám, ví dụ: Khám nội"
                  aria-label={`Thêm vị trí khám vào ${section.label}`}
                  maxLength={160}
                />
                <button type="submit" className="tool-btn"><Plus size={15} /> Thêm vị trí</button>
              </form>
            </article>
          );
        })}
      </div>
    </section>
  );
}

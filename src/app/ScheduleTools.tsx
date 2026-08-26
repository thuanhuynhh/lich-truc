import { useState } from "react";
import { CalendarDays, CalendarPlus, ListOrdered, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import type { DaySession, Department, Rotation, ScheduleResponse, WorkDay } from "../shared/types";
import {
  DAY_SESSIONS,
  SESSION_LABELS,
  formatFullDate,
  formatMonthLabel,
  getDayOfWeekLabel,
  monthRange,
  todayInVietnam
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
  const [session, setSession] = useState<DaySession>("full");
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<Record<string, { session: DaySession; note: string }>>({});

  const assignmentCount = (workDay: WorkDay) =>
    data.assignments.filter((assignment) => assignment.date === workDay.date).length;

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
        {data.workDays.length === 0 ? (
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
            {data.workDays.map((workDay) => {
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
  month,
  departments,
  rotation,
  workDayCount,
  onClose,
  onSave,
  onApply
}: {
  month: string;
  departments: Department[];
  rotation: Rotation | null;
  workDayCount: number;
  onClose: () => void;
  onSave: (payload: { startDate: string; turns: number[][] }) => void;
  onApply: (payload: { startDate: string; turns: number[][] }) => void;
}) {
  const activeDepartments = departments.filter((department) => department.active);
  const existingTurns = (rotation?.turns || [])
    .filter((turn) => Array.isArray(turn) && turn.length > 0)
    .map((turn) => turn.map((member) => member.departmentId));
  const [startDate, setStartDate] = useState(rotation?.startDate || monthRange(month).from);
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
            <h2>Tua khám của khoa phòng</h2>
            <p>
              Tua 1 áp cho ngày làm đầu tiên tính từ ngày bắt đầu, các ngày làm tiếp theo xoay lần lượt theo thứ tự tua.
              Tháng {formatMonthLabel(month).toLowerCase()} đang có {workDayCount} ngày làm.
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
            className="primary-btn"
            disabled={!valid}
            onClick={() => onApply({ startDate, turns })}
          >
            <RefreshCw size={15} /> Lưu và áp cho tháng này
          </button>
        </div>
      </div>
    </div>
  );
}

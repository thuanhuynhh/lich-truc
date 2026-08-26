import React, { useEffect, useRef, useState } from "react";
import { toBlob } from "html-to-image";
import {
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FileArchive,
  ImageDown,
  LoaderCircle,
  LockKeyhole,
  Printer,
  Save,
  Trash2
} from "lucide-react";
import { api } from "./api";
import { getReportExportPeriod, isDateInReportPeriod, type ReportExportRange } from "./reportExportPeriod";
import { SignaturePad } from "./SignaturePad";
import { downloadBlob } from "./scheduleExport";
import type { AttendanceEntry, CoordinatorAssignment, User, WorkDay, WorkReport, WorkReportSummary } from "../shared/types";
import { SESSION_LABELS, formatFullDate, formatVietnamDateTime, todayInVietnam } from "../shared/schedule";
import { attendanceSummary, canEditWorkReport, canManageSchedule, hasCoordinatorSignature } from "../shared/validation";

interface ReportViewProps {
  user: User;
  notify: (msg: string) => void;
  navigationTarget?: { date: string; requestId: number } | null;
}

export function ReportView({ user, notify, navigationTarget }: ReportViewProps) {
  const [reportsList, setReportsList] = useState<WorkReportSummary[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => navigationTarget?.date || todayInVietnam());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [currentReport, setCurrentReport] = useState<WorkReport | null>(null);
  const [workDay, setWorkDay] = useState<WorkDay | null>(null);
  const [attendance, setAttendance] = useState<AttendanceEntry[]>([]);
  const [dayCoordinators, setDayCoordinators] = useState<CoordinatorAssignment[]>([]);
  const [canSign, setCanSign] = useState(false);

  const [reportDate, setReportDate] = useState("");
  const [reportTime, setReportTime] = useState("07:00");
  const [soLuotKham, setSoLuotKham] = useState(0);
  const [soHoSo, setSoHoSo] = useState(0);
  const [vatTu, setVatTu] = useState("");
  const [suCo, setSuCo] = useState("");
  const [deXuat, setDeXuat] = useState("");

  const [exportingImage, setExportingImage] = useState(false);
  const [capturingImageLayout, setCapturingImageLayout] = useState(false);
  const [bulkExporting, setBulkExporting] = useState<ReportExportRange | null>(null);
  const [openExportMenu, setOpenExportMenu] = useState<"desktop" | "mobile" | null>(null);

  const requestSequence = useRef(0);
  const reportPaperRef = useRef<HTMLFormElement>(null);

  const isAdmin = user.role === "admin";
  const isScheduler = canManageSchedule(user.role);
  const reportLocked = !canEditWorkReport(user.role, currentReport);
  const coordinatorSigned = hasCoordinatorSignature(currentReport);
  const myEntry = attendance.find((entry) => entry.departmentId === user.departmentId);

  async function loadReportsList() {
    try {
      const res = await api.listReports();
      setReportsList(res.reports || []);
    } catch (error) {
      console.error(error);
    }
  }

  async function loadReportForDate(dateStr: string) {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setLoadError("");
    try {
      const res = await api.getReport(dateStr);
      if (sequence !== requestSequence.current) return;
      setWorkDay(res.workDay);
      setAttendance(res.attendance || []);
      setDayCoordinators(res.coordinators || []);
      setCanSign(res.canSign);

      if (res.report) {
        setCurrentReport(res.report);
        setReportDate(res.report.reportDate);
        setReportTime(res.report.reportTime);
        setSoLuotKham(res.report.soLuotKham || 0);
        setSoHoSo(res.report.soHoSo || 0);
        setVatTu(res.report.vatTu || "");
        setSuCo(res.report.suCo || "");
        setDeXuat(res.report.deXuat || "");
      } else {
        setCurrentReport(null);
        setReportDate(dateStr);
        setReportTime("07:00");
        setSoLuotKham(0);
        setSoHoSo(0);
        setVatTu("");
        setSuCo("");
        setDeXuat("");
      }
    } catch (error) {
      if (sequence === requestSequence.current) {
        setCurrentReport(null);
        setWorkDay(null);
        setAttendance([]);
        setDayCoordinators([]);
        setLoadError(error instanceof Error ? error.message : "Không thể tải báo cáo");
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    void loadReportsList();
  }, []);

  useEffect(() => {
    void loadReportForDate(selectedDate);
  }, [selectedDate]);

  async function refreshCurrent() {
    await Promise.all([loadReportForDate(selectedDate), loadReportsList()]);
  }

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (reportLocked) {
      notify("Báo cáo đã được ký chốt nên chỉ quản lý mới sửa được số liệu.");
      return;
    }
    try {
      await api.saveReport({
        date: selectedDate,
        reportDate,
        reportTime,
        soLuotKham,
        soHoSo,
        vatTu,
        suCo,
        deXuat
      });
      notify("Đã lưu báo cáo làm việc. Các khoa phòng có thể điểm danh và ký tên.");
      await refreshCurrent();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Có lỗi xảy ra khi lưu");
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Xóa báo cáo làm việc ngày ${formatFullDate(selectedDate)}?`)) return;
    try {
      await api.deleteReport(selectedDate);
      notify("Đã xóa báo cáo làm việc.");
      await refreshCurrent();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Có lỗi xảy ra khi xóa báo cáo");
    }
  };

  const handleAttendance = async (payload: {
    assignmentId: number;
    present?: boolean;
    note?: string;
    signature?: string;
    signerName?: string;
    useStoredSignature?: boolean;
  }) => {
    try {
      await api.saveAttendance(payload);
      notify(payload.signature || payload.useStoredSignature ? "Đã ký tên báo cáo làm việc." : "Đã cập nhật điểm danh.");
      await refreshCurrent();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không lưu được điểm danh.");
    }
  };

  const handleCoordinatorSign = async (signerName: string, signature?: string, useStoredSignature = false) => {
    if (!currentReport) {
      notify("Hãy lưu báo cáo trước khi ký.");
      return;
    }
    try {
      await api.signReport({
        date: selectedDate,
        role: "dieu_phoi",
        signature,
        signerName,
        useStoredSignature
      });
      notify("Đã ký chốt báo cáo làm việc.");
      await refreshCurrent();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Ký tên thất bại");
    }
  };

  const exportReportsAsWordZip = async (range: ReportExportRange) => {
    if (!isScheduler || bulkExporting) return;
    setOpenExportMenu(null);
    setBulkExporting(range);
    try {
      const period = getReportExportPeriod(todayInVietnam(), range);
      const latestList = await api.listReports();
      const summaries = (latestList.reports || [])
        .filter((report) => report.report_time && isDateInReportPeriod(report.date, period))
        .sort((left, right) => left.date.localeCompare(right.date));

      if (summaries.length === 0) {
        notify(`Không có báo cáo làm việc trong ${period.label}.`);
        return;
      }

      const reports: WorkReport[] = [];
      const batchSize = 4;
      for (let index = 0; index < summaries.length; index += batchSize) {
        const batch = summaries.slice(index, index + batchSize);
        const results = await Promise.all(batch.map((summary) => api.getReport(summary.date)));
        results.forEach((result) => {
          if (result.report) reports.push(result.report);
        });
      }

      if (reports.length === 0) {
        notify(`Không có báo cáo làm việc trong ${period.label}.`);
        return;
      }

      const { createWorkReportsZip } = await import("./reportWordExport");
      downloadBlob(await createWorkReportsZip(reports), period.filename);
      notify(`Đã xuất ${reports.length} file Word trong ZIP (${period.label}).`);
    } catch (error) {
      console.error(error);
      notify(error instanceof Error ? `Xuất Word thất bại: ${error.message}` : "Xuất Word thất bại.");
    } finally {
      setBulkExporting(null);
    }
  };

  const exportReportImage = async () => {
    const reportPaper = reportPaperRef.current;
    if (!reportPaper || !currentReport || exportingImage) return;

    const placeholderFields = Array.from(
      reportPaper.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[placeholder]")
    ).map((field) => ({ field, placeholder: field.getAttribute("placeholder") }));
    let placeholdersHidden = false;
    const restorePlaceholders = () => {
      if (!placeholdersHidden) return;
      placeholderFields.forEach(({ field, placeholder }) => {
        if (placeholder === null) field.removeAttribute("placeholder");
        else field.setAttribute("placeholder", placeholder);
      });
      placeholdersHidden = false;
    };

    setExportingImage(true);
    setCapturingImageLayout(true);

    try {
      await document.fonts.ready;
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      placeholderFields.forEach(({ field }) => field.removeAttribute("placeholder"));
      placeholdersHidden = true;

      const blob = await toBlob(reportPaper, {
        backgroundColor: "#ffffff",
        cacheBust: true,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2)
      });
      if (!blob) throw new Error("Không thể tạo dữ liệu ảnh");
      restorePlaceholders();
      setCapturingImageLayout(false);

      const filename = `bao-cao-lam-viec-${selectedDate}.png`;
      const file = new File([blob], filename, { type: "image/png" });
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
        || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

      if (isMobile && navigator.share && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: "Báo cáo làm việc",
            text: `Báo cáo làm việc ngày ${formatFullDate(selectedDate)}`
          });
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
        }
      }

      if (isMobile && navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          notify("Đã copy ảnh báo cáo. Bạn có thể dán vào ứng dụng cần gửi.");
          return;
        } catch {
          // Trình duyệt không cho ghi ảnh vào clipboard: tải file làm phương án cuối.
        }
      }

      downloadBlob(blob, filename);
      notify("Đã xuất ảnh báo cáo.");
    } catch (error) {
      console.error(error);
      notify(error instanceof Error ? `Xuất ảnh thất bại: ${error.message}` : "Xuất ảnh thất bại");
    } finally {
      restorePlaceholders();
      setCapturingImageLayout(false);
      setExportingImage(false);
    }
  };

  const renderSidebar = (placement: "desktop" | "mobile") => (
    <aside className={`report-sidebar report-sidebar-${placement}`}>
      <div className="sidebar-header">
        <h3>Ngày làm việc gần đây</h3>
        {isScheduler && (
          <div
            className="report-export-dropdown"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpenExportMenu(null);
            }}
          >
            <button
              type="button"
              className="primary-btn mini-btn report-export-trigger"
              onClick={() => {
                if (!bulkExporting) setOpenExportMenu((current) => (current === placement ? null : placement));
              }}
              disabled={bulkExporting !== null}
              aria-haspopup="menu"
              aria-expanded={openExportMenu === placement}
              title="Xuất nhiều báo cáo thành file ZIP"
            >
              {bulkExporting ? (
                <LoaderCircle className="report-image-spinner" size={16} aria-hidden="true" />
              ) : (
                <FileArchive size={16} aria-hidden="true" />
              )}
              <span>{bulkExporting ? "Đang xuất" : "Xuất Word"}</span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            {openExportMenu === placement && (
              <div className="report-export-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => void exportReportsAsWordZip("last15")}>
                  15 ngày gần nhất
                </button>
                <button type="button" role="menuitem" onClick={() => void exportReportsAsWordZip("currentMonth")}>
                  Tháng này
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="report-dates-list">
        {reportsList.length === 0 ? (
          <div className="empty-list-text">Chưa có ngày làm việc nào.</div>
        ) : (
          reportsList.map((item) => (
            <button
              key={item.date}
              type="button"
              className={`report-date-item-btn ${selectedDate === item.date ? "active" : ""}`}
              onClick={() => setSelectedDate(item.date)}
            >
              <div className="date-item-title">
                {formatFullDate(item.date)} · {SESSION_LABELS[item.session]}
              </div>
              <div className="date-item-staff">
                <span>{attendanceSummary(Number(item.present_count || 0), Number(item.total_count || 0))}</span>
                <span>{item.report_time ? "Đã có báo cáo" : "Chưa có báo cáo"}</span>
              </div>
            </button>
          ))
        )}
      </div>
    </aside>
  );

  return (
    <main className="report-main-grid">
      {renderSidebar("desktop")}

      <div className="report-content-panel">
        <div className="report-toolbar">
          <div className="report-date-picker-nav">
            <button
              type="button"
              className="icon-btn"
              onClick={() => shiftToNeighbourDay(-1)}
              title="Ngày làm trước"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="report-date-selector">
              <Calendar size={18} />
              <input
                type="date"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
                className="report-date-input"
              />
            </div>
            <button type="button" className="icon-btn" onClick={() => shiftToNeighbourDay(1)} title="Ngày làm sau">
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="report-action-buttons" style={{ display: "flex", gap: 8 }}>
            {isAdmin && currentReport && (
              <button type="button" className="tool-btn danger-tool report-delete-button" onClick={handleDelete}>
                <Trash2 size={16} /> Xóa báo cáo
              </button>
            )}
            <button
              type="button"
              className="tool-btn report-image-button"
              onClick={() => void exportReportImage()}
              disabled={!currentReport || exportingImage}
              title="Xuất ảnh báo cáo"
            >
              {exportingImage ? <LoaderCircle className="report-image-spinner" size={16} /> : <ImageDown size={16} />}
              <span className="report-image-label">{exportingImage ? "Đang xuất" : "Xuất ảnh"}</span>
            </button>
            <button
              type="button"
              className="tool-btn report-print-button"
              onClick={() => window.print()}
              disabled={!currentReport}
              title="In báo cáo"
            >
              <Printer size={16} /> <span className="report-print-label">In báo cáo</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="report-loading-container">Đang tải dữ liệu báo cáo...</div>
        ) : loadError ? (
          <div className="report-loading-container">{loadError}</div>
        ) : (
          <div className="report-layout-wrapper">
            <form
              ref={reportPaperRef}
              className={`report-paper-form${capturingImageLayout ? " report-exporting-image" : ""}${
                reportLocked ? " report-locked" : ""
              }`}
              onSubmit={handleSave}
            >
              <div className="paper-header">
                <div className="paper-header-left">
                  <h4>SỞ Y TẾ</h4>
                  <h5>BAN CHỈ ĐẠO KHÁM SỨC KHỎE TOÀN DÂN</h5>
                </div>
                <div className="paper-header-right">
                  <h4>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</h4>
                  <h5>Độc lập - Tự do - Hạnh phúc</h5>
                </div>
              </div>

              <div className="paper-title-area">
                <h2>BÁO CÁO LÀM VIỆC</h2>
                <div className="report-time-input-row">
                  Hôm nay, vào lúc{" "}
                  <input
                    type="text"
                    value={reportTime}
                    onChange={(event) => setReportTime(event.target.value)}
                    readOnly={reportLocked || !isScheduler}
                    placeholder="7 giờ 00"
                    className="paper-inline-input time-hour no-print"
                    style={{ width: "90px" }}
                    required
                  />
                  <span className="print-only underline-date">{reportTime}</span> ngày{" "}
                  <input
                    type="date"
                    value={reportDate}
                    onChange={(event) => setReportDate(event.target.value)}
                    readOnly={reportLocked || !isScheduler}
                    className="paper-date-input-inline no-print"
                    required
                  />
                  <span className="print-only underline-date">{formatFullDate(reportDate)}</span>, sau khi kết thúc buổi
                  làm việc{" "}
                  <span className="underline-date">
                    {workDay ? SESSION_LABELS[workDay.session].toLowerCase() : ""} ngày {formatFullDate(selectedDate)}
                  </span>
                  , chúng tôi xin báo cáo:
                </div>
                {workDay?.note && <p className="paper-note">Địa điểm / ghi chú: {workDay.note}</p>}
              </div>

              <div className="paper-section">
                <h3>I. Điểm danh nhân sự tham gia:</h3>
                {attendance.length === 0 ? (
                  <span className="empty-note">Ngày này chưa có khoa phòng nào được phân công.</span>
                ) : (
                  <div className="attendance-table" role="table">
                    <div className="attendance-head" role="row">
                      <span role="columnheader">Vị trí khám</span>
                      <span role="columnheader">Khoa phòng</span>
                      <span role="columnheader">Người làm việc</span>
                      <span role="columnheader">Điện thoại</span>
                      <span role="columnheader">Có mặt</span>
                      <span role="columnheader">Chữ ký</span>
                    </div>
                    {attendance.map((entry) => {
                      const isMine = entry.departmentId === user.departmentId;
                      const canMarkPresent = isScheduler || (isMine && canSign);
                      return (
                        <div className="attendance-row" role="row" key={entry.assignmentId}>
                          <strong>{entry.positionLabel}</strong>
                          <span>{entry.departmentName}</span>
                          <span>{entry.personName || "Chưa điền tên"}</span>
                          <span>{entry.personPhone || "—"}</span>
                          <span className="attendance-present">
                            {canMarkPresent && currentReport ? (
                              <input
                                type="checkbox"
                                checked={entry.present}
                                aria-label={`Điểm danh ${entry.departmentName}`}
                                onChange={(event) =>
                                  void handleAttendance({
                                    assignmentId: entry.assignmentId,
                                    present: event.target.checked
                                  })
                                }
                              />
                            ) : (
                              <span className={entry.present ? "status-ok" : "status-off"}>
                                {entry.present ? "Có mặt" : "Chưa"}
                              </span>
                            )}
                          </span>
                          <div className="attendance-signature">
                            {entry.signature ? (
                              <div className="saved-signature-display">
                                <img
                                  src={entry.signature}
                                  alt={`Chữ ký ${entry.departmentName} tại ${entry.positionLabel}`}
                                />
                                <div className="signature-signer-name">{entry.signatureName}</div>
                                <div className="signature-time no-print">
                                  Đã ký: {formatVietnamDateTime(entry.signatureAt)}
                                </div>
                              </div>
                            ) : isMine && canSign && currentReport ? (
                              <SignaturePad
                                label={`Ký tên ${entry.departmentName} · ${entry.positionLabel}`}
                                defaultName={user.fullName || entry.personName || ""}
                                storedSignature={user.signature}
                                onQuickSave={(name) =>
                                  void handleAttendance({
                                    assignmentId: entry.assignmentId,
                                    present: true,
                                    signerName: name,
                                    useStoredSignature: true
                                  })
                                }
                                onSave={(sig, name) =>
                                  void handleAttendance({
                                    assignmentId: entry.assignmentId,
                                    present: true,
                                    signerName: name,
                                    signature: sig
                                  })
                                }
                              />
                            ) : (
                              <p className="no-sig-text">Chưa ký</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="paper-section">
                <h3>II. Số liệu công việc:</h3>
                <div className="paper-numeric-grid">
                  <div className="numeric-field-row">
                    <span>- Số lượt người được khám:</span>
                    <input
                      type="number"
                      min={0}
                      value={soLuotKham}
                      onChange={(event) => setSoLuotKham(Number(event.target.value))}
                      readOnly={reportLocked || !isScheduler}
                      className="paper-underline-input numeric-input"
                    />
                    <span>lượt</span>
                  </div>
                  <div className="numeric-field-row">
                    <span>- Số hồ sơ hoàn thành:</span>
                    <input
                      type="number"
                      min={0}
                      value={soHoSo}
                      onChange={(event) => setSoHoSo(Number(event.target.value))}
                      readOnly={reportLocked || !isScheduler}
                      className="paper-underline-input numeric-input"
                    />
                    <span>hồ sơ</span>
                  </div>
                </div>
                <div className="paper-field-block">
                  <label>- Vật tư, thuốc sử dụng:</label>
                  <input
                    type="text"
                    value={vatTu}
                    onChange={(event) => setVatTu(event.target.value)}
                    readOnly={reportLocked || !isScheduler}
                    placeholder="Ví dụ: 120 bộ test đường huyết"
                    className="paper-underline-input full-width"
                  />
                </div>
              </div>

              <div className="paper-section">
                <h3>III. Sự cố, vấn đề phát sinh:</h3>
                <textarea
                  rows={3}
                  value={suCo}
                  onChange={(event) => setSuCo(event.target.value)}
                  readOnly={reportLocked || !isScheduler}
                  placeholder="Không có"
                  className="paper-textarea-input"
                />
              </div>

              <div className="paper-section">
                <h3>IV. Đề xuất, kiến nghị:</h3>
                <textarea
                  rows={3}
                  value={deXuat}
                  onChange={(event) => setDeXuat(event.target.value)}
                  readOnly={reportLocked || !isScheduler}
                  placeholder="Không có"
                  className="paper-textarea-input"
                />
              </div>

              {reportLocked && (
                <div className="report-lock-notice no-print" role="status">
                  <LockKeyhole size={20} aria-hidden="true" />
                  <span>Báo cáo đã được điều phối ký chốt. Chỉ tài khoản quản lý còn sửa được số liệu.</span>
                </div>
              )}

              {isScheduler && (
                <div className="report-save-bar">
                  <button type="submit" className="primary-btn" disabled={reportLocked}>
                    <Save size={16} /> {currentReport ? "Lưu báo cáo" : "Tạo báo cáo làm việc"}
                  </button>
                </div>
              )}

              {!currentReport && (
                <div className="signature-reminder no-print" role="status">
                  <CircleAlert size={20} aria-hidden="true" />
                  <span>
                    {isScheduler
                      ? "Ngày này chưa có báo cáo. Hãy tạo báo cáo để các khoa phòng điểm danh và ký tên."
                      : "Điều phối chưa tạo báo cáo cho ngày này nên chưa thể điểm danh và ký tên."}
                  </span>
                </div>
              )}

              {myEntry && !myEntry.signature && currentReport && (
                <div className="signature-reminder no-print" role="status">
                  <CircleAlert size={20} aria-hidden="true" />
                  <span>
                    Khoa phòng <strong>{myEntry.departmentName}</strong> chưa ký tên cho buổi làm việc này.
                  </span>
                </div>
              )}

              <div className="paper-signatures-section">
                <div className="signature-col">
                  <h4>ĐIỀU PHỐI</h4>
                  <p className="signature-role-hint">
                    {dayCoordinators.length > 0
                      ? dayCoordinators.map((item) => item.fullName || item.username).join(", ")
                      : "Chưa xếp điều phối cho ngày này"}
                  </p>
                  {currentReport?.signatureDieuPhoi ? (
                    <div className="saved-signature-display">
                      <img src={currentReport.signatureDieuPhoi} alt="Chữ ký điều phối" />
                      <div className="signature-signer-name">{currentReport.signatureDieuPhoiName}</div>
                      <div className="signature-time no-print">
                        Đã ký: {formatVietnamDateTime(currentReport.signatureDieuPhoiAt)}
                      </div>
                    </div>
                  ) : isScheduler && canSign && currentReport ? (
                    <SignaturePad
                      label="Ký chốt báo cáo"
                      defaultName={user.fullName || user.username}
                      storedSignature={user.signature}
                      onQuickSave={(name) => void handleCoordinatorSign(name, undefined, true)}
                      onSave={(sig, name) => void handleCoordinatorSign(name, sig)}
                    />
                  ) : (
                    <p className="no-sig-text">Chưa ký</p>
                  )}
                  {coordinatorSigned && (
                    <p className="signature-role-hint no-print">
                      {attendanceSummary(attendance.filter((entry) => entry.present).length, attendance.length)}
                    </p>
                  )}
                </div>
              </div>
            </form>
          </div>
        )}
      </div>
      {renderSidebar("mobile")}
    </main>
  );

  /** Nhảy tới ngày làm liền trước hoặc liền sau trong danh sách ngày làm. */
  function shiftToNeighbourDay(direction: -1 | 1) {
    const dates = reportsList.map((item) => item.date).sort((left, right) => left.localeCompare(right));
    if (dates.length === 0) return;
    const candidates = direction === 1
      ? dates.filter((date) => date > selectedDate)
      : dates.filter((date) => date < selectedDate).reverse();
    if (candidates.length > 0) setSelectedDate(candidates[0]);
  }
}

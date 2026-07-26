import React, { useState, useEffect, useRef } from "react";
import { toBlob } from "html-to-image";
import { api } from "./api";
import {
  getReportExportPeriod,
  isDateInReportPeriod,
  type ReportExportRange
} from "./reportExportPeriod";
import { SignaturePad } from "./SignaturePad";
import type { User, DutyReport, DutyReportSummary } from "../shared/types";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, FileArchive, ImageDown, LoaderCircle, LockKeyhole, Plus, Printer, Save, Trash2 } from "lucide-react";
import { addDays, formatVietnamDateTime, todayInVietnam } from "../shared/schedule";
import { canEditDutyReport, hasReportSignature } from "../shared/validation";

interface ReportViewProps {
  user: User;
  notify: (msg: string) => void;
  navigationTarget?: { date: string; requestId: number } | null;
}

export function ReportView({ user, notify, navigationTarget }: ReportViewProps) {
  const [selectedDate, setSelectedDate] = useState(() => navigationTarget?.date || addDays(todayInVietnam(), -1));
  
  const [reportsList, setReportsList] = useState<DutyReportSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [exportingImage, setExportingImage] = useState(false);
  const [capturingImageLayout, setCapturingImageLayout] = useState(false);
  const [bulkExporting, setBulkExporting] = useState<ReportExportRange | null>(null);
  const [openExportMenu, setOpenExportMenu] = useState<"desktop" | "mobile" | null>(null);
  const [scheduledBs, setScheduledBs] = useState<string[]>([]);
  const [scheduledKtv, setScheduledKtv] = useState<string[]>([]);
  
  // Form states
  const [reportDate, setReportDate] = useState("");
  const [reportTime, setReportTime] = useState("07:00");
  const [bsTruc, setBsTruc] = useState("");
  const [ktvTruc, setKtvTruc] = useState("");
  const [xqKhoa, setXqKhoa] = useState(0);
  const [xqGiuong, setXqGiuong] = useState(0);
  const [mri, setMri] = useState(0);
  const [ctScan, setCtScan] = useState(0);
  const [thuocSuDung, setThuocSuDung] = useState("");
  const [caKho, setCaKho] = useState("");
  const [thietBi, setThietBi] = useState("Tốt");
  const [anNinh, setAnNinh] = useState("Tốt");
  
  // Signature and report details from server
  const [currentReport, setCurrentReport] = useState<DutyReport | null>(null);
  const reportRequestSequence = useRef(0);
  const reportPaperRef = useRef<HTMLFormElement>(null);

  const isAdmin = user.role === "admin";
  const isDoctor = user.role === "bs" || isAdmin;
  const isTechnician = user.role === "ktv" || isAdmin;
  const reportSigned = hasReportSignature(currentReport);
  const reportLocked = !canEditDutyReport(user.role, currentReport);
  const pendingSignatureLabel = currentReport
    ? user.role === "bs" && !currentReport.signatureBs
      ? "Bác sĩ trực"
      : user.role === "ktv" && !currentReport.signatureKtv
        ? "KTV trực"
        : isAdmin && !currentReport.signatureLanhdao
          ? "Lãnh đạo khoa"
          : null
    : null;

  // Load reports list
  const loadReportsList = async () => {
    try {
      const res = await api.listReports();
      setReportsList(res.reports || []);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadReportsList();
  }, []);

  // Load report for selected date
  const loadReportForDate = async (dateStr: string) => {
    const requestSequence = ++reportRequestSequence.current;
    setLoading(true);
    try {
      const res = await api.getReport(dateStr);
      if (requestSequence !== reportRequestSequence.current) return;
      setScheduledBs(res.scheduledBs || []);
      setScheduledKtv(res.scheduledKtv || []);
      
      if (res.report) {
        setCurrentReport(res.report);
        setReportDate(res.report.reportDate);
        setReportTime(res.report.reportTime);
        setBsTruc(res.report.bsTruc || "");
        setKtvTruc(res.report.ktvTruc || "");
        setXqKhoa(res.report.xqKhoa || 0);
        setXqGiuong(res.report.xqGiuong || 0);
        setMri(res.report.mri || 0);
        setCtScan(res.report.ctScan || 0);
        setThuocSuDung(res.report.thuocSuDung || "");
        setCaKho(res.report.caKho || "");
        setThietBi(res.report.thietBi || "");
        setAnNinh(res.report.anNinh || "");
      } else {
        // Pre-fill for new report
        setCurrentReport(null);
        setReportDate(addDays(dateStr, 1));
        setReportTime("07:00");
        setBsTruc(res.scheduledBs.join(", "));
        setKtvTruc(res.scheduledKtv.join(", "));
        setXqKhoa(0);
        setXqGiuong(0);
        setMri(0);
        setCtScan(0);
        setThuocSuDung("");
        setCaKho("");
        setThietBi("Tốt");
        setAnNinh("Tốt");
      }
    } catch (e) {
      if (requestSequence === reportRequestSequence.current) {
        notify(e instanceof Error ? e.message : "Không thể tải báo cáo");
      }
    } finally {
      if (requestSequence === reportRequestSequence.current) setLoading(false);
    }
  };

  useEffect(() => {
    loadReportForDate(selectedDate);
  }, [selectedDate]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reportLocked) {
      notify("Báo cáo đã có chữ ký nên không thể chỉnh sửa. Admin cần xóa và tạo lại nếu cần điều chỉnh.");
      return;
    }
    try {
      await api.saveReport({
        date: selectedDate,
        reportDate,
        reportTime,
        bsTruc,
        ktvTruc,
        xqKhoa,
        xqGiuong,
        mri,
        ctScan,
        thuocSuDung,
        caKho,
        thietBi,
        anNinh
      });
      notify("Đã lưu báo cáo trực. Vui lòng ký tên ở phần bên dưới để hoàn tất.");
      await loadReportForDate(selectedDate);
      await loadReportsList();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Có lỗi xảy ra khi lưu");
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa báo cáo trực ngày ${formatDisplayDate(selectedDate)}?`)) {
      return;
    }
    try {
      await api.deleteReport(selectedDate);
      notify("Đã xóa báo cáo trực thành công!");
      await loadReportForDate(selectedDate);
      await loadReportsList();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Có lỗi xảy ra khi xóa báo cáo");
    }
  };

  const handleSign = async (
    role: "bs" | "ktv" | "lanhdao",
    signerName: string,
    signature?: string,
    useStoredSignature = false
  ) => {
    if (!currentReport) {
      notify("Hãy lưu báo cáo trước khi ký.");
      return;
    }
    try {
      await api.signReport({
        date: selectedDate,
        role,
        signature,
        signerName,
        useStoredSignature
      });
      notify(`Đã ký tên vai trò ${role === "bs" ? "Bác sĩ trực" : role === "ktv" ? "KTV trực" : "Lãnh đạo khoa"} thành công!`);
      await loadReportForDate(selectedDate);
      await loadReportsList();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Ký tên thất bại");
    }
  };

  const navigateDate = (offset: number) => {
    setSelectedDate(addDays(selectedDate, offset));
  };

  const formatDisplayDate = (dateStr: string) => {
    if (!dateStr) return "";
    const parts = dateStr.split("-");
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  };

  const printReport = () => {
    window.print();
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = filename;
    link.href = url;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const exportReportsAsWordZip = async (range: ReportExportRange) => {
    if (!isAdmin || bulkExporting) return;

    setOpenExportMenu(null);
    setBulkExporting(range);

    try {
      const period = getReportExportPeriod(todayInVietnam(), range);
      const latestList = await api.listReports();
      const summaries = (latestList.reports || [])
        .filter((report) => isDateInReportPeriod(report.date, period))
        .sort((a, b) => a.date.localeCompare(b.date));

      if (summaries.length === 0) {
        notify(`Không có báo cáo trực trong ${period.label}.`);
        return;
      }

      const reports: DutyReport[] = [];
      const batchSize = 4;
      for (let index = 0; index < summaries.length; index += batchSize) {
        const batch = summaries.slice(index, index + batchSize);
        const results = await Promise.all(batch.map((summary) => api.getReport(summary.date)));
        results.forEach((result) => {
          if (result.report) reports.push(result.report);
        });
      }

      if (reports.length === 0) {
        notify(`Không có báo cáo trực trong ${period.label}.`);
        return;
      }

      const { createDutyReportsZip } = await import("./reportWordExport");
      const zipBlob = await createDutyReportsZip(reports);
      downloadBlob(zipBlob, period.filename);
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

      const filename = `bao-cao-truc-${selectedDate}.png`;
      const file = new File([blob], filename, { type: "image/png" });
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
        || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

      if (isMobile && navigator.share && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: "Báo cáo trực",
            text: `Báo cáo trực ngày ${formatDisplayDate(selectedDate)}`
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

  const renderReportSidebar = (placement: "desktop" | "mobile") => (
    <aside className={`report-sidebar report-sidebar-${placement}`}>
      <div className="sidebar-header">
        <h3>Báo cáo trực gần đây</h3>
        {isAdmin ? (
          <div
            className="report-export-dropdown"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setOpenExportMenu(null);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setOpenExportMenu(null);
                event.currentTarget.querySelector<HTMLButtonElement>(".report-export-trigger")?.focus();
              }
            }}
          >
            <button
              type="button"
              className="primary-btn mini-btn report-export-trigger"
              onClick={() => {
                if (!bulkExporting) {
                  setOpenExportMenu((current) => current === placement ? null : placement);
                }
              }}
              disabled={bulkExporting !== null}
              aria-haspopup="menu"
              aria-expanded={openExportMenu === placement}
              aria-controls={`report-export-menu-${placement}`}
              title="Xuất nhiều báo cáo thành file ZIP"
            >
              {bulkExporting
                ? <LoaderCircle className="report-image-spinner" size={16} aria-hidden="true" />
                : <FileArchive size={16} aria-hidden="true" />}
              <span>{bulkExporting ? "Đang xuất" : "Xuất Word"}</span>
              <ChevronDown
                className={openExportMenu === placement ? "report-export-chevron open" : "report-export-chevron"}
                size={14}
                aria-hidden="true"
              />
            </button>
            {openExportMenu === placement && (
              <div
                id={`report-export-menu-${placement}`}
                className="report-export-menu"
                role="menu"
                aria-label="Chọn khoảng thời gian xuất báo cáo"
              >
                <button type="button" role="menuitem" onClick={() => void exportReportsAsWordZip("last15")}>
                  15 ngày gần nhất
                </button>
                <button type="button" role="menuitem" onClick={() => void exportReportsAsWordZip("currentMonth")}>
                  Tháng này
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            className="primary-btn mini-btn"
            onClick={() => {
              setSelectedDate(todayInVietnam());
            }}
            title="Tạo báo cáo ngày hôm nay"
          >
            <Plus size={16} /> Hôm nay
          </button>
        )}
      </div>
      <div className="report-dates-list">
        {reportsList.length === 0 ? (
          <div className="empty-list-text">Chưa có báo cáo nào được ghi nhận.</div>
        ) : (
          reportsList.map((rep) => (
            <button
              key={rep.date}
              type="button"
              className={`report-date-item-btn ${selectedDate === rep.date ? "active" : ""}`}
              onClick={() => setSelectedDate(rep.date)}
            >
              <div className="date-item-title">Ca trực: {formatDisplayDate(rep.date)}</div>
              <div className="date-item-staff">
                <span>BS: {rep.bs_truc || "Chưa ghi"}</span>
                <span>KTV: {rep.ktv_truc || "Chưa ghi"}</span>
              </div>
            </button>
          ))
        )}
      </div>
    </aside>
  );

  return (
    <main className="report-main-grid">
      {renderReportSidebar("desktop")}

      {/* Main content: Form báo cáo & Báo cáo giấy */}
      <div className="report-content-panel">
        <div className="report-toolbar">
          <div className="report-date-picker-nav">
            <button type="button" className="icon-btn" onClick={() => navigateDate(-1)} title="Ngày trước">
              <ChevronLeft size={18} />
            </button>
            <div className="report-date-selector">
              <Calendar size={18} />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="report-date-input"
              />
            </div>
            <button type="button" className="icon-btn" onClick={() => navigateDate(1)} title="Ngày sau">
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
              aria-label={exportingImage ? "Đang xuất ảnh báo cáo" : "Xuất ảnh báo cáo"}
              title="Xuất ảnh báo cáo"
            >
              {exportingImage ? <LoaderCircle className="report-image-spinner" size={16} /> : <ImageDown size={16} />}
              <span className="report-image-label">{exportingImage ? "Đang xuất" : "Xuất ảnh"}</span>
            </button>
            <button
              type="button"
              className="tool-btn report-print-button"
              onClick={printReport}
              disabled={!currentReport}
              aria-label="In báo cáo"
              title="In báo cáo"
            >
              <Printer size={16} /> <span className="report-print-label">In báo cáo</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="report-loading-container">Đang tải dữ liệu báo cáo...</div>
        ) : (
          <div className="report-layout-wrapper">
            {/* Form edit fields */}
            <form
              ref={reportPaperRef}
              className={`report-paper-form${capturingImageLayout ? " report-exporting-image" : ""}${reportLocked ? " report-locked" : ""}`}
              onSubmit={handleSave}
            >
              {/* Header của báo cáo giấy */}
              <div className="paper-header">
                <div className="paper-header-left">
                  <h4>BỆNH VIỆN THỐNG NHẤT</h4>
                  <h5>Khoa Ngoại Tiêu Hóa</h5>
                </div>
                <div className="paper-header-right">
                  <h4>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</h4>
                  <h5>Độc lập - Tự do - Hạnh phúc</h5>
                </div>
              </div>

              <div className="paper-title-area">
                <h2>BÁO CÁO TRỰC</h2>
                <div className="report-time-input-row">
                  Hôm nay, vào lúc{" "}
                  <input
                    type="text"
                    value={reportTime}
                    onChange={(e) => setReportTime(e.target.value)}
                    readOnly={reportLocked}
                    placeholder="7 giờ 00"
                    className="paper-inline-input time-hour no-print"
                    style={{ width: "90px" }}
                    required
                  />
                  <span className="print-only underline-date">{reportTime}</span>{" "}
                  ngày{" "}
                  <input
                    type="date"
                    value={reportDate}
                    onChange={(e) => setReportDate(e.target.value)}
                    readOnly={reportLocked}
                    className="paper-date-input-inline no-print"
                    required
                  />
                  <span className="print-only underline-date">{formatDisplayDate(reportDate)}</span>
                  , tại Khoa Ngoại Tiêu Hóa. Sau khi kết thúc ca trực ngày{" "}
                  <span className="underline-date">{formatDisplayDate(selectedDate)}</span>
                  , chúng tôi xin báo cáo:
                </div>
              </div>

              {/* Phần I: Nhân sự */}
              <div className="paper-section">
                <h3>I. Tình hình nhân sự:</h3>
                <div className="paper-field-row staff-field-row">
                  <label>1. BS trực:</label>
                  <input
                    type="text"
                    value={bsTruc}
                    onChange={(e) => setBsTruc(e.target.value)}
                    readOnly={reportLocked}
                    placeholder="Điền tên bác sĩ trực"
                    className="paper-underline-input"
                  />
                  {scheduledBs.length > 0 && (
                    <span className="suggested-staff-hint">
                      (Lịch: {scheduledBs.join(", ")})
                    </span>
                  )}
                </div>
                <div className="paper-field-row staff-field-row">
                  <label>2. KTV trực:</label>
                  <input
                    type="text"
                    value={ktvTruc}
                    onChange={(e) => setKtvTruc(e.target.value)}
                    readOnly={reportLocked}
                    placeholder="Điền tên kỹ thuật viên trực"
                    className="paper-underline-input"
                  />
                  {scheduledKtv.length > 0 && (
                    <span className="suggested-staff-hint">
                      (Lịch: {scheduledKtv.join(", ")})
                    </span>
                  )}
                </div>
              </div>

              {/* Phần II: Chuyên môn */}
              <div className="paper-section">
                <h3>II. Tình hình chuyên môn:</h3>
                <div className="paper-numeric-grid">
                  <div className="numeric-field-row">
                    <span>- Số ca chụp X-quang tại khoa:</span>
                    <input
                      type="number"
                      value={xqKhoa}
                      onChange={(e) => setXqKhoa(Number(e.target.value))}
                      readOnly={reportLocked}
                      className="paper-underline-input numeric-input"
                    />
                    <span>ca</span>
                  </div>
                  <div className="numeric-field-row">
                    <span>- Số ca chụp X-quang tại giường:</span>
                    <input
                      type="number"
                      value={xqGiuong}
                      onChange={(e) => setXqGiuong(Number(e.target.value))}
                      readOnly={reportLocked}
                      className="paper-underline-input numeric-input"
                    />
                    <span>ca</span>
                  </div>
                  <div className="numeric-field-row">
                    <span>- Số ca chụp MRI:</span>
                    <input
                      type="number"
                      value={mri}
                      onChange={(e) => setMri(Number(e.target.value))}
                      readOnly={reportLocked}
                      className="paper-underline-input numeric-input"
                    />
                    <span>ca</span>
                  </div>
                  <div className="numeric-field-row">
                    <span>- Số ca chụp CT Scan:</span>
                    <input
                      type="number"
                      value={ctScan}
                      onChange={(e) => setCtScan(Number(e.target.value))}
                      readOnly={reportLocked}
                      className="paper-underline-input numeric-input"
                    />
                    <span>ca</span>
                  </div>
                </div>

                <div className="paper-field-block">
                  <label>- Thuốc sử dụng:</label>
                  <input
                    type="text"
                    value={thuocSuDung}
                    onChange={(e) => setThuocSuDung(e.target.value)}
                    readOnly={reportLocked}
                    placeholder="Ví dụ: 17 lọ Omni"
                    className="paper-underline-input full-width"
                  />
                </div>

                <div className="paper-field-block">
                  <label>- Các trường hợp bác sĩ đọc phim báo cáo ca khó cần lưu ý để hội chẩn:</label>
                  <textarea
                    rows={4}
                    value={caKho}
                    onChange={(e) => setCaKho(e.target.value)}
                    readOnly={reportLocked}
                    placeholder="Mô tả chi tiết ca khó cần lưu ý hội chẩn..."
                    className="paper-textarea-input"
                  />
                </div>
              </div>

              {/* Phần III: Dụng cụ và trang thiết bị */}
              <div className="paper-section">
                <h3>III. Tình hình dụng cụ và trang thiết bị:</h3>
                <input
                  type="text"
                  value={thietBi}
                  onChange={(e) => setThietBi(e.target.value)}
                  readOnly={reportLocked}
                  placeholder="Ví dụ: Đủ, ổn định"
                  className="paper-underline-input full-width"
                />
              </div>

              {/* Phần IV: An ninh trật tự */}
              <div className="paper-section">
                <h3>IV. Tình hình an ninh trật tự:</h3>
                <input
                  type="text"
                  value={anNinh}
                  onChange={(e) => setAnNinh(e.target.value)}
                  readOnly={reportLocked}
                  placeholder="Ví dụ: Tốt, ổn định"
                  className="paper-underline-input full-width"
                />
              </div>

              {/* Save Button for Report Details */}
              {reportSigned && (
                <div className="report-admin-edit-notice no-print" role="status">
                  <LockKeyhole size={20} aria-hidden="true" />
                  <span>Báo cáo đã có chữ ký. Bạn vẫn có thể chỉnh sửa và lưu lại nội dung; các chữ ký hiện tại được giữ nguyên.</span>
                </div>
              )}
              {reportLocked && (
                <div className="report-lock-notice no-print" role="status" aria-live="polite">
                  <LockKeyhole size={20} aria-hidden="true" />
                  <span>
                    Báo cáo đã có chữ ký nên nội dung đã được khóa. Admin cần xóa báo cáo và tạo lại nếu muốn điều chỉnh.
                  </span>
                </div>
              )}
              <div className="report-save-bar">
                <button
                  type="submit"
                  className="primary-btn"
                  disabled={reportLocked}
                  title={reportLocked ? "Báo cáo đã có chữ ký, không thể chỉnh sửa" : undefined}
                >
                  <Save size={16} /> Lưu thông tin báo cáo
                </button>
              </div>

              {pendingSignatureLabel && (
                <div className="signature-reminder no-print" role="status" aria-live="polite">
                  <CircleAlert size={20} aria-hidden="true" />
                  <span>
                    Báo cáo đã được lưu. Vui lòng ký tên tại mục <strong>{pendingSignatureLabel}</strong> bên dưới để hoàn tất.
                  </span>
                </div>
              )}

              {/* Signatures Area */}
              <div className="paper-signatures-section">
                {/* Lãnh đạo khoa */}
                <div className="signature-col">
                  <h4>LÃNH ĐẠO KHOA</h4>
                  {currentReport?.signatureLanhdao ? (
                    <div className="saved-signature-display">
                      <img src={currentReport.signatureLanhdao} alt="Chữ ký Lãnh đạo khoa" />
                      <div className="signature-signer-name">{currentReport.signatureLanhdaoName}</div>
                      <div className="signature-time no-print">
                        Đã ký: {formatVietnamDateTime(currentReport.signatureLanhdaoAt)}
                      </div>
                    </div>
                  ) : (
                    <div className="unsigned-placeholder" style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", alignItems: "center" }}>
                      {isAdmin ? (
                        <SignaturePad
                          label="Ký tên Lãnh đạo khoa"
                          defaultName={user.staffFullName || user.staffName || ""}
                          storedSignature={user.signature}
                          onQuickSave={(name) => handleSign("lanhdao", name, undefined, true)}
                          onSave={(sig, name) => handleSign("lanhdao", name, sig)}
                        />
                      ) : (
                        <p className="no-sig-text">Chưa ký</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Bác sĩ trực */}
                <div className="signature-col">
                  <h4>BÁC SĨ TRỰC</h4>
                  {currentReport?.signatureBs ? (
                    <div className="saved-signature-display">
                      <img src={currentReport.signatureBs} alt="Chữ ký Bác sĩ trực" />
                      <div className="signature-signer-name">{currentReport.signatureBsName}</div>
                      <div className="signature-time no-print">
                        Đã ký: {formatVietnamDateTime(currentReport.signatureBsAt)}
                      </div>
                    </div>
                  ) : (
                    <div className="unsigned-placeholder" style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", alignItems: "center" }}>
                      {isDoctor ? (
                        <SignaturePad
                          label="Ký tên Bác sĩ trực"
                          defaultName={user.staffFullName || user.staffName || ""}
                          storedSignature={user.signature}
                          onQuickSave={(name) => handleSign("bs", name, undefined, true)}
                          onSave={(sig, name) => handleSign("bs", name, sig)}
                        />
                      ) : (
                        <p className="no-sig-text">Chưa ký</p>
                      )}
                    </div>
                  )}
                </div>

                {/* KTV trực */}
                <div className="signature-col">
                  <h4>KTV TRỰC</h4>
                  {currentReport?.signatureKtv ? (
                    <div className="saved-signature-display">
                      <img src={currentReport.signatureKtv} alt="Chữ ký KTV trực" />
                      <div className="signature-signer-name">{currentReport.signatureKtvName}</div>
                      <div className="signature-time no-print">
                        Đã ký: {formatVietnamDateTime(currentReport.signatureKtvAt)}
                      </div>
                    </div>
                  ) : (
                    <div className="unsigned-placeholder" style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", alignItems: "center" }}>
                      {isTechnician ? (
                        <SignaturePad
                          label="Ký tên KTV trực"
                          defaultName={user.staffFullName || user.staffName || ""}
                          storedSignature={user.signature}
                          onQuickSave={(name) => handleSign("ktv", name, undefined, true)}
                          onSave={(sig, name) => handleSign("ktv", name, sig)}
                        />
                      ) : (
                        <p className="no-sig-text">Chưa ký</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </form>
          </div>
        )}
      </div>
      {renderReportSidebar("mobile")}
    </main>
  );
}

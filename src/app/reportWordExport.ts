import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType
} from "docx";
import JSZip from "jszip";
import { SESSION_LABELS, formatVietnamDateTime } from "../shared/schedule";
import type { AttendanceEntry, WorkReport } from "../shared/types";

const FONT = "Times New Roman";
const BODY_SIZE = 24;
const NO_BORDER = {
  style: BorderStyle.NONE,
  size: 0,
  color: "FFFFFF"
};
const TABLE_BORDERS = {
  top: NO_BORDER,
  bottom: NO_BORDER,
  left: NO_BORDER,
  right: NO_BORDER,
  insideHorizontal: NO_BORDER,
  insideVertical: NO_BORDER
};
const THIN_BORDER = { style: BorderStyle.SINGLE, size: 4, color: "94A3B8" };
const GRID_BORDERS = {
  top: THIN_BORDER,
  bottom: THIN_BORDER,
  left: THIN_BORDER,
  right: THIN_BORDER,
  insideHorizontal: THIN_BORDER,
  insideVertical: THIN_BORDER
};

function run(text: string, options: { bold?: boolean; italics?: boolean; size?: number } = {}) {
  return new TextRun({
    text,
    font: FONT,
    size: options.size ?? BODY_SIZE,
    bold: options.bold,
    italics: options.italics
  });
}

function paragraph(
  children: TextRun[] | string,
  options: {
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
    before?: number;
    after?: number;
  } = {}
) {
  return new Paragraph({
    children: typeof children === "string" ? [run(children)] : children,
    alignment: options.alignment,
    spacing: {
      before: options.before ?? 0,
      after: options.after ?? 80,
      line: 300
    }
  });
}

function sectionHeading(text: string) {
  return paragraph([run(text, { bold: true, size: 26 })], { before: 100, after: 60 });
}

function fieldLine(label: string, value: string | number, suffix = "") {
  return paragraph([run(label), run(`${value}${suffix}`)]);
}

function displayDate(date: string) {
  const [year, month, day] = date.split("-");
  return year && month && day ? `${day}/${month}/${year}` : date;
}

function valueOrFallback(value: string | null | undefined, fallback = "Không ghi nhận") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function signatureImage(dataUrl: string | null): ImageRun | null {
  if (!dataUrl) return null;
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;

  try {
    const binary = atob(match[2]);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new ImageRun({
      data: bytes,
      transformation: { width: 120, height: 56 },
      type: match[1] === "jpeg" ? "jpg" : "png"
    });
  } catch {
    return null;
  }
}

function textCell(text: string, widthPercent: number, options: { bold?: boolean; center?: boolean } = {}) {
  return new TableCell({
    width: { size: widthPercent, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.CENTER,
    children: [
      paragraph([run(text, { bold: options.bold, size: 22 })], {
        alignment: options.center ? AlignmentType.CENTER : undefined,
        after: 0
      })
    ]
  });
}

/** Bảng điểm danh: khoa phòng, người làm việc, số điện thoại, có mặt, chữ ký. */
function attendanceTable(attendance: AttendanceEntry[]): Table {
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      textCell("Khoa phòng", 26, { bold: true, center: true }),
      textCell("Người làm việc", 24, { bold: true, center: true }),
      textCell("Điện thoại", 16, { bold: true, center: true }),
      textCell("Có mặt", 10, { bold: true, center: true }),
      textCell("Chữ ký", 24, { bold: true, center: true })
    ]
  });

  const rows = attendance.map((entry) => {
    const image = signatureImage(entry.signature);
    return new TableRow({
      cantSplit: true,
      children: [
        textCell(entry.departmentName, 26),
        textCell(valueOrFallback(entry.personName, "Chưa điền"), 24),
        textCell(valueOrFallback(entry.personPhone, "—"), 16),
        textCell(entry.present ? "x" : "", 10, { center: true }),
        new TableCell({
          width: { size: 24, type: WidthType.PERCENTAGE },
          verticalAlign: VerticalAlign.CENTER,
          children: image
            ? [
                new Paragraph({ children: [image], alignment: AlignmentType.CENTER, spacing: { after: 20 } }),
                paragraph([run(valueOrFallback(entry.signatureName, ""), { size: 20 })], {
                  alignment: AlignmentType.CENTER,
                  after: 0
                })
              ]
            : [paragraph([run("Chưa ký", { italics: true, size: 20 })], { alignment: AlignmentType.CENTER, after: 0 })]
        })
      ]
    });
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: GRID_BORDERS,
    rows: [headerRow, ...rows]
  });
}

export function createWorkReportDocument(report: WorkReport): Document {
  const headerTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDERS,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 42, type: WidthType.PERCENTAGE },
            children: [
              paragraph([run("SỞ Y TẾ", { bold: true })], { alignment: AlignmentType.CENTER, after: 20 }),
              paragraph([run("BAN CHỈ ĐẠO KHÁM SỨC KHỎE TOÀN DÂN", { bold: true, size: 22 })], {
                alignment: AlignmentType.CENTER,
                after: 0
              })
            ]
          }),
          new TableCell({
            width: { size: 58, type: WidthType.PERCENTAGE },
            children: [
              paragraph([run("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM", { bold: true })], {
                alignment: AlignmentType.CENTER,
                after: 20
              }),
              paragraph([run("Độc lập - Tự do - Hạnh phúc", { bold: true, size: 22 })], {
                alignment: AlignmentType.CENTER,
                after: 0
              })
            ]
          })
        ]
      })
    ]
  });

  const coordinatorSignature = signatureImage(report.signatureDieuPhoi);
  const signatures = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDERS,
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: 55, type: WidthType.PERCENTAGE },
            children: [paragraph("", { after: 0 })]
          }),
          new TableCell({
            width: { size: 45, type: WidthType.PERCENTAGE },
            verticalAlign: VerticalAlign.TOP,
            children: [
              paragraph([run("ĐIỀU PHỐI", { bold: true })], { alignment: AlignmentType.CENTER, after: 80 }),
              coordinatorSignature
                ? new Paragraph({
                    children: [coordinatorSignature],
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 40 }
                  })
                : paragraph([run("Chưa ký", { italics: true })], { alignment: AlignmentType.CENTER, after: 80 }),
              paragraph([run(valueOrFallback(report.signatureDieuPhoiName, ""), { bold: true })], {
                alignment: AlignmentType.CENTER,
                after: 20
              }),
              ...(report.signatureDieuPhoiAt
                ? [
                    paragraph([run(`Đã ký: ${formatVietnamDateTime(report.signatureDieuPhoiAt)}`, { size: 18 })], {
                      alignment: AlignmentType.CENTER,
                      after: 0
                    })
                  ]
                : [])
            ]
          })
        ]
      })
    ]
  });

  const presentCount = report.attendance.filter((entry) => entry.present).length;

  return new Document({
    creator: "Hệ thống Lịch khám sức khỏe toàn dân",
    title: `Báo cáo làm việc ngày ${displayDate(report.date)}`,
    description: "Báo cáo làm việc buổi khám sức khỏe toàn dân",
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838, orientation: PageOrientation.PORTRAIT },
            margin: { top: 720, right: 720, bottom: 720, left: 720 }
          }
        },
        children: [
          headerTable,
          paragraph([run("BÁO CÁO LÀM VIỆC", { bold: true, size: 32 })], {
            alignment: AlignmentType.CENTER,
            before: 240,
            after: 60
          }),
          paragraph([run(`Buổi khám sức khỏe toàn dân ngày ${displayDate(report.date)}`, { bold: true, size: 26 })], {
            alignment: AlignmentType.CENTER,
            after: 140
          }),
          paragraph([
            run("Hôm nay, vào lúc "),
            run(valueOrFallback(report.reportTime, "07:00"), { bold: true }),
            run(" ngày "),
            run(displayDate(report.reportDate), { bold: true }),
            run(", sau khi kết thúc buổi làm việc "),
            run(SESSION_LABELS[report.session].toLowerCase(), { bold: true }),
            run(` ngày ${displayDate(report.date)}, chúng tôi xin báo cáo:`)
          ], { after: 100 }),

          sectionHeading("I. Điểm danh nhân sự tham gia:"),
          attendanceTable(report.attendance),
          paragraph([
            run(`Tổng số khoa phòng tham gia: ${report.attendance.length}. Có mặt: ${presentCount}.`, { italics: true })
          ], { before: 60 }),

          sectionHeading("II. Số liệu công việc:"),
          fieldLine("- Số lượt người được khám: ", report.soLuotKham, " lượt"),
          fieldLine("- Số hồ sơ hoàn thành: ", report.soHoSo, " hồ sơ"),
          fieldLine("- Vật tư, thuốc sử dụng: ", valueOrFallback(report.vatTu)),

          sectionHeading("III. Sự cố, vấn đề phát sinh:"),
          paragraph(valueOrFallback(report.suCo, "Không có")),

          sectionHeading("IV. Đề xuất, kiến nghị:"),
          paragraph(valueOrFallback(report.deXuat, "Không có")),

          paragraph("", { before: 120, after: 40 }),
          signatures
        ]
      }
    ]
  });
}

export async function createWorkReportsZip(reports: WorkReport[]): Promise<Blob> {
  const zip = new JSZip();
  const orderedReports = [...reports].sort((a, b) => a.date.localeCompare(b.date));

  for (const report of orderedReports) {
    const document = createWorkReportDocument(report);
    const documentBlob = await Packer.toBlob(document);
    zip.file(
      `bao-cao-lam-viec-${report.date}.docx`,
      new Uint8Array(await documentBlob.arrayBuffer()),
      { compression: "STORE" }
    );
  }

  return zip.generateAsync({
    type: "blob",
    compression: "STORE",
    mimeType: "application/zip"
  });
}

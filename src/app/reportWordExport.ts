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
import { formatVietnamDateTime } from "../shared/schedule";
import type { DutyReport } from "../shared/types";

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
  return paragraph([
    run(label),
    run(`${value}${suffix}`)
  ]);
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
      transformation: { width: 132, height: 64 },
      type: match[1] === "jpeg" ? "jpg" : "png"
    });
  } catch {
    return null;
  }
}

function signatureCell(
  title: string,
  signature: string | null,
  signerName: string | null,
  signedAt: string | null
) {
  const image = signatureImage(signature);
  const children = [
    paragraph([run(title, { bold: true })], { alignment: AlignmentType.CENTER, after: 80 }),
    image
      ? new Paragraph({
          children: [image],
          alignment: AlignmentType.CENTER,
          spacing: { after: 40 }
        })
      : paragraph([run("Chưa ký", { italics: true })], {
          alignment: AlignmentType.CENTER,
          after: 80
        }),
    paragraph([run(valueOrFallback(signerName, ""), { bold: true })], {
      alignment: AlignmentType.CENTER,
      after: 20
    })
  ];

  if (signedAt) {
    children.push(
      paragraph([run(`Đã ký: ${formatVietnamDateTime(signedAt)}`, { size: 18 })], {
        alignment: AlignmentType.CENTER,
        after: 0
      })
    );
  }

  return new TableCell({
    width: { size: 33.33, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.TOP,
    children
  });
}

export function createDutyReportDocument(report: DutyReport): Document {
  const headerTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDERS,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 42, type: WidthType.PERCENTAGE },
            children: [
              paragraph([run("BỆNH VIỆN THỐNG NHẤT", { bold: true })], {
                alignment: AlignmentType.CENTER,
                after: 20
              }),
              paragraph([run("Khoa Ngoại Tiêu Hóa", { bold: true, size: 22 })], {
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

  const signatures = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDERS,
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          signatureCell(
            "LÃNH ĐẠO KHOA",
            report.signatureLanhdao,
            report.signatureLanhdaoName,
            report.signatureLanhdaoAt
          ),
          signatureCell(
            "BÁC SĨ TRỰC",
            report.signatureBs,
            report.signatureBsName,
            report.signatureBsAt
          ),
          signatureCell(
            "KTV TRỰC",
            report.signatureKtv,
            report.signatureKtvName,
            report.signatureKtvAt
          )
        ]
      })
    ]
  });

  return new Document({
    creator: "Hệ thống Lịch trực CĐHA",
    title: `Báo cáo trực ngày ${displayDate(report.date)}`,
    description: "Báo cáo trực Khoa Ngoại Tiêu Hóa",
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 11906,
              height: 16838,
              orientation: PageOrientation.PORTRAIT
            },
            margin: {
              top: 720,
              right: 720,
              bottom: 720,
              left: 720
            }
          }
        },
        children: [
          headerTable,
          paragraph([run("BÁO CÁO TRỰC", { bold: true, size: 32 })], {
            alignment: AlignmentType.CENTER,
            before: 240,
            after: 140
          }),
          paragraph([
            run("Hôm nay, vào lúc "),
            run(valueOrFallback(report.reportTime, "07:00"), { bold: true }),
            run(" ngày "),
            run(displayDate(report.reportDate), { bold: true }),
            run(", tại Khoa Ngoại Tiêu Hóa. Sau khi kết thúc ca trực ngày "),
            run(displayDate(report.date), { bold: true }),
            run(", chúng tôi xin báo cáo:")
          ], { after: 100 }),

          sectionHeading("I. Tình hình nhân sự:"),
          fieldLine("1. BS trực: ", valueOrFallback(report.bsTruc, "Chưa ghi")),
          fieldLine("2. KTV trực: ", valueOrFallback(report.ktvTruc, "Chưa ghi")),

          sectionHeading("II. Tình hình chuyên môn:"),
          fieldLine("- Số ca chụp X-quang tại khoa: ", report.xqKhoa, " ca"),
          fieldLine("- Số ca chụp X-quang tại giường: ", report.xqGiuong, " ca"),
          fieldLine("- Số ca chụp MRI: ", report.mri, " ca"),
          fieldLine("- Số ca chụp CT Scan: ", report.ctScan, " ca"),
          fieldLine("- Thuốc sử dụng: ", valueOrFallback(report.thuocSuDung)),
          paragraph([run("- Các trường hợp bác sĩ đọc phim báo cáo ca khó cần lưu ý để hội chẩn:", { bold: true })], {
            before: 40,
            after: 40
          }),
          paragraph(valueOrFallback(report.caKho)),

          sectionHeading("III. Tình hình dụng cụ và trang thiết bị:"),
          paragraph(valueOrFallback(report.thietBi)),

          sectionHeading("IV. Tình hình an ninh trật tự:"),
          paragraph(valueOrFallback(report.anNinh)),

          paragraph("", { before: 120, after: 40 }),
          signatures
        ]
      }
    ]
  });
}

export async function createDutyReportsZip(reports: DutyReport[]): Promise<Blob> {
  const zip = new JSZip();
  const orderedReports = [...reports].sort((a, b) => a.date.localeCompare(b.date));

  for (const report of orderedReports) {
    const document = createDutyReportDocument(report);
    const documentBlob = await Packer.toBlob(document);
    zip.file(
      `bao-cao-truc-${report.date}.docx`,
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

import { addDays } from "../shared/schedule";

export type ReportExportRange = "last15" | "currentMonth";

export interface ReportExportPeriod {
  from: string;
  to: string;
  label: string;
  filename: string;
}

export function getReportExportPeriod(today: string, range: ReportExportRange): ReportExportPeriod {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new Error("Ngày xuất báo cáo không hợp lệ.");
  }

  if (range === "last15") {
    return {
      from: addDays(today, -14),
      to: today,
      label: "15 ngày gần nhất",
      filename: `bao-cao-lam-viec-15-ngay-${today}.zip`
    };
  }

  return {
    from: `${today.slice(0, 7)}-01`,
    to: today,
    label: `tháng ${today.slice(5, 7)}/${today.slice(0, 4)}`,
    filename: `bao-cao-lam-viec-thang-${today.slice(0, 7)}.zip`
  };
}

export function isDateInReportPeriod(date: string, period: ReportExportPeriod): boolean {
  return date >= period.from && date <= period.to;
}

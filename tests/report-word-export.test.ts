import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { getReportExportPeriod, isDateInReportPeriod } from "../src/app/reportExportPeriod";
import { createWorkReportsZip } from "../src/app/reportWordExport";
import type { AttendanceEntry, WorkReport } from "../src/shared/types";

function attendance(departmentName: string, present: boolean): AttendanceEntry {
  return {
    assignmentId: departmentName.length,
    positionId: 1,
    positionLabel: "Khám nội",
    departmentId: departmentName.length,
    departmentName,
    personName: "Nguyễn Văn A",
    personPhone: "0901234567",
    present,
    note: null,
    signature: null,
    signatureName: null,
    signatureAt: null
  };
}

function makeReport(date: string): WorkReport {
  return {
    date,
    session: "full",
    reportDate: date,
    reportTime: "07:00",
    soLuotKham: 120,
    soHoSo: 118,
    vatTu: "120 bộ test đường huyết",
    suCo: "",
    deXuat: "",
    signatureDieuPhoi: null,
    signatureDieuPhoiName: null,
    signatureDieuPhoiAt: null,
    attendance: [attendance("Khoa Nội", true), attendance("Khoa Ngoại", false)]
  };
}

describe("bulk Word report export", () => {
  it("creates the requested calendar periods", () => {
    const last15 = getReportExportPeriod("2026-07-18", "last15");
    expect(last15.from).toBe("2026-07-04");
    expect(last15.to).toBe("2026-07-18");
    expect(isDateInReportPeriod("2026-07-03", last15)).toBe(false);
    expect(isDateInReportPeriod("2026-07-04", last15)).toBe(true);

    const currentMonth = getReportExportPeriod("2026-07-18", "currentMonth");
    expect(currentMonth.from).toBe("2026-07-01");
    expect(currentMonth.to).toBe("2026-07-18");
  });

  it("creates a ZIP with one valid DOCX per report", async () => {
    const output = await createWorkReportsZip([makeReport("2026-07-17"), makeReport("2026-07-16")]);
    const zip = await JSZip.loadAsync(await output.arrayBuffer());
    const filenames = Object.keys(zip.files).sort();

    expect(filenames).toEqual([
      "bao-cao-lam-viec-2026-07-16.docx",
      "bao-cao-lam-viec-2026-07-17.docx"
    ]);

    const firstDocx = await zip.file(filenames[0])!.async("uint8array");
    const docx = await JSZip.loadAsync(firstDocx);
    expect(docx.file("[Content_Types].xml")).not.toBeNull();
    expect(docx.file("word/document.xml")).not.toBeNull();
  });
});

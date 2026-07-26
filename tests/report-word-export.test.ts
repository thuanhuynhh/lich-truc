import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  getReportExportPeriod,
  isDateInReportPeriod
} from "../src/app/reportExportPeriod";
import { createDutyReportsZip } from "../src/app/reportWordExport";
import type { DutyReport } from "../src/shared/types";

function makeReport(date: string): DutyReport {
  return {
    date,
    reportDate: date,
    reportTime: "07:00",
    bsTruc: "An",
    ktvTruc: "Bình",
    xqKhoa: 12,
    xqGiuong: 3,
    mri: 4,
    ctScan: 5,
    thuocSuDung: "Không",
    caKho: "",
    thietBi: "Tốt",
    anNinh: "Tốt",
    signatureBs: null,
    signatureBsName: null,
    signatureBsAt: null,
    signatureKtv: null,
    signatureKtvName: null,
    signatureKtvAt: null,
    signatureLanhdao: null,
    signatureLanhdaoName: null,
    signatureLanhdaoAt: null
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
    const output = await createDutyReportsZip([
      makeReport("2026-07-17"),
      makeReport("2026-07-16")
    ]);
    const zip = await JSZip.loadAsync(await output.arrayBuffer());
    const filenames = Object.keys(zip.files).sort();

    expect(filenames).toEqual([
      "bao-cao-truc-2026-07-16.docx",
      "bao-cao-truc-2026-07-17.docx"
    ]);

    const firstDocx = await zip.file(filenames[0])!.async("uint8array");
    const docx = await JSZip.loadAsync(firstDocx);
    expect(docx.file("[Content_Types].xml")).not.toBeNull();
    expect(docx.file("word/document.xml")).not.toBeNull();
  });
});

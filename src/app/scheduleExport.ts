import type { Position, ScheduleResponse, Section, WorkDay } from "../shared/types";
import {
  SESSION_SHORT_LABELS,
  formatDate,
  formatMonthLabel,
  formatWeekLabel,
  getWeekdayLabel
} from "../shared/schedule";
import { formatLunarDate } from "./lunar";

export const APP_TITLE = "LỊCH KHÁM SỨC KHỎE TOÀN DÂN";

type ExportRow =
  | { kind: "section"; label: string }
  | { kind: "coordinator"; label: string }
  | { kind: "position"; label: string; position: Position };

/** Các hàng của bản xuất, xếp đúng thứ tự như bảng trên màn hình. */
export function exportRows(data: ScheduleResponse): ExportRow[] {
  const rows: ExportRow[] = [{ kind: "coordinator", label: "ĐIỀU PHỐI" }];
  const sections: Section[] = [...data.sections].sort((left, right) => left.sortOrder - right.sortOrder);
  const orphans = data.positions.filter((position) => !sections.some((section) => section.id === position.sectionId));

  for (const section of sections) {
    const positions = data.positions.filter((position) => position.sectionId === section.id);
    if (positions.length === 0) continue;
    rows.push({ kind: "section", label: section.label });
    for (const position of positions) {
      rows.push({ kind: "position", label: position.label, position });
    }
  }
  if (orphans.length > 0) {
    rows.push({ kind: "section", label: "Chưa phân mục" });
    for (const position of orphans) rows.push({ kind: "position", label: position.label, position });
  }
  return rows;
}

/** Nội dung một ô: từng khoa phòng kèm người làm việc và số điện thoại. */
export function exportCellText(data: ScheduleResponse, row: ExportRow, date: string): string {
  if (row.kind === "section") return "";
  if (row.kind === "coordinator") {
    return data.coordinatorAssignments
      .filter((item) => item.date === date)
      .map((item) => item.fullName || item.username)
      .join("\n");
  }
  return data.assignments
    .filter((item) => item.positionId === row.position.id && item.date === date)
    .map((item) => {
      const person = item.personName || "Chưa điền tên";
      return item.personPhone ? `${item.departmentName}: ${person} - ${item.personPhone}` : `${item.departmentName}: ${person}`;
    })
    .join("\n");
}

function dayHeaderText(workDay: WorkDay, showLunar: boolean): string {
  const parts = [
    getWeekdayLabel(workDay.date),
    formatDate(workDay.date),
    SESSION_SHORT_LABELS[workDay.session]
  ];
  if (showLunar) parts.push(formatLunarDate(workDay.date));
  return parts.join("\n");
}

function subtitle(data: ScheduleResponse): string {
  return `Tuần ${formatWeekLabel(data.weekStart)} · ${formatMonthLabel(data.month)} · ${data.workDays.length} ngày làm`;
}

export function exportPng(data: ScheduleResponse | null, showLunar = false) {
  if (!data || data.workDays.length === 0) return;
  const rows = exportRows(data);
  const canvas = document.createElement("canvas");
  const unitWidth = 220;
  const dayWidth = 200;
  const rowHeight = 84;
  const sectionHeight = 34;
  const titleHeight = 92;

  canvas.width = unitWidth + dayWidth * data.workDays.length;
  canvas.height =
    titleHeight +
    rowHeight +
    rows.reduce((total, row) => total + (row.kind === "section" ? sectionHeight : rowHeight), 0);

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0f172a";
  ctx.font = "700 26px Arial";
  ctx.fillText(APP_TITLE, 24, 38);
  ctx.font = "500 15px Arial";
  ctx.fillText(subtitle(data), 24, 64);

  let y = titleHeight;
  drawCell(ctx, 0, y, unitWidth, rowHeight, "VỊ TRÍ KHÁM", "#0f766e", "#ffffff", true);
  data.workDays.forEach((workDay, index) =>
    drawCell(
      ctx,
      unitWidth + index * dayWidth,
      y,
      dayWidth,
      rowHeight,
      dayHeaderText(workDay, showLunar),
      "#0f766e",
      "#ffffff",
      true
    )
  );
  y += rowHeight;

  for (const row of rows) {
    if (row.kind === "section") {
      drawCell(ctx, 0, y, canvas.width, sectionHeight, row.label, "#e2e8f0", "#0f172a", true);
      y += sectionHeight;
      continue;
    }
    drawCell(ctx, 0, y, unitWidth, rowHeight, row.label, row.kind === "coordinator" ? "#0f766e" : "#1d4ed8", "#ffffff", true);
    data.workDays.forEach((workDay, index) => {
      const text = exportCellText(data, row, workDay.date);
      drawCell(ctx, unitWidth + index * dayWidth, y, dayWidth, rowHeight, text || "-", "#ffffff", "#0f172a", false);
    });
    y += rowHeight;
  }

  const link = document.createElement("a");
  link.download = `lich-ksktd-tuan-${data.weekStart}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

export function exportExcel(data: ScheduleResponse | null, showLunar = false) {
  if (!data || data.workDays.length === 0) return;
  const rows = exportRows(data);
  const columnCount = data.workDays.length + 1;
  const headerCells = [
    "<th>VỊ TRÍ KHÁM</th>",
    ...data.workDays.map(
      (workDay) => `<th>${escapeHtml(dayHeaderText(workDay, showLunar)).replace(/\n/g, "<br>")}</th>`
    )
  ].join("");

  const bodyRows = rows
    .map((row) => {
      if (row.kind === "section") {
        return `<tr><th colspan="${columnCount}" class="section">${escapeHtml(row.label)}</th></tr>`;
      }
      const cells = data.workDays
        .map(
          (workDay) =>
            `<td>${escapeHtml(exportCellText(data, row, workDay.date)).replace(/\n/g, "<br>") || "-"}</td>`
        )
        .join("");
      return `<tr><th>${escapeHtml(row.label)}</th>${cells}</tr>`;
    })
    .join("");

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    table { border-collapse: collapse; font-family: Arial, sans-serif; }
    caption { font-size: 18px; font-weight: 700; margin-bottom: 8px; text-align: left; }
    th, td { border: 1px solid #94a3b8; padding: 8px; vertical-align: top; mso-number-format: "\\@"; }
    th { background: #0f766e; color: #ffffff; font-weight: 700; }
    th.section { background: #e2e8f0; color: #0f172a; text-align: left; }
    td { min-width: 150px; white-space: normal; }
  </style>
</head>
<body>
  <table>
    <caption>${escapeHtml(APP_TITLE)} - ${escapeHtml(subtitle(data))}</caption>
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
</body>
</html>`;
  const blob = new Blob(["﻿", html], { type: "application/vnd.ms-excel;charset=utf-8" });
  downloadBlob(blob, `lich-ksktd-tuan-${data.weekStart}.xls`);
}

export function downloadBlob(blob: Blob, filename: string) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.download = filename;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function drawCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  fill: string,
  color: string,
  bold: boolean
) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "#cbd5e1";
  ctx.strokeRect(x, y, width, height);
  ctx.fillStyle = color;
  ctx.font = `${bold ? "700" : "500"} 14px Arial`;
  const maxLines = Math.max(1, Math.floor((height - 10) / 17));
  const lines = wrapLines(ctx, text, width - 16).slice(0, maxLines);
  lines.forEach((line, index) => ctx.fillText(line, x + 8, y + 22 + index * 17));
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const rawLine of text.split("\n")) {
    const words = rawLine.split(" ");
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

import type { Assignment, Department, ScheduleResponse, WorkDay } from "../shared/types";
import { SESSION_SHORT_LABELS, formatDate, formatMonthLabel, getWeekdayLabel } from "../shared/schedule";
import { formatLunarDate } from "./lunar";

export const APP_TITLE = "LỊCH KHÁM SỨC KHỎE TOÀN DÂN";

/** Chỉ xuất các khoa phòng thực sự có phân công trong tháng. */
export function scheduledDepartments(data: ScheduleResponse): Department[] {
  const assigned = new Set(data.assignments.map((assignment) => assignment.departmentId));
  return data.departments.filter((department) => assigned.has(department.id) || department.active);
}

export function cellAssignment(
  assignments: Assignment[],
  departmentId: number,
  date: string
): Assignment | undefined {
  return assignments.find((assignment) => assignment.departmentId === departmentId && assignment.date === date);
}

export function exportCellText(assignments: Assignment[], departmentId: number, date: string): string {
  const assignment = cellAssignment(assignments, departmentId, date);
  if (!assignment) return "";
  const lines = [assignment.personName || "Chưa điền tên"];
  if (assignment.personPhone) lines.push(assignment.personPhone);
  return lines.join("\n");
}

function dayHeaderText(workDay: WorkDay, showLunar: boolean): string {
  const parts = [
    `${getWeekdayLabel(workDay.date)} ${formatDate(workDay.date)}`,
    SESSION_SHORT_LABELS[workDay.session]
  ];
  if (showLunar) parts.push(formatLunarDate(workDay.date));
  return parts.join("\n");
}

export function exportPng(data: ScheduleResponse | null, showLunar = false) {
  if (!data || data.workDays.length === 0) return;
  const departments = scheduledDepartments(data);
  const canvas = document.createElement("canvas");
  const unitWidth = 280;
  const dayWidth = 170;
  const rowHeight = 72;
  const titleHeight = 92;
  canvas.width = unitWidth + dayWidth * data.workDays.length;
  canvas.height = titleHeight + rowHeight * (departments.length + 1);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0f172a";
  ctx.font = "700 28px Arial";
  ctx.fillText(APP_TITLE, 24, 38);
  ctx.font = "500 16px Arial";
  ctx.fillText(formatMonthLabel(data.month), 24, 62);
  ctx.fillText(`${data.workDays.length} ngày làm việc`, 24, 82);

  let y = titleHeight;
  drawCell(ctx, 0, y, unitWidth, rowHeight, "KHOA PHÒNG", "#0f766e", "#ffffff", true);
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

  departments.forEach((department) => {
    drawCell(ctx, 0, y, unitWidth, rowHeight, department.name, "#1d4ed8", "#ffffff", true);
    data.workDays.forEach((workDay, index) => {
      const text = exportCellText(data.assignments, department.id, workDay.date);
      drawCell(ctx, unitWidth + index * dayWidth, y, dayWidth, rowHeight, text || "-", "#ffffff", "#0f172a", false);
    });
    y += rowHeight;
  });

  const link = document.createElement("a");
  link.download = `lich-ksktd-${data.month}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

export function exportExcel(data: ScheduleResponse | null, showLunar = false) {
  if (!data || data.workDays.length === 0) return;
  const departments = scheduledDepartments(data);
  const headerCells = [
    "<th>KHOA PHÒNG</th>",
    ...data.workDays.map(
      (workDay) => `<th>${escapeHtml(dayHeaderText(workDay, showLunar)).replace(/\n/g, "<br>")}</th>`
    )
  ].join("");
  const bodyRows = departments
    .map((department) => {
      const cells = data.workDays
        .map(
          (workDay) =>
            `<td>${escapeHtml(exportCellText(data.assignments, department.id, workDay.date)).replace(/\n/g, "<br>") || "-"}</td>`
        )
        .join("");
      return `<tr><th>${escapeHtml(department.name)}</th>${cells}</tr>`;
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
    td { min-width: 130px; white-space: normal; }
  </style>
</head>
<body>
  <table>
    <caption>${escapeHtml(APP_TITLE)} - ${escapeHtml(formatMonthLabel(data.month))}</caption>
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
</body>
</html>`;
  const blob = new Blob(["﻿", html], { type: "application/vnd.ms-excel;charset=utf-8" });
  downloadBlob(blob, `lich-ksktd-${data.month}.xls`);
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
  ctx.font = `${bold ? "700" : "500"} 15px Arial`;
  const lines = wrapLines(ctx, text, width - 16).slice(0, 3);
  lines.forEach((line, index) => ctx.fillText(line, x + 8, y + 24 + index * 18));
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

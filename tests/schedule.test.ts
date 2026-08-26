import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  canEditPersonOnDate,
  currentMonthInVietnam,
  formatFullDate,
  formatMonthLabel,
  isDaySession,
  isIsoDate,
  isIsoMonth,
  monthRange,
  normalizeMonth,
  rotationAssignmentsForWorkDays,
  rotationTurnIndex,
  todayInVietnam
} from "../src/shared/schedule";
import type { RotationMember } from "../src/shared/types";

function member(departmentId: number, turnIndex: number, memberOrder = 0): RotationMember {
  return { departmentId, departmentName: `Khoa ${departmentId}`, turnIndex, memberOrder };
}

describe("ngày và tháng", () => {
  it("cộng ngày qua mốc cuối tháng", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("chỉ nhận ngày ISO thật", () => {
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-13-01")).toBe(false);
  });

  it("kiểm tra tháng ISO", () => {
    expect(isIsoMonth("2026-09")).toBe(true);
    expect(isIsoMonth("2026-13")).toBe(false);
    expect(isIsoMonth("2026-9")).toBe(false);
  });

  it("chuẩn hóa tháng và trả về tháng hiện tại khi tham số sai", () => {
    expect(normalizeMonth("2026-09-05")).toBe("2026-09");
    expect(normalizeMonth("sai")).toBe(currentMonthInVietnam());
    expect(normalizeMonth(null)).toBe(currentMonthInVietnam());
  });

  it("tính khoảng ngày của tháng, kể cả tháng hai năm nhuận", () => {
    expect(monthRange("2026-09")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("chuyển tháng qua mốc cuối năm", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });

  it("hiển thị nhãn tháng và ngày kiểu Việt Nam", () => {
    expect(formatMonthLabel("2026-09")).toBe("Tháng 9/2026");
    expect(formatFullDate("2026-09-05")).toBe("05/09/2026");
  });

  it("nhận diện buổi làm việc hợp lệ", () => {
    expect(isDaySession("morning")).toBe(true);
    expect(isDaySession("full")).toBe(true);
    expect(isDaySession("night")).toBe(false);
  });

  it("trả về ngày hôm nay theo giờ Việt Nam", () => {
    // 23:30 UTC ngày 24/08 đã là 06:30 ngày 25/08 ở Việt Nam.
    expect(todayInVietnam(new Date("2026-08-24T23:30:00Z"))).toBe("2026-08-25");
  });
});

describe("quyền sửa người làm việc", () => {
  it("cho sửa trong chính ngày làm khi không bật khóa", () => {
    expect(canEditPersonOnDate("2026-09-05", "2026-09-05")).toBe(true);
    expect(canEditPersonOnDate("2026-09-06", "2026-09-05")).toBe(true);
    expect(canEditPersonOnDate("2026-09-04", "2026-09-05")).toBe(false);
  });

  it("khóa từ đầu ngày làm khi bật cấu hình khóa", () => {
    expect(canEditPersonOnDate("2026-09-05", "2026-09-05", true)).toBe(false);
    expect(canEditPersonOnDate("2026-09-06", "2026-09-05", true)).toBe(true);
  });
});

describe("tua khám chạy theo ngày làm", () => {
  const workDays = ["2026-09-05", "2026-09-12", "2026-09-19", "2026-09-26"];

  it("xoay tua theo thứ tự ngày làm chứ không theo ngày dương lịch", () => {
    expect(rotationTurnIndex(workDays, "2026-09-05", "2026-09-05", 2)).toBe(0);
    expect(rotationTurnIndex(workDays, "2026-09-12", "2026-09-05", 2)).toBe(1);
    expect(rotationTurnIndex(workDays, "2026-09-19", "2026-09-05", 2)).toBe(0);
    expect(rotationTurnIndex(workDays, "2026-09-26", "2026-09-05", 2)).toBe(1);
  });

  it("bỏ qua ngày làm trước ngày bắt đầu tua", () => {
    expect(rotationTurnIndex(workDays, "2026-09-05", "2026-09-12", 2)).toBe(-1);
    expect(rotationTurnIndex(workDays, "2026-09-12", "2026-09-12", 2)).toBe(0);
    expect(rotationTurnIndex(workDays, "2026-09-19", "2026-09-12", 2)).toBe(1);
  });

  it("không xoay được khi chưa có tua nào", () => {
    expect(rotationTurnIndex(workDays, "2026-09-05", "2026-09-05", 0)).toBe(-1);
  });

  it("sinh phân công cho từng ngày làm theo tua", () => {
    const turns: RotationMember[][] = [
      [member(1, 0, 0), member(2, 0, 1)],
      [member(3, 1, 0)]
    ];
    const assignments = rotationAssignmentsForWorkDays(workDays, turns, "2026-09-05");

    expect(assignments).toEqual([
      { date: "2026-09-05", departmentId: 1, memberOrder: 0 },
      { date: "2026-09-05", departmentId: 2, memberOrder: 1 },
      { date: "2026-09-12", departmentId: 3, memberOrder: 0 },
      { date: "2026-09-19", departmentId: 1, memberOrder: 0 },
      { date: "2026-09-19", departmentId: 2, memberOrder: 1 },
      { date: "2026-09-26", departmentId: 3, memberOrder: 0 }
    ]);
  });

  it("bỏ qua tua rỗng khi tính số tua", () => {
    const turns: RotationMember[][] = [[member(1, 0)], [], [member(2, 2)]];
    const assignments = rotationAssignmentsForWorkDays(["2026-09-05", "2026-09-12"], turns, "2026-09-05");

    expect(assignments).toEqual([
      { date: "2026-09-05", departmentId: 1, memberOrder: 0 },
      { date: "2026-09-12", departmentId: 2, memberOrder: 0 }
    ]);
  });

  it("không sinh phân công khi mọi tua đều rỗng", () => {
    expect(rotationAssignmentsForWorkDays(workDays, [[], []], "2026-09-05")).toEqual([]);
  });

  it("sắp xếp lại ngày làm truyền vào không đúng thứ tự", () => {
    const turns: RotationMember[][] = [[member(1, 0)], [member(2, 1)]];
    const assignments = rotationAssignmentsForWorkDays(["2026-09-12", "2026-09-05"], turns, "2026-09-05");

    expect(assignments).toEqual([
      { date: "2026-09-05", departmentId: 1, memberOrder: 0 },
      { date: "2026-09-12", departmentId: 2, memberOrder: 0 }
    ]);
  });
});

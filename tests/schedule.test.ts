import { describe, expect, it } from "vitest";
import {
  addDays,
  conflictsWithDutyLeave,
  formatLeaveRegistrationDateTime,
  formatVietnamDateTime,
  getDayOfWeekLabel,
  isIsoDate,
  normalizeWeekStart,
  parseTimestamp,
  postDutyOffDate,
  rotationTurnIndex,
  shouldSyncPostDutyOffDate,
  todayInVietnam,
  workRotationAssignmentsForStaff
} from "../src/shared/schedule";
import type { ScheduleUnit, UnitRotation } from "../src/shared/types";

describe("schedule date rules", () => {
  it("formats D1 leave registration timestamps in Vietnam time", () => {
    expect(formatLeaveRegistrationDateTime("2026-05-01 20:30:00")).toBe("3h30 ngày 02/05/2026");
  });

  it("uses the day after weekday duty as the post-duty off day", () => {
    expect(postDutyOffDate("2026-06-22")).toBe("2026-06-23");
  });

  it("keeps Friday duty off on Thursday", () => {
    expect(postDutyOffDate("2026-06-26")).toBe("2026-06-25");
  });

  it("keeps Saturday duty off on Friday", () => {
    expect(postDutyOffDate("2026-06-27")).toBe("2026-06-26");
  });

  it("carries post-duty off days across week boundaries", () => {
    expect(postDutyOffDate("2026-06-28")).toBe("2026-06-29");
  });

  it("only syncs post-duty off days from today onward", () => {
    expect(shouldSyncPostDutyOffDate("2026-07-11", "2026-07-13")).toBe(false);
    expect(shouldSyncPostDutyOffDate("2026-07-12", "2026-07-13")).toBe(true);
    expect(shouldSyncPostDutyOffDate("2026-07-13", "2026-07-13")).toBe(true);
  });

  it("restores each returning doctor from their own work rotation after a duty swap", () => {
    const units: ScheduleUnit[] = [{
      id: 10,
      code: "mri2",
      section: "II",
      label: "MRI 2",
      type: "work_bs",
      maxPerDay: null,
      sortOrder: 160,
      computed: false
    }];
    const member = (staffId: number, turnIndex: number) => ({
      staffId,
      staffName: `BS ${staffId}`,
      staffType: "BS" as const,
      turnIndex,
      memberOrder: 0
    });
    const rotations: UnitRotation[] = [{
      unitId: 10,
      startDate: "2026-07-22",
      mode: "daily",
      enabled: true,
      turns: [[member(99, 0)], [member(2, 1)], [member(99, 2)]]
    }];

    expect(workRotationAssignmentsForStaff(units, rotations, 2, "2026-07-23")).toEqual([{ unitId: 10, slot: 0 }]);
    expect(workRotationAssignmentsForStaff(units, rotations, 1, "2026-07-24")).toEqual([]);
  });

  it("restores each returning technician from their own work rotation after a duty swap", () => {
    const units: ScheduleUnit[] = [{
      id: 20,
      code: "ktv_mri2",
      section: "III",
      label: "PHÒNG MRI 2",
      type: "work_ktv",
      maxPerDay: null,
      sortOrder: 290,
      computed: false
    }];
    const rotations: UnitRotation[] = [{
      unitId: 20,
      startDate: "2026-07-13",
      mode: "weekly",
      enabled: true,
      turns: [[{
        staffId: 22,
        staffName: "Minh",
        staffType: "KTV",
        turnIndex: 0,
        memberOrder: 0
      }], [{
        staffId: 20,
        staffName: "Quốc Long",
        staffType: "KTV",
        turnIndex: 1,
        memberOrder: 0
      }]]
    }];

    expect(workRotationAssignmentsForStaff(units, rotations, 20, "2026-07-21")).toEqual([{ unitId: 20, slot: 0 }]);
    expect(workRotationAssignmentsForStaff(units, rotations, 22, "2026-07-22")).toEqual([]);
  });

  it("keeps rotation indexing stable before and after its start date", () => {
    expect(rotationTurnIndex("2026-07-23", "2026-07-22", "daily", 3)).toBe(2);
    expect(rotationTurnIndex("2026-07-23", "2026-07-30", "weekly", 3)).toBe(1);
  });

  it("blocks Thursday leave when Friday is the duty day", () => {
    expect(conflictsWithDutyLeave("2026-06-26", "2026-06-25")).toBe(true);
  });

  it("does not treat an unrelated leave date as a duty conflict", () => {
    expect(conflictsWithDutyLeave("2026-06-26", "2026-06-24")).toBe(false);
  });

  it("does calendar arithmetic without depending on the runtime timezone", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(getDayOfWeekLabel("2026-07-19")).toBe("chủ nhật");
  });

  it("normalizes a requested date to its Monday", () => {
    expect(normalizeWeekStart("2026-07-19")).toBe("2026-07-13");
  });

  it("uses the Vietnam calendar date at the UTC day boundary", () => {
    expect(todayInVietnam(new Date("2026-07-14T18:00:00Z"))).toBe("2026-07-15");
    expect(todayInVietnam(new Date("2026-07-14T16:59:59Z"))).toBe("2026-07-14");
  });

  it("strictly validates PostgreSQL DATE values", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-7-14")).toBe(false);
  });

  it("parses PostgreSQL and legacy D1 timestamps safely", () => {
    expect(parseTimestamp("2026-07-14T15:36:07.278+00:00")?.toISOString()).toBe("2026-07-14T15:36:07.278Z");
    expect(parseTimestamp("2026-07-14 15:36:07")?.toISOString()).toBe("2026-07-14T15:36:07.000Z");
    expect(parseTimestamp("not-a-date")).toBeNull();
    expect(formatVietnamDateTime("2026-07-14T15:36:07.278+00:00")).toBe("14/07/2026 22:36");
  });
});

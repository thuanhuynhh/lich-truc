import { describe, expect, it } from "vitest";
import { getAuditActionValues } from "../src/shared/audit";
import { canEditDutyReport, formatStaffFullName, getLeaveDateBlockReason, hasReportSignature, isReportRole, leaveBalanceError, resolveReportSignerName, validateAssignmentInput, validateLeaveInput } from "../src/shared/validation";
import type { Assignment, LeaveDay, ScheduleUnit, Staff, StaffType } from "../src/shared/types";

const dutyBs: ScheduleUnit = {
  id: 1,
  code: "duty_bs",
  section: "I",
  label: "Lịch trực bác sĩ",
  type: "duty_bs",
  maxPerDay: 1,
  sortOrder: 20,
  computed: false
};

describe("audit action filters", () => {
  it("groups all duty-swap audit actions", () => {
    expect(getAuditActionValues("swap")).toEqual(["move", "accept_swap", "reject_swap"]);
    expect(getAuditActionValues("delete")).toEqual(["delete"]);
  });
});

const dutyKtv: ScheduleUnit = {
  id: 2,
  code: "duty_ktv",
  section: "I",
  label: "Lịch trực kỹ thuật viên",
  type: "duty_ktv",
  maxPerDay: 2,
  sortOrder: 30,
  computed: false
};

const workKtv: ScheduleUnit = {
  id: 3,
  code: "work_ktv",
  section: "III",
  label: "Lịch làm việc KTV",
  type: "work_ktv",
  maxPerDay: null,
  sortOrder: 210,
  computed: false
};

const bs: Staff = { id: 10, familyMiddleName: "", name: "BS A", type: "BS", active: true };
const ktv: Staff = { id: 20, familyMiddleName: "", name: "KTV A", type: "KTV", active: true };
const tkyk: Staff = { id: 30, familyMiddleName: "", name: "TKYK A", type: "TKYK", active: true };

function assignment(id: number, unitId: number, staffId: number, staffType: "BS" | "KTV"): Assignment {
  return {
    id,
    unitId,
    unitCode: unitId === 1 ? "duty_bs" : "duty_ktv",
    date: "2026-06-24",
    staffId,
    staffName: `Name ${staffId}`,
    staffType,
    slot: id
  };
}

function leave(id: number, staffId: number, staffType: StaffType, date = "2026-06-24"): LeaveDay {
  return {
    id,
    requestId: id,
    date,
    staffId,
    staffName: `Name ${staffId}`,
    staffType,
    reason: null
  };
}

describe("schedule validation", () => {
  it("rejects unknown report signer roles at runtime", () => {
    expect(isReportRole("lanhdao")).toBe(true);
    expect(isReportRole("leadership")).toBe(false);
    expect(isReportRole({ role: "lanhdao" })).toBe(false);
  });

  it("uses the submitted signer name instead of the account username", () => {
    expect(resolveReportSignerName("  Nguyễn Văn A  ", "Tên nhân sự")).toBe("Nguyễn Văn A");
    expect(resolveReportSignerName("", "  Trần Thị B  ")).toBe("Trần Thị B");
    expect(resolveReportSignerName(undefined, null)).toBe("");
  });

  it("joins the family/middle name and given name for duty reports", () => {
    expect(formatStaffFullName("  Nguyễn Văn ", " An ")).toBe("Nguyễn Văn An");
    expect(formatStaffFullName("", "An")).toBe("An");
  });

  it("locks report content as soon as any signature evidence exists", () => {
    const unsigned = {
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

    expect(hasReportSignature(unsigned)).toBe(false);
    expect(hasReportSignature({ ...unsigned, signatureBs: "data:image/png;base64,abc" })).toBe(true);
    expect(hasReportSignature({ ...unsigned, signatureKtvName: "KTV A" })).toBe(true);
    expect(hasReportSignature({ ...unsigned, signatureLanhdaoAt: "2026-07-18T00:00:00Z" })).toBe(true);
  });

  it("allows every authenticated role to edit signed reports repeatedly", () => {
    const signed = {
      signatureBs: "data:image/png;base64,abc",
      signatureBsName: "BS A",
      signatureBsAt: "2026-07-18T00:00:00Z",
      signatureKtv: null,
      signatureKtvName: null,
      signatureKtvAt: null,
      signatureLanhdao: null,
      signatureLanhdaoName: null,
      signatureLanhdaoAt: null
    };

    expect(canEditDutyReport("admin", signed)).toBe(true);
    expect(canEditDutyReport("bs", signed)).toBe(true);
    expect(canEditDutyReport("ktv", signed)).toBe(true);
  });

  it("limits doctor duty to one person per day", () => {
    const error = validateAssignmentInput({
      unit: dutyBs,
      staff: { ...bs, id: 11 },
      date: "2026-06-24",
      assignments: [assignment(1, dutyBs.id, bs.id, "BS")],
      leaveDays: []
    });
    expect(error).toContain("tối đa 1");
  });

  it("limits technician duty to two people per day", () => {
    const error = validateAssignmentInput({
      unit: dutyKtv,
      staff: { ...ktv, id: 22 },
      date: "2026-06-24",
      assignments: [assignment(1, dutyKtv.id, 20, "KTV"), assignment(2, dutyKtv.id, 21, "KTV")],
      leaveDays: []
    });
    expect(error).toContain("tối đa 2");
  });

  it("blocks assignment when staff is on leave", () => {
    const error = validateAssignmentInput({
      unit: dutyBs,
      staff: bs,
      date: "2026-06-24",
      assignments: [],
      leaveDays: [leave(1, bs.id, "BS")]
    });
    expect(error).toContain("đang nghỉ phép");
  });

  it("allows TKYK in technician work schedule", () => {
    const error = validateAssignmentInput({
      unit: workKtv,
      staff: tkyk,
      date: "2026-06-24",
      assignments: [],
      leaveDays: []
    });
    expect(error).toBeNull();
  });

  it("blocks TKYK from technician duty schedule", () => {
    const error = validateAssignmentInput({
      unit: dutyKtv,
      staff: tkyk,
      date: "2026-06-24",
      assignments: [],
      leaveDays: []
    });
    expect(error).toContain("chỉ nhận KTV");
  });

  it("limits leave to two staff per type per day", () => {
    const error = validateLeaveInput({
      staff: { ...bs, id: 12 },
      dates: ["2026-06-24"],
      leaveDays: [leave(1, 10, "BS"), leave(2, 11, "BS")]
    });
    expect(error).toContain("đã đủ 2 BS");
  });

  it.each([
    ["BS", bs],
    ["KTV", ktv],
    ["TKYK", tkyk]
  ] as const)("disables a full %s leave date", (staffType, staff) => {
    const error = getLeaveDateBlockReason(
      { ...staff, id: 99 },
      "2026-07-16",
      [leave(1, 10, staffType, "2026-07-16"), leave(2, 11, staffType, "2026-07-16")]
    );
    expect(error).toContain(`đã đủ 2 ${staffType}`);
  });
});

describe("leaveBalanceError", () => {
  it("allows requests within remaining days minus booked days", () => {
    expect(leaveBalanceError({ remaining: 5, booked: 3, dates: ["2026-11-02", "2026-11-03"] })).toBeNull();
  });

  it("blocks requests exceeding remaining days minus booked days", () => {
    expect(leaveBalanceError({ remaining: 5, booked: 4, dates: ["2026-11-02", "2026-11-03"] }))
      .toContain("chỉ có thể xin thêm 1 ngày");
  });

  it("blocks every request when the balance is overdrawn", () => {
    expect(leaveBalanceError({ remaining: -1, booked: 0, dates: ["2026-11-02"] }))
      .toContain("chỉ có thể xin thêm 0 ngày");
  });
});

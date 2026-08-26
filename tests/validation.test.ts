import { describe, expect, it } from "vitest";
import {
  attendanceSummary,
  canEditAssignmentPerson,
  canEditWorkReport,
  canManageSchedule,
  hasCoordinatorSignature,
  isRole,
  isSignerRole,
  normalizePhone,
  resolveSignerName,
  roleLabel,
  validateAssignmentInput,
  validateCoordinatorSwap,
  validatePersonInput
} from "../src/shared/validation";
import type { Assignment, Department } from "../src/shared/types";

const department: Department = { id: 1, name: "Khoa Nội", active: true, sortOrder: 10 };

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: 1,
    date: "2026-09-05",
    departmentId: 1,
    departmentName: "Khoa Nội",
    personName: "Nguyễn Văn A",
    personPhone: "0901234567",
    ...overrides
  };
}

describe("vai trò", () => {
  it("chỉ nhận ba vai trò của hệ thống", () => {
    expect(isRole("admin")).toBe(true);
    expect(isRole("dieu_phoi")).toBe(true);
    expect(isRole("khoa_phong")).toBe(true);
    expect(isRole("bs")).toBe(false);
  });

  it("admin và điều phối được lên lịch, khoa phòng thì không", () => {
    expect(canManageSchedule("admin")).toBe(true);
    expect(canManageSchedule("dieu_phoi")).toBe(true);
    expect(canManageSchedule("khoa_phong")).toBe(false);
  });

  it("hiển thị tên vai trò bằng tiếng Việt", () => {
    expect(roleLabel("admin")).toBe("Quản lý");
    expect(roleLabel("dieu_phoi")).toBe("Điều phối");
    expect(roleLabel("khoa_phong")).toBe("Khoa phòng");
  });

  it("chỉ nhận vai trò ký hợp lệ", () => {
    expect(isSignerRole("khoa_phong")).toBe(true);
    expect(isSignerRole("dieu_phoi")).toBe(true);
    expect(isSignerRole("admin")).toBe(false);
  });
});

describe("người làm việc", () => {
  it("bắt buộc có họ tên và số điện thoại", () => {
    expect(validatePersonInput({ personName: "", personPhone: "0901234567" }))
      .toBe("Hãy nhập họ và tên người làm việc.");
    expect(validatePersonInput({ personName: "Nguyễn Văn A", personPhone: "" }))
      .toBe("Hãy nhập số điện thoại liên hệ.");
  });

  it("chặn số điện thoại không hợp lệ", () => {
    expect(validatePersonInput({ personName: "Nguyễn Văn A", personPhone: "abc" })).not.toBeNull();
    expect(validatePersonInput({ personName: "Nguyễn Văn A", personPhone: "090" })).not.toBeNull();
  });

  it("chấp nhận số điện thoại có dấu cách hoặc đầu số quốc tế", () => {
    expect(validatePersonInput({ personName: "Nguyễn Văn A", personPhone: "0901 234 567" })).toBeNull();
    expect(validatePersonInput({ personName: "Nguyễn Văn A", personPhone: "+84901234567" })).toBeNull();
  });

  it("chặn họ tên quá dài", () => {
    expect(validatePersonInput({ personName: "a".repeat(121), personPhone: "0901234567" }))
      .toBe("Họ và tên không được quá 120 ký tự.");
  });

  it("gom nhiều dấu cách trong số điện thoại", () => {
    expect(normalizePhone("  0901   234 567 ")).toBe("0901 234 567");
    expect(normalizePhone(undefined)).toBe("");
  });
});

describe("phân công khoa phòng", () => {
  it("chỉ phân công vào ngày đã mở làm việc", () => {
    expect(
      validateAssignmentInput({
        department,
        date: "2026-09-06",
        workDayDates: ["2026-09-05"],
        assignments: []
      })
    ).toBe("Ngày này chưa được mở làm việc. Hãy thêm ngày làm trước.");
  });

  it("không phân công khoa phòng đã tắt", () => {
    expect(
      validateAssignmentInput({
        department: { ...department, active: false },
        date: "2026-09-05",
        workDayDates: ["2026-09-05"],
        assignments: []
      })
    ).toBe("Khoa phòng này đã ngừng hoạt động.");
  });

  it("chặn trùng khoa phòng trong cùng một ngày", () => {
    expect(
      validateAssignmentInput({
        department,
        date: "2026-09-05",
        workDayDates: ["2026-09-05"],
        assignments: [assignment()]
      })
    ).toBe("Khoa Nội đã có trong ngày 2026-09-05.");
  });

  it("bỏ qua chính phân công đang được chuyển", () => {
    expect(
      validateAssignmentInput({
        department,
        date: "2026-09-05",
        workDayDates: ["2026-09-05"],
        assignments: [assignment()],
        replacingAssignmentId: 1
      })
    ).toBeNull();
  });
});

describe("quyền điền người làm việc", () => {
  it("admin và điều phối sửa được mọi ô, kể cả ngày đã qua", () => {
    expect(
      canEditAssignmentPerson({
        role: "admin",
        userDepartmentId: null,
        assignment: assignment({ date: "2020-01-01" }),
        today: "2026-09-05"
      })
    ).toBe(true);
    expect(
      canEditAssignmentPerson({
        role: "dieu_phoi",
        userDepartmentId: null,
        assignment: assignment({ date: "2020-01-01" }),
        today: "2026-09-05"
      })
    ).toBe(true);
  });

  it("khoa phòng chỉ sửa ô của mình", () => {
    expect(
      canEditAssignmentPerson({
        role: "khoa_phong",
        userDepartmentId: 2,
        assignment: assignment(),
        today: "2026-09-05"
      })
    ).toBe(false);
    expect(
      canEditAssignmentPerson({
        role: "khoa_phong",
        userDepartmentId: 1,
        assignment: assignment(),
        today: "2026-09-05"
      })
    ).toBe(true);
  });

  it("khoa phòng không sửa được ngày đã qua", () => {
    expect(
      canEditAssignmentPerson({
        role: "khoa_phong",
        userDepartmentId: 1,
        assignment: assignment({ date: "2026-09-04" }),
        today: "2026-09-05"
      })
    ).toBe(false);
  });

  it("bật khóa thì khoa phòng phải điền trước ngày làm", () => {
    expect(
      canEditAssignmentPerson({
        role: "khoa_phong",
        userDepartmentId: 1,
        assignment: assignment(),
        today: "2026-09-05",
        lockOnWorkDay: true
      })
    ).toBe(false);
  });
});

describe("đổi ngày làm của điều phối", () => {
  const base = {
    source: { id: 1, userId: 10, date: "2026-09-12" },
    target: { id: 2, userId: 11, date: "2026-09-19" },
    requesterUserId: 10,
    today: "2026-09-05"
  };

  it("cho phép đổi giữa hai điều phối khác nhau ở ngày chưa qua", () => {
    expect(validateCoordinatorSwap(base)).toBeNull();
  });

  it("chỉ được xin đổi ngày làm của chính mình", () => {
    expect(validateCoordinatorSwap({ ...base, requesterUserId: 11 }))
      .toBe("Chỉ được xin đổi ngày làm của chính mình.");
  });

  it("không đổi với chính mình", () => {
    expect(
      validateCoordinatorSwap({ ...base, target: { id: 2, userId: 10, date: "2026-09-19" } })
    ).toBe("Hãy chọn ngày làm của một điều phối khác.");
  });

  it("không đổi cùng một ô", () => {
    expect(validateCoordinatorSwap({ ...base, target: { ...base.source } }))
      .toBe("Không thể đổi với chính ngày làm đó.");
  });

  it("không đổi ngày đã qua", () => {
    expect(
      validateCoordinatorSwap({ ...base, source: { id: 1, userId: 10, date: "2026-09-01" } })
    ).toBe("Chỉ đổi được ngày làm chưa qua.");
    expect(
      validateCoordinatorSwap({ ...base, target: { id: 2, userId: 11, date: "2026-09-01" } })
    ).toBe("Chỉ đổi được ngày làm chưa qua.");
  });
});

describe("báo cáo làm việc", () => {
  const signed = {
    signatureDieuPhoi: "data:image/png;base64,AAAA",
    signatureDieuPhoiName: "Trần B",
    signatureDieuPhoiAt: "2026-09-05T10:00:00Z"
  };

  it("nhận biết báo cáo đã được ký chốt", () => {
    expect(hasCoordinatorSignature(null)).toBe(false);
    expect(hasCoordinatorSignature({ signatureDieuPhoi: null, signatureDieuPhoiName: null, signatureDieuPhoiAt: null }))
      .toBe(false);
    expect(hasCoordinatorSignature(signed)).toBe(true);
  });

  it("sau khi ký chốt thì chỉ admin còn sửa được số liệu", () => {
    expect(canEditWorkReport("admin", signed)).toBe(true);
    expect(canEditWorkReport("dieu_phoi", signed)).toBe(false);
    expect(canEditWorkReport("dieu_phoi", null)).toBe(true);
    expect(canEditWorkReport("khoa_phong", null)).toBe(false);
  });

  it("lấy tên người ký từ dữ liệu gửi lên hoặc tên tài khoản", () => {
    expect(resolveSignerName("  Nguyễn Văn A  ", "Trần B")).toBe("Nguyễn Văn A");
    expect(resolveSignerName("", "Trần B")).toBe("Trần B");
    expect(resolveSignerName(undefined, null)).toBe("");
  });

  it("tóm tắt điểm danh", () => {
    expect(attendanceSummary(0, 0)).toBe("Chưa có phân công");
    expect(attendanceSummary(2, 5)).toBe("2/5 khoa phòng có mặt");
  });
});

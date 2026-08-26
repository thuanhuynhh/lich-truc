import { types as pgTypes } from "pg";
import { describe, expect, it } from "vitest";
import { PostgresDatabase } from "../src/worker/database";
import {
  assignmentPersonUpdate,
  clearScheduleStatement,
  passwordResetSessionCleanup,
  rotationDepartmentLookup,
  rotationMembersInsert,
  usernameAvailabilityLookup
} from "../src/worker/index";

describe("PostgreSQL type mapping", () => {
  it("keeps DATE values as YYYY-MM-DD strings", () => {
    expect(pgTypes.getTypeParser(1082)("2026-07-14")).toBe("2026-07-14");
  });

  it("keeps timestamps stable for API serialization", () => {
    expect(pgTypes.getTypeParser(1184)("2026-07-14 22:00:00+07")).toBe("2026-07-14T22:00:00+07:00");
    expect(pgTypes.getTypeParser(1184)("2026-07-14 15:00:00+00")).toBe("2026-07-14T15:00:00+00:00");
    expect(pgTypes.getTypeParser(1184)("2026-07-14 15:00:00.123456+00")).toBe("2026-07-14T15:00:00.123+00:00");
  });

  it("rolls back a batch when a step fails", async () => {
    const queries: string[] = [];
    const client = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.startsWith("DELETE FROM user_sessions")) {
          throw new Error("simulated session cleanup failure");
        }
        return { rows: [], rowCount: 1 };
      }
    };
    const database = new PostgresDatabase(client as never);

    await expect(database.batch([
      database.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind("hash", 1),
      database.prepare("DELETE FROM user_sessions WHERE user_id = ?").bind(1)
    ])).rejects.toThrow("simulated session cleanup failure");

    expect(queries[0]).toBe("BEGIN");
    expect(queries.at(-1)).toBe("ROLLBACK");
    expect(queries).not.toContain("COMMIT");
  });

  it("appends RETURNING id only for identity tables", async () => {
    const queries: string[] = [];
    const client = {
      query: async (sql: string) => {
        queries.push(sql);
        return { rows: [{ id: 7 }], rowCount: 1 };
      }
    };
    const database = new PostgresDatabase(client as never);

    await database.prepare("INSERT INTO assignments (date, department_id) VALUES (?, ?)").bind("2026-09-05", 1).run();
    await database.prepare("INSERT INTO work_days (date, session) VALUES (?, ?)").bind("2026-09-05", "full").run();

    expect(queries[0]).toContain("RETURNING id");
    expect(queries[1]).not.toContain("RETURNING id");
  });
});

describe("câu lệnh SQL của worker", () => {
  it("keeps the current session when an admin resets their own password", () => {
    expect(passwordResetSessionCleanup(1, 1, "current-session")).toEqual({
      sql: "DELETE FROM user_sessions WHERE user_id = ? AND id <> ?",
      bindings: [1, "current-session"]
    });
    expect(passwordResetSessionCleanup(1, 2, "current-session")).toEqual({
      sql: "DELETE FROM user_sessions WHERE user_id = ?",
      bindings: [2]
    });
  });

  it("does not send an untyped NULL parameter when checking username availability", () => {
    expect(usernameAvailabilityLookup("admin", 1)).toEqual({
      sql: "SELECT id FROM users WHERE lower(username) = lower(?) AND id <> ?",
      bindings: ["admin", 1]
    });
    expect(usernameAvailabilityLookup("new-user")).toEqual({
      sql: "SELECT id FROM users WHERE lower(username) = lower(?)",
      bindings: ["new-user"]
    });
  });

  it("loads all rotation departments in one query", () => {
    const lookup = rotationDepartmentLookup(Array.from({ length: 25 }, (_, index) => index + 1));

    expect(lookup.sql.match(/\?/g)).toHaveLength(25);
    expect(lookup.sql).toContain("FROM departments WHERE id IN");
    expect(lookup.bindings).toHaveLength(25);
  });

  it("inserts every rotation turn with one statement", () => {
    const turns = Array.from({ length: 25 }, (_, index) => [index + 1]);
    const insert = rotationMembersInsert(turns);

    expect(insert.sql.match(/\(\?, \?, \?\)/g)).toHaveLength(25);
    expect(insert.sql.match(/INSERT INTO rotation_members/g)).toHaveLength(1);
    expect(insert.bindings).toHaveLength(75);
    expect(insert.bindings.slice(0, 6)).toEqual([0, 1, 0, 1, 2, 0]);
  });

  it("xóa phân công theo ngày hoặc theo cả tháng", () => {
    expect(clearScheduleStatement("date", "2026-09-05")).toEqual({
      sql: "DELETE FROM assignments WHERE date = ?",
      bindings: ["2026-09-05"]
    });
    expect(clearScheduleStatement("month", "2026-09")).toEqual({
      sql: "DELETE FROM assignments WHERE date BETWEEN ? AND ?",
      bindings: ["2026-09-01", "2026-09-30"]
    });
  });
});

describe("cập nhật người làm việc", () => {
  const base = {
    assignmentId: 5,
    userId: 9,
    personName: "Nguyễn Văn A",
    personPhone: "0901234567",
    today: "2026-09-05"
  };

  it("admin và điều phối cập nhật không kèm điều kiện chủ sở hữu", () => {
    for (const role of ["admin", "dieu_phoi"] as const) {
      const update = assignmentPersonUpdate({ ...base, role, departmentId: null });
      expect(update.sql).toBe(
        "UPDATE assignments SET person_name = ?, person_phone = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      );
      expect(update.bindings).toEqual(["Nguyễn Văn A", "0901234567", 9, 5]);
    }
  });

  it("khoa phòng bị giới hạn theo khoa phòng và ngày chưa qua", () => {
    const update = assignmentPersonUpdate({ ...base, role: "khoa_phong", departmentId: 3 });

    expect(update.sql).toContain("AND department_id = ? AND date >= ?");
    expect(update.bindings).toEqual(["Nguyễn Văn A", "0901234567", 9, 5, 3, "2026-09-05"]);
  });

  it("bật khóa thì khoa phòng chỉ sửa được ngày trước ngày làm", () => {
    const update = assignmentPersonUpdate({
      ...base,
      role: "khoa_phong",
      departmentId: 3,
      lockOnWorkDay: true
    });

    expect(update.sql).toContain("AND department_id = ? AND date > ?");
  });
});

import { types as pgTypes } from "pg";
import { describe, expect, it } from "vitest";
import { PostgresDatabase } from "../src/worker/database";
import { dutyReportUpdateWhere, passwordResetSessionCleanup, usernameAvailabilityLookup } from "../src/worker/index";

describe("PostgreSQL type mapping", () => {
  it("keeps DATE values as YYYY-MM-DD strings", () => {
    expect(pgTypes.getTypeParser(1082)("2026-07-14")).toBe("2026-07-14");
  });

  it("keeps timestamps stable for API serialization", () => {
    expect(pgTypes.getTypeParser(1184)("2026-07-14 22:00:00+07")).toBe("2026-07-14T22:00:00+07:00");
    expect(pgTypes.getTypeParser(1184)("2026-07-14 15:00:00+00")).toBe("2026-07-14T15:00:00+00:00");
    expect(pgTypes.getTypeParser(1184)("2026-07-14 15:00:00.123456+00")).toBe("2026-07-14T15:00:00.123+00:00");
  });

  it("rolls back a batch when a profile update step fails", async () => {
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

  it("lets every authenticated role update an existing report", () => {
    expect(dutyReportUpdateWhere("admin")).toBe("date = ?");
    expect(dutyReportUpdateWhere("bs")).toBe("date = ?");
    expect(dutyReportUpdateWhere("ktv")).toBe("date = ?");
  });
});

import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import pg from "pg";

const sourcePath = process.argv[2];
const schemaPath = process.argv[3] || "postgres/schema.sql";
const replace = process.argv.includes("--replace");
const connectionString = process.env.DATABASE_URL;
const appPassword = process.env.APP_DB_PASSWORD || randomBytes(32).toString("base64url");

if (!sourcePath || !connectionString) {
  throw new Error("Usage: DATABASE_URL=... APP_DB_PASSWORD=... node scripts/migrate-d1-to-postgres.mjs <d1-export.sql> [schema.sql]");
}

const importOrder = [
  "schedule_units",
  "system_settings",
  "blocked_leave_days",
  "staff",
  "users",
  "user_sessions",
  "unit_rotation_members",
  "schedule_assignments",
  "leave_requests",
  "leave_days",
  "audit_logs",
  "unit_rotations",
  "swap_requests",
  "duty_reports",
  "notification_reads"
];

const identityTables = importOrder.filter((table) => ![
  "system_settings",
  "blocked_leave_days",
  "user_sessions",
  "unit_rotations",
  "duty_reports",
  "notification_reads"
].includes(table));

function parseValues(input) {
  const values = [];
  let index = 0;

  while (index < input.length) {
    while (input[index] === " ") index += 1;
    if (input[index] === "'") {
      index += 1;
      let value = "";
      while (index < input.length) {
        if (input[index] === "'" && input[index + 1] === "'") {
          value += "'";
          index += 2;
        } else if (input[index] === "'") {
          index += 1;
          break;
        } else {
          value += input[index];
          index += 1;
        }
      }
      values.push(value);
    } else {
      const comma = input.indexOf(",", index);
      const end = comma === -1 ? input.length : comma;
      const token = input.slice(index, end).trim();
      if (token === "NULL") values.push(null);
      else if (/^-?\d+(?:\.\d+)?$/.test(token)) values.push(Number(token));
      else throw new Error(`Unsupported SQLite value: ${token.slice(0, 80)}`);
      index = end;
    }
    while (input[index] === " ") index += 1;
    if (input[index] === ",") index += 1;
  }

  return values;
}

function parseExport(sql) {
  const tables = new Map(importOrder.map((table) => [table, { columns: null, rows: [] }]));
  const insertPattern = /^INSERT INTO "([^"]+)" \(([^)]+)\) VALUES\((.*)\);$/;

  for (const line of sql.split(/\r?\n/)) {
    if (!line.startsWith("INSERT INTO")) continue;
    const match = line.match(insertPattern);
    if (!match || !tables.has(match[1])) continue;
    const columns = [...match[2].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
    const values = parseValues(match[3]);
    if (columns.length !== values.length) throw new Error(`Column/value mismatch in ${match[1]}`);
    const table = tables.get(match[1]);
    if (table.columns && table.columns.join("\0") !== columns.join("\0")) {
      throw new Error(`Inconsistent column list in ${match[1]}`);
    }
    table.columns = columns;
    table.rows.push(values);
  }

  return tables;
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function setAppRolePassword(client) {
  const quoted = await client.query("SELECT quote_literal($1) AS password", [appPassword]);
  const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'lich_truc_app'");
  const password = quoted.rows[0].password;
  if (exists.rowCount) {
    await client.query(`ALTER ROLE lich_truc_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${password}`);
  } else {
    await client.query(`CREATE ROLE lich_truc_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${password}`);
  }
  await client.query("ALTER ROLE lich_truc_app SET search_path TO lich_truc, public");
}

async function insertTable(client, tableName, table) {
  if (!table.rows.length) return;
  const batchSize = 100;
  const columns = table.columns.map(quoteIdentifier).join(", ");
  for (let offset = 0; offset < table.rows.length; offset += batchSize) {
    const rows = table.rows.slice(offset, offset + batchSize);
    const values = [];
    const groups = rows.map((row) => {
      const placeholders = row.map((value) => {
        values.push(value);
        return `$${values.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await client.query(
      `INSERT INTO lich_truc.${quoteIdentifier(tableName)} (${columns}) VALUES ${groups.join(", ")}`,
      values
    );
  }
}

const [sourceSql, schemaSql] = await Promise.all([
  readFile(sourcePath, "utf8"),
  readFile(schemaPath, "utf8")
]);
const sourceTables = parseExport(sourceSql);
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 20_000 });

try {
  await client.connect();
  const schemaExists = await client.query("SELECT 1 FROM pg_namespace WHERE nspname = 'lich_truc'");
  if (schemaExists.rowCount && !replace) {
    throw new Error("Schema lich_truc already exists. Refusing to overwrite without --replace.");
  }

  await setAppRolePassword(client);
  if (schemaExists.rowCount) await client.query("DROP SCHEMA lich_truc CASCADE");
  await client.query(schemaSql);

  await client.query("BEGIN");
  try {
    for (const tableName of importOrder) {
      await insertTable(client, tableName, sourceTables.get(tableName));
    }
    for (const tableName of identityTables) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE(MAX(id), 1), COUNT(*) > 0) FROM lich_truc.${quoteIdentifier(tableName)}`,
        [`lich_truc.${tableName}`]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }

  const counts = {};
  for (const tableName of importOrder) {
    const result = await client.query(`SELECT COUNT(*)::integer AS count FROM lich_truc.${quoteIdentifier(tableName)}`);
    const expected = sourceTables.get(tableName).rows.length;
    const actual = result.rows[0].count;
    if (actual !== expected) throw new Error(`Count mismatch for ${tableName}: D1=${expected}, Postgres=${actual}`);
    counts[tableName] = actual;
  }

  console.log(JSON.stringify({ migrated: true, schema: "lich_truc", counts }, null, 2));
} finally {
  await client.end().catch(() => {});
}

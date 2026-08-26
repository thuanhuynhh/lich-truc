import { Client, types as pgTypes, type QueryResult } from "pg";

function postgresTimestamp(value: string): string {
  const iso = value.replace(" ", "T").replace(/(\.\d{3})\d+/, "$1");
  return /[+-]\d{2}$/.test(iso) ? `${iso}:00` : iso;
}

pgTypes.setTypeParser(20, (value) => Number(value));
pgTypes.setTypeParser(1082, (value) => value);
pgTypes.setTypeParser(1114, (value) => `${value.replace(" ", "T").replace(/(\.\d{3})\d+/, "$1")}Z`);
pgTypes.setTypeParser(1184, postgresTimestamp);

export interface DatabaseResult<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: {
    changes: number;
    last_row_id: number | null;
  };
}

const identityTables = new Set([
  "departments",
  "users",
  "assignments",
  "coordinator_assignments",
  "swap_requests",
  "rotation_members",
  "audit_logs"
]);

function postgresSql(sql: string): string {
  let output = "";
  let parameter = 0;
  let singleQuoted = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    if (char === "'") {
      output += char;
      if (singleQuoted && sql[index + 1] === "'") {
        output += sql[index + 1];
        index += 1;
      } else {
        singleQuoted = !singleQuoted;
      }
    } else if (char === "?" && !singleQuoted) {
      parameter += 1;
      output += `$${parameter}`;
    } else {
      output += char;
    }
  }

  return output;
}

function addReturningId(sql: string): string {
  const insert = sql.match(/^\s*INSERT\s+INTO\s+"?([a-z_][a-z0-9_]*)"?/i);
  if (!insert || !identityTables.has(insert[1].toLowerCase()) || /\bRETURNING\b/i.test(sql)) return sql;
  return `${sql.trim().replace(/;$/, "")} RETURNING id`;
}

export class PostgresPreparedStatement {
  private parameters: unknown[] = [];

  constructor(private readonly client: Client, private readonly sourceSql: string) {}

  bind(...values: unknown[]): PostgresPreparedStatement {
    this.parameters = values;
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const result = await this.query(false);
    return (result.rows[0] as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<DatabaseResult<T>> {
    const result = await this.query(false);
    return this.toResult(result) as DatabaseResult<T>;
  }

  async run<T = Record<string, unknown>>(): Promise<DatabaseResult<T>> {
    const result = await this.query(true);
    return this.toResult(result) as DatabaseResult<T>;
  }

  private async query(returnInsertedId: boolean): Promise<QueryResult<Record<string, unknown>>> {
    const sql = returnInsertedId ? addReturningId(postgresSql(this.sourceSql)) : postgresSql(this.sourceSql);
    return this.client.query<Record<string, unknown>>(sql, this.parameters);
  }

  private toResult(result: QueryResult<Record<string, unknown>>): DatabaseResult {
    const id = result.rows[0]?.id;
    return {
      results: result.rows,
      success: true,
      meta: {
        changes: result.rowCount ?? 0,
        last_row_id: typeof id === "number" ? id : null
      }
    };
  }
}

export class PostgresDatabase {
  constructor(private readonly client: Client) {}

  prepare(sql: string): PostgresPreparedStatement {
    return new PostgresPreparedStatement(this.client, sql);
  }

  async batch(statements: PostgresPreparedStatement[]): Promise<DatabaseResult[]> {
    await this.client.query("BEGIN");
    try {
      const results: DatabaseResult[] = [];
      for (const statement of statements) results.push(await statement.run());
      await this.client.query("COMMIT");
      return results;
    } catch (error) {
      await this.client.query("ROLLBACK");
      throw error;
    }
  }
}

export function createPostgresClient(connectionString: string): Client {
  return new Client({ connectionString });
}

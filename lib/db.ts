import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getDbPool(): pg.Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }
  if (!pool) {
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: isProd ? { rejectUnauthorized: true } : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}

/**
 * Convert named placeholders (:paramName) to positional ($1, $2, ...)
 * and build an ordered values array from the params object.
 */
function namedToPositional(
  sql: string,
  params: Record<string, unknown> = {}
): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const paramMap = new Map<string, number>();

  const text = sql.replace(
    /:([a-zA-Z_][a-zA-Z0-9_]*)/g,
    (_match, name: string) => {
      if (!(name in params)) {
        throw new Error(`Missing SQL parameter: ${name}`);
      }
      if (paramMap.has(name)) {
        return `$${paramMap.get(name)}`;
      }
      values.push(params[name]);
      const idx = values.length;
      paramMap.set(name, idx);
      return `$${idx}`;
    }
  );

  return { text, values };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface DbResult<T = any> extends Array<T> {
  insertId: number | null;
  rowCount: number;
}

export async function dbQuery<T = any>(
  sql: string,
  params: Record<string, unknown> = {},
  client?: pg.PoolClient
): Promise<DbResult<T>> {
  const db = client || getDbPool();
  const { text, values } = namedToPositional(sql, params);
  const result = await db.query(text, values);

  const rows = (result.rows || []) as DbResult<T>;
  rows.insertId = rows[0] ? (rows[0] as Record<string, unknown>).id as number ?? null : null;
  rows.rowCount = result.rowCount ?? 0;
  return rows;
}

/**
 * Execute a callback within a database transaction.
 * Automatically commits on success and rolls back on error.
 */
export async function dbTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const db = getDbPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

import "dotenv/config";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export interface DB {
  query<T extends pg.QueryResultRow = Record<string, any>>(
    sql: string,
    params?: any[],
  ): Promise<{ rows: T[] }>;
  transaction<T>(fn: (db: DB) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function database(memory = false): Promise<DB> {
  let db: DB;
  if (process.env.DATABASE_URL && !memory) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    db = {
      query: <T extends pg.QueryResultRow>(sql: string, params?: any[]) =>
        pool.query<T>(sql, params),
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await fn({
            ...db,
            query: <T extends pg.QueryResultRow>(s: string, p?: any[]) =>
              client.query<T>(s, p),
          });
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  } else {
    if (process.env.NODE_ENV === "production" && !memory)
      throw new Error("Producción requiere DATABASE_URL");
    const path = resolve(process.env.DATA_DIR || "data", "db");
    if (!memory) await mkdir(path, { recursive: true });
    const engine = new PGlite(memory ? undefined : path);
    db = {
      query: (sql, params) => engine.query(sql, params),
      transaction: (fn) =>
        engine.transaction((tx) =>
          fn({ ...db, query: (s, p) => tx.query(s, p) }),
        ),
      close: () => engine.close(),
    };
  }
  const sql = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  await db.transaction(async (tx) => {
    // Advisory lock makes concurrent initial application starts safe on PostgreSQL.
    await tx.query("SELECT pg_advisory_xact_lock(20261020)");
    for (const statement of sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await tx.query(statement);
  });
  return db;
}

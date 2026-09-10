/**
 * Test database: node:sqlite behind the Worker's SqlDb interface, plus a
 * minimal D1Database shim so route handlers run unmodified in tests.
 * D1 is SQLite, so the atomicity-critical statements (guarded seat INSERT,
 * ON CONFLICT dedupe/upsert) exercise the real engine semantics.
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SqlDb } from "@worker/lib/db";

const MIGRATION = fileURLToPath(new URL("../../migrations/0001_init.sql", import.meta.url));

export function openTestDb(): { raw: DatabaseSync; db: SqlDb } {
  const raw = new DatabaseSync(":memory:");
  raw.exec(readFileSync(MIGRATION, "utf8"));
  return { raw, db: wrap(raw) };
}

function wrap(raw: DatabaseSync): SqlDb {
  return {
    async run(sql, ...params) {
      const res = raw.prepare(sql).run(...(params as never[]));
      return { changes: Number(res.changes) };
    },
    async first<T>(sql: string, ...params: unknown[]) {
      return (raw.prepare(sql).get(...(params as never[])) as T | undefined) ?? null;
    },
    async all<T>(sql: string, ...params: unknown[]) {
      return raw.prepare(sql).all(...(params as never[])) as T[];
    },
  };
}

/** Just enough of D1Database for the route handlers used in tests. */
export function fakeD1(raw: DatabaseSync): D1Database {
  const make = (sql: string, params: unknown[]) => ({
    bind: (...more: unknown[]) => make(sql, [...params, ...more]),
    async run() {
      const res = raw.prepare(sql).run(...(params as never[]));
      return { success: true, meta: { changes: Number(res.changes) }, results: [] };
    },
    async first<T>() {
      return (raw.prepare(sql).get(...(params as never[])) as T | undefined) ?? null;
    },
    async all<T>() {
      const results = raw.prepare(sql).all(...(params as never[])) as T[];
      return { success: true, results, meta: {} };
    },
  });
  return { prepare: (sql: string) => make(sql, []) } as unknown as D1Database;
}

export function seedAffiliate(
  db: SqlDb,
  id: string,
  opts: { name?: string; enrolledAt?: string; tapId?: string; approved?: boolean } = {},
): Promise<unknown> {
  return db.run(
    `INSERT INTO affiliates (id, tapfiliate_id, display_name, display_name_approved, status, enrolled_at)
     VALUES (?1, ?2, ?3, ?4, 'active', ?5)`,
    id,
    opts.tapId ?? null,
    opts.name ?? `Affiliate ${id}`,
    opts.approved === false ? 0 : 1,
    opts.enrolledAt ?? "2026-01-01T00:00:00.000Z",
  );
}

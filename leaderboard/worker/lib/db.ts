/**
 * Minimal SQL interface shared by the Worker (D1) and the test suite
 * (node:sqlite) so the atomicity-critical statements are exercised against
 * real SQLite semantics — D1 is SQLite.
 */
export interface SqlDb {
  run(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
  first<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | null>;
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
}

export function d1Db(d1: D1Database): SqlDb {
  return {
    async run(sql, ...params) {
      const res = await d1.prepare(sql).bind(...params).run();
      return { changes: res.meta.changes ?? 0 };
    },
    async first<T>(sql: string, ...params: unknown[]) {
      return (await d1.prepare(sql).bind(...params).first<T>()) ?? null;
    },
    async all<T>(sql: string, ...params: unknown[]) {
      const res = await d1.prepare(sql).bind(...params).all<T>();
      return res.results as T[];
    },
  };
}

export const nowIso = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();

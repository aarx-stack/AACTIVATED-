/**
 * Forward-only SQL migration runner.
 *
 * - Migrations are the numbered .sql files in ./migrations, applied in filename
 *   order, each inside its own transaction.
 * - Applied versions are recorded in schema_migrations with a sha256 checksum;
 *   a drifted (edited-after-apply) migration fails loudly instead of silently
 *   diverging from history.
 * - A session-level advisory lock serializes concurrent runners (safe in CI /
 *   multiple deploys).
 * - No "down" migrations by design: production history is never rolled back,
 *   mistakes are corrected by a new forward migration (docs/RUNBOOK.md).
 *
 * CLI:
 *   node src/migrate.js up      # apply pending migrations
 *   node src/migrate.js status  # list applied/pending
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPool } from './db.js';

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations'
);

// Advisory lock key for the migration runner (arbitrary fixed 64-bit int).
const MIGRATION_LOCK_KEY = '727274316274001';

/** Load migration files sorted by version (filename prefix). */
export async function loadMigrations(dir = MIGRATIONS_DIR) {
  const files = (await readdir(dir))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return Promise.all(
    files.map(async (filename) => {
      const sql = await readFile(path.join(dir, filename), 'utf8');
      return {
        version: filename.replace(/\.sql$/, ''),
        filename,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    })
  );
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

/**
 * Apply all pending migrations using the given pool.
 * @param {import('pg').Pool} pool
 * @param {{log?: (msg: string) => void, dir?: string}} [options]
 * @returns {Promise<{applied: string[], skipped: string[]}>}
 */
export async function migrate(pool, options = {}) {
  const log = options.log ?? (() => {});
  const migrations = await loadMigrations(options.dir);
  const client = await pool.connect();
  const applied = [];
  const skipped = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await ensureMigrationsTable(client);
    const { rows } = await client.query(
      'SELECT version, checksum FROM schema_migrations'
    );
    const seen = new Map(rows.map((r) => [r.version, r.checksum]));

    for (const m of migrations) {
      const existing = seen.get(m.version);
      if (existing) {
        if (existing !== m.checksum) {
          throw new Error(
            `migration drift: ${m.filename} was edited after being applied ` +
              `(recorded checksum ${existing.slice(0, 12)}…, file ${m.checksum.slice(0, 12)}…). ` +
              'Write a new forward migration instead of editing history.'
          );
        }
        skipped.push(m.version);
        continue;
      }
      log(`applying ${m.filename}`);
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
          [m.version, m.checksum]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${m.filename} failed: ${err.message}`, {
          cause: err,
        });
      }
      applied.push(m.version);
    }
    return { applied, skipped };
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    } finally {
      client.release();
    }
  }
}

/**
 * Report applied vs pending migrations.
 * @param {import('pg').Pool} pool
 */
export async function status(pool, options = {}) {
  const migrations = await loadMigrations(options.dir);
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const { rows } = await client.query(
      'SELECT version, applied_at FROM schema_migrations ORDER BY version'
    );
    const appliedAt = new Map(rows.map((r) => [r.version, r.applied_at]));
    return migrations.map((m) => ({
      version: m.version,
      applied: appliedAt.has(m.version),
      applied_at: appliedAt.get(m.version) ?? null,
    }));
  } finally {
    client.release();
  }
}

// ---- CLI ----
const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const command = process.argv[2] ?? 'up';
  const pool = createPool();
  try {
    if (command === 'up') {
      const result = await migrate(pool, { log: console.log });
      console.log(
        `migrations: ${result.applied.length} applied, ${result.skipped.length} already up to date`
      );
    } else if (command === 'status') {
      const rows = await status(pool);
      for (const r of rows) {
        console.log(`${r.applied ? '✓' : '✗'} ${r.version}${r.applied_at ? `  (${r.applied_at.toISOString?.() ?? r.applied_at})` : ''}`);
      }
    } else {
      console.error(`unknown command "${command}" — use: up | status`);
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

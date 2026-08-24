/**
 * Ephemeral PostgreSQL harness for integration tests.
 *
 * Resolution order:
 *   1. TEST_DATABASE_URL — use an existing server (CI service container, dev DB).
 *   2. Local postgres binaries — boot a throwaway cluster on a unix socket
 *      (fsync off, no TCP listener), destroyed when tests finish.
 *   3. Neither available — return null; the integration suite skips with a
 *      clear message instead of failing.
 *
 * Runs as an unprivileged user; when invoked as root (containers), commands are
 * dropped to the `postgres` system user because postgres refuses to run as root.
 * Nothing here touches any production database.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import pg from 'pg';

const execFileP = promisify(execFile);
const PORT = 5599; // unused by convention; unix-socket-only anyway

function findPgBin() {
  const candidates = ['/usr/lib/postgresql'];
  for (const root of candidates) {
    if (!existsSync(root)) continue;
    // pick the highest version directory
    const versions = readdirSync(root)
      .filter((v) => /^\d+$/.test(v))
      .sort((a, b) => Number(b) - Number(a));
    for (const v of versions) {
      const bin = path.join(root, v, 'bin');
      if (existsSync(path.join(bin, 'initdb'))) return bin;
    }
  }
  return null; // rely on PATH
}

async function runAs(cmd, args, { asPostgres }) {
  if (asPostgres) {
    const quoted = [cmd, ...args].map((a) => `'${a.replaceAll("'", `'\\''`)}'`).join(' ');
    return execFileP('su', ['-s', '/bin/sh', 'postgres', '-c', quoted]);
  }
  return execFileP(cmd, args);
}

/**
 * @returns {Promise<null | {
 *   pool: import('pg').Pool,
 *   makePool: (db?: string) => import('pg').Pool,
 *   stop: () => Promise<void>,
 *   kind: 'external'|'ephemeral',
 * }>}
 */
export async function startTestDatabase() {
  if (process.env.TEST_DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 5 });
    return {
      pool,
      makePool: () => new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 5 }),
      stop: async () => pool.end(),
      kind: 'external',
    };
  }

  const binDir = findPgBin();
  const initdb = binDir ? path.join(binDir, 'initdb') : 'initdb';
  const pgctl = binDir ? path.join(binDir, 'pg_ctl') : 'pg_ctl';
  try {
    await execFileP(initdb, ['--version']);
  } catch {
    return null; // no postgres binaries — caller skips
  }

  const asPostgres = process.getuid?.() === 0;
  const baseDir = process.env.PG_HARNESS_DIR ?? os.tmpdir();
  await mkdir(baseDir, { recursive: true });
  const workDir = await mkdtemp(path.join(baseDir, 'aarx-pg-'));
  // Unix socket paths are capped at ~107 bytes — keep the socket dir short.
  const sockDir = await mkdtemp(path.join(os.tmpdir(), '.s-'));
  const dataDir = path.join(workDir, 'data');

  if (asPostgres) {
    await execFileP('chown', ['-R', 'postgres:postgres', workDir, sockDir]);
    await execFileP('chmod', ['755', sockDir]);
  }

  await runAs(initdb, ['-D', dataDir, '-U', 'postgres', '--auth=trust', '--no-sync'], {
    asPostgres,
  });
  const serverOpts = [
    `-k ${sockDir}`,
    `-p ${PORT}`,
    `-c listen_addresses=`,
    '-c fsync=off',
    '-c synchronous_commit=off',
    '-c full_page_writes=off',
  ].join(' ');
  await runAs(
    pgctl,
    ['-D', dataDir, '-l', path.join(workDir, 'pg.log'), '-o', serverOpts, '-w', 'start'],
    { asPostgres }
  );

  const admin = new pg.Pool({ host: sockDir, port: PORT, user: 'postgres', database: 'postgres', max: 2 });
  await admin.query('CREATE DATABASE aactivated_data_core_test');
  await admin.end();

  const makePool = (db = 'aactivated_data_core_test') =>
    new pg.Pool({ host: sockDir, port: PORT, user: 'postgres', database: db, max: 5 });
  const pool = makePool();

  return {
    pool,
    makePool,
    kind: 'ephemeral',
    stop: async () => {
      await pool.end().catch(() => {});
      await runAs(pgctl, ['-D', dataDir, '-m', 'immediate', 'stop'], { asPostgres }).catch(
        () => {}
      );
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
      await rm(sockDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

/**
 * Seed runner. Seeds live in ./seeds as idempotent SQL (ON CONFLICT / WHERE NOT
 * EXISTS) so re-running is always safe. Seeds configure tenants and reference
 * data (AACTIVATED_RX = tenant #1); they never write transactional/financial
 * records.
 *
 * CLI: node src/seed.js
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPool } from './db.js';

const SEEDS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'seeds'
);

/**
 * Apply all seed files in order.
 * @param {import('pg').Pool} pool
 * @param {{log?: (msg: string) => void, dir?: string}} [options]
 * @returns {Promise<string[]>} applied seed filenames
 */
export async function seed(pool, options = {}) {
  const log = options.log ?? (() => {});
  const dir = options.dir ?? SEEDS_DIR;
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const client = await pool.connect();
  try {
    for (const filename of files) {
      log(`seeding ${filename}`);
      const sql = await readFile(path.join(dir, filename), 'utf8');
      await client.query(sql);
    }
    return files;
  } finally {
    client.release();
  }
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const pool = createPool();
  try {
    const files = await seed(pool, { log: console.log });
    console.log(`seeds: ${files.length} file(s) applied (idempotent)`);
  } finally {
    await pool.end();
  }
}

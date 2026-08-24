/**
 * Database abstraction for the Data Core.
 *
 * - Connection comes ONLY from configuration (DATABASE_URL / PG* env vars or an
 *   explicit config object) — no credentials in code, ever.
 * - node-postgres returns numeric columns as strings; combined with src/money.js
 *   this keeps all monetary values out of floating point end to end.
 * - withTransaction gives services one consistent unit-of-work primitive.
 */

import pg from 'pg';

const { Pool } = pg;

/**
 * Create a connection pool.
 * @param {object} [options]
 * @param {string} [options.connectionString] defaults to process.env.DATABASE_URL
 * @param {boolean|object} [options.ssl]
 */
export function createPool(options = {}) {
  const connectionString =
    options.connectionString ?? process.env.DATABASE_URL ?? undefined;
  const sslEnv = process.env.DATABASE_SSL;
  const ssl =
    options.ssl !== undefined
      ? options.ssl
      : sslEnv && sslEnv !== 'false' && sslEnv !== ''
        ? { rejectUnauthorized: true }
        : undefined;
  if (!connectionString && !process.env.PGHOST) {
    throw new Error(
      'data-core: DATABASE_URL is not set. Copy .env.example to .env or export DATABASE_URL.'
    );
  }
  return new Pool({ connectionString, ssl, max: options.max ?? 10 });
}

/**
 * Run fn inside a transaction on a dedicated client. Commits on success,
 * rolls back on any throw.
 * @template T
 * @param {import('pg').Pool} pool
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // connection-level failure; the original error matters more
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Resolve an organization id from its stable organization_key.
 * @param {import('pg').PoolClient|import('pg').Pool} db
 * @param {string} organizationKey e.g. 'AACTIVATED_RX'
 * @returns {Promise<string>} uuid
 */
export async function getOrganizationId(db, organizationKey) {
  const { rows } = await db.query(
    'SELECT id FROM organizations WHERE organization_key = $1',
    [organizationKey]
  );
  if (rows.length === 0) {
    throw new Error(`data-core: unknown organization_key "${organizationKey}"`);
  }
  return rows[0].id;
}

/**
 * Load organization_settings for an organization.
 * @param {import('pg').PoolClient|import('pg').Pool} db
 * @param {string} organizationId
 */
export async function getOrganizationSettings(db, organizationId) {
  const { rows } = await db.query(
    'SELECT * FROM organization_settings WHERE organization_id = $1',
    [organizationId]
  );
  if (rows.length === 0) {
    throw new Error(
      `data-core: organization ${organizationId} has no organization_settings row`
    );
  }
  return rows[0];
}

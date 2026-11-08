import "dotenv/config";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { Client } from "pg";

/** Direct database access for test setup only (the app is always driven through the UI). */
export async function withDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * A fresh company-wide contractor budget for this month at a given spend, so the 75% flow can be
 * exercised on every run without touching the demo budgets.
 */
export async function createTestBudget(limitUsd: number, spentUsd: number) {
  const id = `e2e_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const name = `E2E contractor budget ${id.slice(4, 10)}`;
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  await withDb(async (db) => {
    await db.query(
      `INSERT INTO "Budget" (id, name, kind, "periodStart", "periodEnd", "limitUsd", "updatedAt")
       VALUES ($1, $2, 'CONTRACTOR', $3, $4, $5, now())`,
      [id, name, start, end, limitUsd],
    );
    await db.query(
      `INSERT INTO "SpendEvent" (id, kind, description, "amountUsd", "budgetId")
       VALUES ($1, 'CONTRACTOR', 'Earlier contractor work', $2, $3)`,
      [`${id}_s`, spentUsd, id],
    );
  });
  return { id, name };
}

/** Ends the test budget's period so it drops off the Finance page. History is kept. */
export async function retireTestBudget(id: string) {
  await withDb((db) =>
    db.query(
      `UPDATE "Budget" SET "periodEnd" = now() - interval '1 day', "updatedAt" = now() WHERE id = $1`,
      [id],
    ),
  );
}

/** A project on the map that needs executive approval to launch, sitting in Review. */
export async function createGatedProject() {
  const id = `e2e_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const name = `E2E launch ${id.slice(4, 10)}`;
  await withDb((db) =>
    db.query(
      `INSERT INTO "Project" (id, name, description, phase, progress, "requiresExecutiveApproval", "sortOrder", "updatedAt")
       VALUES ($1, $2, 'Test project', 'REVIEW', 90, true, 900, now())`,
      [id, name],
    ),
  );
  return { id, name };
}

export async function removeProject(id: string) {
  await withDb((db) => db.query(`DELETE FROM "Project" WHERE id = $1`, [id]));
}

export async function removeProjectByName(name: string) {
  await withDb((db) => db.query(`DELETE FROM "Project" WHERE name = $1`, [name]));
}

/** The rate-limit key the app uses for a client address (same hashing as the app). */
function ipKey(ip: string) {
  return `signin-ip:${createHash("sha256").update(ip.trim().toLowerCase()).digest("hex").slice(0, 32)}`;
}

/** Fills a client address's sign-in allowance, so the next request is refused. */
export async function exhaustSignInLimit(ip: string, hits = 20) {
  await withDb(async (c) => {
    for (let i = 0; i < hits; i++) {
      await c.query(`INSERT INTO "RateLimitHit" (id, key, "createdAt") VALUES ($1, $2, now())`, [
        randomUUID(),
        ipKey(ip),
      ]);
    }
  });
}

export async function clearSignInLimit(ip: string) {
  await withDb((c) => c.query(`DELETE FROM "RateLimitHit" WHERE key = $1`, [ipKey(ip)]));
}

/** A real unsubscribe link for a demo clinic contact (same signing as the app). */
export function unsubscribeLinkFor(contactId: string, email: string, campaignId: string) {
  const key = process.env.AUTH_SECRET || `dev-only:${process.env.DATABASE_URL}`;
  const body = Buffer.from(JSON.stringify({ k: contactId, e: email, c: campaignId })).toString(
    "base64url",
  );
  const sig = createHmac("sha256", key).update(body).digest("base64url");
  return `/unsubscribe?t=${body}.${sig}`;
}

export async function clearSuppressions() {
  await withDb((c) => c.query(`DELETE FROM "EmailSuppression"`));
}

/** The id of someone's personal assistant. */
export async function assistantIdOf(email: string) {
  return withDb(async (c) => {
    const r = await c.query(
      `SELECT a.id FROM "Agent" a JOIN "User" u ON u.id = a."ownerId" WHERE a.kind = 'PERSONAL' AND u.email = $1`,
      [email],
    );
    return r.rows[0]?.id as string;
  });
}

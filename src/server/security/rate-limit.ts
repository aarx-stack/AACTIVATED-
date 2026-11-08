/**
 * Sliding-window rate limiting backed by Postgres (no Redis or extra service).
 * Used for sign-in emails: per address (stops anyone flooding an inbox) and per network
 * address (stops one client hammering the form).
 */
import { createHash } from "node:crypto";
import { db, type DbClient } from "@/lib/db";

export interface Limit {
  max: number;
  windowMs: number;
}

export const SIGN_IN_LIMITS = {
  /** Sign-in emails actually sent to one address. */
  perEmail: { max: 5, windowMs: 15 * 60_000 },
  /** Sign-in requests from one network address (any email, real or not). */
  perIp: { max: 20, windowMs: 15 * 60_000 },
} as const satisfies Record<string, Limit>;

/** Keys are hashed so email addresses and IPs are not stored in plain text. */
export function limitKey(scope: string, value: string) {
  return `${scope}:${createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 32)}`;
}

/**
 * Records one hit and reports whether it is within the limit. A hit over the limit is not
 * recorded, so a blocked client is let back in once its window passes.
 */
export async function consume(
  key: string,
  limit: Limit,
  options: { client?: DbClient; now?: Date } = {},
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const client = options.client ?? db;
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - limit.windowMs);
  // Prune this key's expired hits as we go; keeps the table small without a cleanup job.
  await client.rateLimitHit.deleteMany({ where: { key, createdAt: { lt: since } } });
  const hits = await client.rateLimitHit.findMany({
    where: { key, createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  if (hits.length >= limit.max) {
    const oldest = hits[0]!.createdAt.getTime();
    return { allowed: false, retryAfterMs: Math.max(0, oldest + limit.windowMs - now.getTime()) };
  }
  await client.rateLimitHit.create({ data: { key, createdAt: now } });
  return { allowed: true, retryAfterMs: 0 };
}

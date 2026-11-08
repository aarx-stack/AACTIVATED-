/**
 * Sliding-window rate limiting backed by Postgres (no Redis or extra service).
 * Used for sign-in emails: per address (stops anyone flooding an inbox) and per network
 * address (stops one client hammering the form).
 */
import { createHash } from "node:crypto";
import { db, type Db } from "@/lib/db";

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

/**
 * The client's network address for rate limiting. Prefers X-Real-IP (set by the hosting proxy),
 * then the LAST X-Forwarded-For entry, which is the one the nearest proxy added. The first entry
 * is whatever the client claimed, so it is never used. Deploy behind a proxy that sets these.
 */
export function clientAddressFrom(headers: Pick<Headers, "get">): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const hops = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  return hops.at(-1) ?? "unknown";
}

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
  options: { client?: Db; now?: Date } = {},
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const client = options.client ?? db;
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - limit.windowMs);
  // One request per key at a time (a transaction-scoped lock), so a burst of parallel requests
  // cannot all slip under the limit.
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    // Prune this key's expired hits as we go; keeps the table small without a cleanup job.
    await tx.rateLimitHit.deleteMany({ where: { key, createdAt: { lt: since } } });
    const hits = await tx.rateLimitHit.findMany({
      where: { key, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    if (hits.length >= limit.max) {
      const oldest = hits[0]!.createdAt.getTime();
      return {
        allowed: false,
        retryAfterMs: Math.max(0, oldest + limit.windowMs - now.getTime()),
      };
    }
    await tx.rateLimitHit.create({ data: { key, createdAt: now } });
    return { allowed: true, retryAfterMs: 0 };
  });
}

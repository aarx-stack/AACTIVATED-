import "server-only";

/**
 * Small in-memory fixed-window rate limiter. It is per server instance: adequate for a single
 * owner on one instance, but not a distributed limit. Supabase Auth applies its own limits to
 * sign-in attempts in connected mode.
 */
const g = globalThis as unknown as { __cdRate?: Map<string, { count: number; resetAt: number }> };
const buckets = (g.__cdRate ??= new Map());

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count++;
  return bucket.count <= limit;
}

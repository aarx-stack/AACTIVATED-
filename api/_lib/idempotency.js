/**
 * Idempotency store: remembers processed Tapfiliate conversion IDs so a
 * redelivered webhook (Tapfiliate retries on non-2xx, network blips, manual
 * replays) never processes the same conversion twice.
 *
 * Two-phase design so a crashed or timeout-killed invocation cannot swallow
 * a conversion forever:
 *   1. `markProcessed` claims the key atomically (SET NX) with a SHORT
 *      pending TTL (IDEMPOTENCY_PENDING_TTL_MINUTES, default 15). If the
 *      function dies mid-flight the claim simply expires and a retry/replay
 *      can reprocess.
 *   2. `finalize` extends the claim to the LONG TTL (IDEMPOTENCY_TTL_DAYS,
 *      default 40) once processing completed, making the dedup durable.
 *   3. `release` drops the claim explicitly on handled failures so
 *      Tapfiliate's retry reprocesses immediately.
 *
 * Backend selection:
 *  - Upstash Redis / Vercel KV over REST when configured
 *    (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN, or the Vercel KV
 *    aliases KV_REST_API_URL + KV_REST_API_TOKEN). Durable across cold starts.
 *  - In-memory fallback otherwise: best-effort within a warm instance. Even
 *    without Redis the system stays safe because the handler recomputes
 *    monthly volume from Tapfiliate on every event and only moves an
 *    affiliate when the group actually differs — reprocessing is a no-op.
 */

const memory = new Map(); // key -> expiresAtMs

function redisConfig(env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (url && token) return { url: url.replace(/\/$/, ''), token };
  return null;
}

async function redisCommand(cfg, command) {
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) {
    throw new Error(`Idempotency store error: HTTP ${res.status} ${await res.text().then((t) => t.slice(0, 200))}`);
  }
  const data = await res.json();
  if (data && typeof data === 'object' && 'error' in data && data.error) {
    throw new Error(`Idempotency store error: ${data.error}`);
  }
  return data?.result;
}

function sweepMemory(nowMs) {
  if (memory.size < 5000) return;
  for (const [key, exp] of memory) {
    if (exp <= nowMs) memory.delete(key);
  }
}

export function createIdempotencyStore(env = process.env) {
  const cfg = redisConfig(env);
  const ttlDays = Number(env.IDEMPOTENCY_TTL_DAYS || 40);
  const finalTtlSeconds = Math.max(1, Math.round(ttlDays * 24 * 60 * 60));
  const pendingMinutes = Number(env.IDEMPOTENCY_PENDING_TTL_MINUTES || 15);
  const pendingTtlSeconds = Math.max(1, Math.round(pendingMinutes * 60));

  return {
    backend: cfg ? 'redis' : 'memory',

    /**
     * Atomically claim a conversion ID with the short pending TTL. Returns
     * true when this call claimed it (first delivery), false when already
     * claimed or finalized.
     */
    async markProcessed(key) {
      if (cfg) {
        const result = await redisCommand(cfg, ['SET', key, new Date().toISOString(), 'NX', 'EX', String(pendingTtlSeconds)]);
        return result === 'OK';
      }
      const now = Date.now();
      sweepMemory(now);
      const existing = memory.get(key);
      if (existing && existing > now) return false;
      memory.set(key, now + pendingTtlSeconds * 1000);
      return true;
    },

    /** Extend a claim to the durable long TTL after successful processing. */
    async finalize(key) {
      if (cfg) {
        await redisCommand(cfg, ['SET', key, new Date().toISOString(), 'XX', 'EX', String(finalTtlSeconds)]);
        return;
      }
      if (memory.has(key)) memory.set(key, Date.now() + finalTtlSeconds * 1000);
    },

    /** Release a claim so Tapfiliate's retry can reprocess after a handled failure. */
    async release(key) {
      if (cfg) {
        await redisCommand(cfg, ['DEL', key]);
        return;
      }
      memory.delete(key);
    },
  };
}

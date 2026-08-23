/**
 * Idempotency store: remembers processed Tapfiliate conversion IDs so a
 * redelivered webhook (Tapfiliate retries on non-2xx, network blips, manual
 * replays) never processes the same conversion twice.
 *
 * Backend selection:
 *  1. Upstash Redis / Vercel KV over REST when configured
 *     (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN, or the Vercel KV
 *     aliases KV_REST_API_URL + KV_REST_API_TOKEN). This is the durable,
 *     production-grade option and survives cold starts.
 *  2. In-memory fallback otherwise: best-effort within a warm serverless
 *     instance. Even without Redis the overall system stays safe because the
 *     handler recomputes monthly volume from Tapfiliate on every event and
 *     only moves an affiliate when the group actually differs — reprocessing
 *     a conversion is a no-op, never a double-move.
 *
 * `markProcessed` uses SET NX so exactly one concurrent delivery wins.
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
  const ttlSeconds = Math.max(1, Math.round(ttlDays * 24 * 60 * 60));

  return {
    backend: cfg ? 'redis' : 'memory',

    /**
     * Atomically claim a conversion ID. Returns true when this call claimed
     * it (first delivery), false when it was already processed.
     */
    async markProcessed(key) {
      if (cfg) {
        const result = await redisCommand(cfg, ['SET', key, new Date().toISOString(), 'NX', 'EX', String(ttlSeconds)]);
        return result === 'OK';
      }
      const now = Date.now();
      sweepMemory(now);
      const existing = memory.get(key);
      if (existing && existing > now) return false;
      memory.set(key, now + ttlSeconds * 1000);
      return true;
    },

    /** Release a claim so Tapfiliate's retry can reprocess after a mid-flight failure. */
    async release(key) {
      if (cfg) {
        await redisCommand(cfg, ['DEL', key]);
        return;
      }
      memory.delete(key);
    },
  };
}

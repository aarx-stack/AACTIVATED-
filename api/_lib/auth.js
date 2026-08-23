/**
 * Webhook request authentication. Two supported mechanisms, either of which
 * grants access (both are checked when both are configured — passing one is
 * enough, so you can roll from token auth to HMAC without downtime):
 *
 *  1. Shared token: the webhook URL registered in Tapfiliate's trigger
 *     carries ?token=<WEBHOOK_TOKEN> (or the request sends X-Webhook-Token,
 *     e.g. from a "Webhook (custom)" trigger header). This is the primary
 *     mechanism — Tapfiliate does not sign its trigger webhooks.
 *  2. HMAC signature (optional, for setups where a fronting proxy signs the
 *     raw body with HMAC-SHA256): configure the secret as
 *     TAPFILIATE_WEBHOOK_SECRET; accepted headers are X-Tapfiliate-Hmac,
 *     X-Tapfiliate-Hmac-Sha256, or X-Hub-Signature-256, with base64 or hex
 *     (optionally "sha256="-prefixed) digests.
 *
 * All comparisons are constant-time.
 */

import crypto from 'node:crypto';

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Compare against self to keep timing uniform, then fail.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function verifyToken(req, expectedToken) {
  if (!expectedToken) return false;
  const url = new URL(req.url || '/', 'http://localhost');
  const provided = url.searchParams.get('token') || req.headers['x-webhook-token'] || '';
  return safeEqual(provided, expectedToken);
}

export function verifyHmac(rawBody, req, secret) {
  if (!secret) return false;
  const header =
    req.headers['x-tapfiliate-hmac'] ||
    req.headers['x-tapfiliate-hmac-sha256'] ||
    req.headers['x-hub-signature-256'] ||
    '';
  if (!header) return false;

  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest();
  const candidates = [
    digest.toString('base64'),
    digest.toString('hex'),
    `sha256=${digest.toString('hex')}`,
  ];
  const provided = String(header).trim();
  return candidates.some((c) => safeEqual(provided, c));
}

/**
 * Returns { ok, method } — ok=true when at least one configured mechanism
 * passes. With nothing configured this always fails (fail closed).
 */
export function authenticate(req, rawBody, cfg) {
  if (cfg.webhookToken && verifyToken(req, cfg.webhookToken)) {
    return { ok: true, method: 'token' };
  }
  if (cfg.webhookHmacSecret && verifyHmac(rawBody, req, cfg.webhookHmacSecret)) {
    return { ok: true, method: 'hmac' };
  }
  return { ok: false, method: null };
}

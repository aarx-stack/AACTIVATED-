import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { authenticate, verifyHmac, verifyToken } from '../api/_lib/auth.js';
import { createIdempotencyStore } from '../api/_lib/idempotency.js';
import { loadConfig, validateConfig } from '../api/_lib/config.js';

function fakeReq(url, headers = {}) {
  return { url, headers };
}

test('token auth: query param and header, constant-time', () => {
  const cfg = { webhookToken: 's3cret-token', webhookHmacSecret: '' };
  assert.ok(authenticate(fakeReq('/api/tapfiliate-webhook?token=s3cret-token'), '', cfg).ok);
  assert.ok(authenticate(fakeReq('/api/x', { 'x-webhook-token': 's3cret-token' }), '', cfg).ok);
  assert.ok(!authenticate(fakeReq('/api/x?token=wrong'), '', cfg).ok);
  assert.ok(!authenticate(fakeReq('/api/x'), '', cfg).ok);
  assert.ok(!verifyToken(fakeReq('/api/x?token='), 's3cret-token'));
});

test('hmac auth: base64 and hex digests over raw body', () => {
  const secret = 'whsec_123';
  const body = '{"event":"conversion.created"}';
  const digest = crypto.createHmac('sha256', secret).update(body).digest();

  assert.ok(verifyHmac(body, fakeReq('/', { 'x-tapfiliate-hmac': digest.toString('base64') }), secret));
  assert.ok(verifyHmac(body, fakeReq('/', { 'x-tapfiliate-hmac-sha256': digest.toString('hex') }), secret));
  assert.ok(!verifyHmac(body, fakeReq('/', { 'x-tapfiliate-hmac': 'bogus' }), secret));
  assert.ok(!verifyHmac('tampered' + body, fakeReq('/', { 'x-tapfiliate-hmac': digest.toString('base64') }), secret));
  assert.ok(!verifyHmac(body, fakeReq('/', {}), secret));
});

test('auth fails closed when nothing is configured', () => {
  const cfg = { webhookToken: '', webhookHmacSecret: '' };
  assert.ok(!authenticate(fakeReq('/api/x?token=anything'), '', cfg).ok);
});

test('idempotency memory fallback claims each key exactly once', async () => {
  const store = createIdempotencyStore({});
  assert.equal(store.backend, 'memory');
  const key = `tapfiliate:conv:${Math.random()}`;
  assert.equal(await store.markProcessed(key), true);
  assert.equal(await store.markProcessed(key), false);
  await store.release(key);
  assert.equal(await store.markProcessed(key), true);
});

test('idempotency pending claims expire; finalize makes them durable', async () => {
  // Pending TTL of ~0 seconds: an unfinalized claim lapses almost immediately.
  const store = createIdempotencyStore({ IDEMPOTENCY_PENDING_TTL_MINUTES: '0.000001' });
  const key = `tapfiliate:conv:${Math.random()}`;
  assert.equal(await store.markProcessed(key), true);
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(await store.markProcessed(key), true, 'unfinalized claim should have expired');

  // Finalized claims stick around for the long TTL.
  await store.finalize(key);
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(await store.markProcessed(key), false, 'finalized claim must persist');
});

test('config defaults: DRY_RUN true, pending counts, protected keywords present', () => {
  const cfg = loadConfig({ TAPFILIATE_API_KEY: 'k', WEBHOOK_TOKEN: 't' });
  assert.equal(cfg.dryRun, true);
  assert.equal(cfg.countPending, true);
  assert.deepEqual(cfg.protectedKeywords, ['competitive', 'elevate', 'strategic']);
  assert.equal(cfg.timeZone, 'UTC');
  assert.deepEqual(validateConfig(cfg), []);
});

test('config validation catches missing secrets', () => {
  const problems = validateConfig(loadConfig({}));
  assert.equal(problems.length, 2);
  const cfgExplicitOff = loadConfig({ TAPFILIATE_API_KEY: 'k', WEBHOOK_TOKEN: 't', DRY_RUN: 'false' });
  assert.equal(cfgExplicitOff.dryRun, false);
  const cfgOn = loadConfig({ TAPFILIATE_API_KEY: 'k', WEBHOOK_TOKEN: 't', DRY_RUN: 'TRUE' });
  assert.equal(cfgOn.dryRun, true);
});

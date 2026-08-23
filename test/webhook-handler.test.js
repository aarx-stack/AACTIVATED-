import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import handler, { extractConversionEvent, resolveGroups, __resetGroupCacheForTests } from '../api/tapfiliate-webhook.js';
import { __resetWriteStyleForTests } from '../api/_lib/tapfiliate.js';
import { loadConfig } from '../api/_lib/config.js';

// ---------------------------------------------------------------------------
// Fixtures: a realistic slice of the AACTIVATED RX Tapfiliate account.
// ---------------------------------------------------------------------------

const GROUPS = [
  { id: 101, title: 'Standard 15%' },
  { id: 102, title: 'Starter 20%' },
  { id: 103, title: 'Builder 25%' },
  { id: 104, title: 'Pro 30%' },
  { id: 105, title: 'Elite 35%' },
  { id: 201, title: 'Competitive 40%' },
  { id: 202, title: 'Elevate 45%' },
  { id: 203, title: 'Strategic Partner 50%' },
  { id: 300, title: 'VIP Legacy' },
];

function commission(approved) {
  return { id: Math.floor(Math.random() * 1e6), approved, amount: 10, kind: 'regular' };
}

const NOW_MONTH = new Date().toISOString().slice(0, 7); // tests run "this month" in UTC

function fixtureState() {
  return {
    affiliate: { id: 'player1name', affiliate_group_id: null },
    conversions: [
      { id: 1, amount: 800, created_at: `${NOW_MONTH}-05T12:00:00+00:00`, commissions: [commission(true)] },
      { id: 2, amount: 700, created_at: `${NOW_MONTH}-10T12:00:00+00:00`, commissions: [commission(null)] },
      { id: 3, amount: 9999, created_at: `${NOW_MONTH}-11T12:00:00+00:00`, commissions: [commission(false)] }, // refunded
    ],
    writes: [],
    rejectedWrites: 0,
    failAffiliateFetch: false,
    // Which PUT /affiliates/{id}/group/ body shape the fake API accepts:
    // 'group_id' | 'group_obj' | 'group_flat' | 'query' | 'none' | 'silent_noop'
    acceptWriteShape: 'group_id',
  };
}

let state = fixtureState();

function installMockFetch() {
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const method = opts.method || 'GET';
    const respond = (status, body) => ({
      ok: status >= 200 && status < 300,
      status,
      headers: new Map(),
      text: async () => JSON.stringify(body),
    });

    if (method === 'PUT' && /\/affiliates\/[^/]+\/group\/$/.test(u.pathname)) {
      const body = opts.body ? JSON.parse(opts.body) : null;
      const shape = u.searchParams.has('group_id')
        ? 'query'
        : body && 'group_id' in body
          ? 'group_id'
          : body && typeof body.group === 'object' && body.group !== null
            ? 'group_obj'
            : body && typeof body.group === 'string'
              ? 'group_flat'
              : 'unknown';
      if (state.acceptWriteShape === 'silent_noop') {
        // Pathological API: returns 2xx but never applies the change.
        return respond(200, { ok: true });
      }
      if (shape !== state.acceptWriteShape) {
        state.rejectedWrites += 1;
        return respond(400, { message: 'invalid payload' });
      }
      const gid =
        shape === 'query'
          ? u.searchParams.get('group_id')
          : shape === 'group_id'
            ? body.group_id
            : shape === 'group_obj'
              ? body.group.id
              : body.group;
      state.affiliate = { ...state.affiliate, affiliate_group_id: gid };
      state.writes.push({ method, path: u.pathname, shape, groupId: String(gid) });
      return respond(200, state.affiliate);
    }
    if (method === 'GET' && /\/affiliates\/[^/]+\/$/.test(u.pathname)) {
      if (state.failAffiliateFetch) return respond(500, { error: 'boom' });
      return respond(200, state.affiliate);
    }
    if (method === 'GET' && u.pathname.endsWith('/affiliate-groups/')) {
      const page = Number(u.searchParams.get('page') || 1);
      return respond(200, page === 1 ? GROUPS : []);
    }
    if (method === 'GET' && u.pathname.endsWith('/conversions/')) {
      const page = Number(u.searchParams.get('page') || 1);
      return respond(200, page === 1 ? state.conversions : []);
    }
    if (method === 'GET' && /\/conversions\/[^/]+\/$/.test(u.pathname)) {
      return respond(200, state.conversions[0]);
    }
    return respond(404, { error: `unmocked ${method} ${u.pathname}` });
  };
}

function makeReq({ body, token = 'test-token', method = 'POST', headers = {}, tokenInUrl = true }) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body ?? {});
  const url = tokenInUrl && token ? `/api/tapfiliate-webhook?token=${token}` : '/api/tapfiliate-webhook';
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      if (method === 'POST') yield Buffer.from(raw);
    },
  };
}

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
  };
  return res;
}

function webhookBody(conversionId, overrides = {}) {
  return {
    event: 'conversion.created',
    data: {
      id: conversionId,
      amount: 800,
      affiliate: { id: 'player1name', firstname: 'Player1' },
      program: { id: 'aactivatedrx', currency: 'USD' },
      ...overrides,
    },
  };
}

let convCounter = 1000;
const nextConvId = () => ++convCounter;

const BASE_ENV = {
  TAPFILIATE_API_KEY: 'test-api-key',
  WEBHOOK_TOKEN: 'test-token',
};

function setEnv(extra = {}) {
  for (const key of Object.keys(process.env)) {
    if (/^(TAPFILIATE|WEBHOOK|DRY_RUN|TIER|COUNT_PENDING|PROTECTED|ASSIGN_UNGROUPED|IDEMPOTENCY|UPSTASH|KV_)/.test(key)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, BASE_ENV, extra);
}

beforeEach(() => {
  state = fixtureState();
  installMockFetch();
  __resetGroupCacheForTests();
  __resetWriteStyleForTests();
  setEnv();
});

// ---------------------------------------------------------------------------

test('rejects requests without the webhook token', async () => {
  const res = makeRes();
  await handler(makeReq({ body: webhookBody(nextConvId()), token: null, tokenInUrl: false }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(state.writes.length, 0);
});

test('accepts HMAC-signed requests without a token', async () => {
  setEnv({ WEBHOOK_TOKEN: '', TAPFILIATE_WEBHOOK_SECRET: 'sig-secret' });
  const body = JSON.stringify(webhookBody(nextConvId()));
  const sig = crypto.createHmac('sha256', 'sig-secret').update(body).digest('base64');
  const res = makeRes();
  await handler(makeReq({ body, tokenInUrl: false, headers: { 'x-tapfiliate-hmac': sig } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'processed');
});

test('GET is a harmless health check; other methods are 405', async () => {
  const resGet = makeRes();
  await handler(makeReq({ method: 'GET', tokenInUrl: false }), resGet);
  assert.equal(resGet.statusCode, 200);

  const resDel = makeRes();
  await handler(makeReq({ method: 'DELETE', tokenInUrl: false }), resDel);
  assert.equal(resDel.statusCode, 405);
});

test('500 misconfigured when no API key / no auth secret configured', async () => {
  setEnv({ TAPFILIATE_API_KEY: '', WEBHOOK_TOKEN: '' });
  const res = makeRes();
  await handler(makeReq({ body: webhookBody(nextConvId()), tokenInUrl: false }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, 'misconfigured');
});

test('bad JSON is rejected with 400', async () => {
  const res = makeRes();
  await handler(makeReq({ body: '{not json' }), res);
  assert.equal(res.statusCode, 400);
});

test('non-conversion events are acknowledged and ignored', async () => {
  const res = makeRes();
  await handler(makeReq({ body: { event: 'affiliate.created', data: { id: 'x' } } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'ignored');
});

test('DRY_RUN (default): computes tier but performs no write', async () => {
  const res = makeRes();
  await handler(makeReq({ body: webhookBody(nextConvId()) }), res);
  assert.equal(res.statusCode, 200);
  // $800 approved + $700 pending = $1,500 qualifying (refunded $9,999 excluded) -> Starter
  assert.equal(res.body.monthly_qualifying_sales_usd, '1500.00');
  assert.equal(res.body.calculated_group.title, 'Starter 20%');
  assert.equal(res.body.action, 'dry_run_would_move');
  assert.equal(res.body.dry_run, true);
  assert.equal(state.writes.length, 0);
});

test('refunded/disapproved conversions never count toward the tier', async () => {
  state.conversions.push({
    id: 4,
    amount: 20000,
    created_at: `${NOW_MONTH}-12T12:00:00+00:00`,
    commissions: [commission(false), commission(false)],
  });
  const res = makeRes();
  await handler(makeReq({ body: webhookBody(nextConvId()) }), res);
  assert.equal(res.body.monthly_qualifying_sales_usd, '1500.00'); // still Starter, not Elite
  assert.equal(res.body.calculated_group.title, 'Starter 20%');
});

test('COUNT_PENDING_COMMISSIONS=false counts only approved sales', async () => {
  setEnv({ COUNT_PENDING_COMMISSIONS: 'false' });
  const res = makeRes();
  await handler(makeReq({ body: webhookBody(nextConvId()) }), res);
  assert.equal(res.body.monthly_qualifying_sales_usd, '800.00'); // pending $700 excluded
  assert.equal(res.body.calculated_group.title, 'Standard 15%');
});

test('live mode moves the affiliate with exactly one verified write', async () => {
  setEnv({ DRY_RUN: 'false' });
  const res = makeRes();
  await handler(makeReq({ body: webhookBody(nextConvId()) }), res);
  assert.equal(res.body.action, 'moved');
  assert.equal(state.writes.length, 1);
  assert.deepEqual(state.writes[0], {
    method: 'PUT',
    path: '/1.6/affiliates/player1name/group/',
    shape: 'group_id',
    groupId: '102',
  });
  // The write was verified: the fake affiliate now carries the new group.
  assert.equal(state.affiliate.affiliate_group_id, '102');
});

test('write falls back across documented body shapes until one verifies', async () => {
  setEnv({ DRY_RUN: 'false' });
  state.acceptWriteShape = 'group_obj'; // API only accepts the nested shape
  const res = makeRes();
  await handler(makeReq({ body: webhookBody(nextConvId()) }), res);
  assert.equal(res.body.action, 'moved');
  assert.equal(state.writes.length, 1);
  assert.equal(state.writes[0].shape, 'group_obj');
  assert.equal(state.rejectedWrites, 1); // group_id shape was tried first and rejected

  // The working shape is remembered: the next move skips the probe.
  state.affiliate = { ...state.affiliate, affiliate_group_id: 105 };
  const res2 = makeRes();
  await handler(makeReq({ body: webhookBody(nextConvId()) }), res2);
  assert.equal(res2.body.action, 'moved');
  assert.equal(state.writes.length, 2);
  assert.equal(state.writes[1].shape, 'group_obj');
  assert.equal(state.rejectedWrites, 1); // no new rejections
});

test('query-param body shape also works when it is the accepted one', async () => {
  setEnv({ DRY_RUN: 'false' });
  state.acceptWriteShape = 'query';
  const res = makeRes();
  await handler(makeReq({ body: webhookBody(nextConvId()) }), res);
  assert.equal(res.body.action, 'moved');
  assert.equal(state.writes[0].shape, 'query');
  assert.equal(state.writes[0].groupId, '102');
});

test('all write shapes rejected -> 500 and idempotency released for retry', async () => {
  setEnv({ DRY_RUN: 'false' });
  state.acceptWriteShape = 'none';
  const res = makeRes();
  await handler(makeReq({ body: webhookBody(nextConvId()) }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(state.writes.length, 0);
  assert.equal(state.rejectedWrites, 4); // every documented shape was probed
});

test('a 2xx that does not actually change the group is treated as failure', async () => {
  setEnv({ DRY_RUN: 'false' });
  state.acceptWriteShape = 'silent_noop';
  const res = makeRes();
  await handler(makeReq({ body: webhookBody(nextConvId()) }), res);
  assert.equal(res.statusCode, 500); // read-back verification refused the fake success
  assert.equal(state.writes.length, 0);
  assert.equal(state.affiliate.affiliate_group_id, null);
});

test('duplicate conversion delivery is skipped', async () => {
  setEnv({ DRY_RUN: 'false' });
  const convId = nextConvId();
  const res1 = makeRes();
  await handler(makeReq({ body: webhookBody(convId) }), res1);
  assert.equal(res1.body.action, 'moved');

  const res2 = makeRes();
  await handler(makeReq({ body: webhookBody(convId) }), res2);
  assert.equal(res2.statusCode, 200);
  assert.equal(res2.body.status, 'duplicate');
  assert.equal(state.writes.length, 1); // no second write
});

test('protected B2B groups are never touched, even live', async () => {
  setEnv({ DRY_RUN: 'false' });
  for (const groupId of [201, 202, 203]) {
    state.affiliate.affiliate_group_id = groupId;
    const res = makeRes();
    await handler(makeReq({ body: webhookBody(nextConvId()) }), res);
    assert.equal(res.body.action, 'skipped_protected_group', `group ${groupId}`);
  }
  assert.equal(state.writes.length, 0);
});

test('unknown non-tier group is left alone', async () => {
  setEnv({ DRY_RUN: 'false' });
  state.affiliate.affiliate_group_id = 300; // "VIP Legacy"
  const res = makeRes();
  await handler(makeReq({ body: webhookBody(nextConvId()) }), res);
  assert.equal(res.body.action, 'skipped_non_tier_group');
  assert.equal(state.writes.length, 0);
});

test('affiliate already in the correct group: no write', async () => {
  setEnv({ DRY_RUN: 'false' });
  state.affiliate.affiliate_group_id = 102; // already Starter
  const res = makeRes();
  await handler(makeReq({ body: webhookBody(nextConvId()) }), res);
  assert.equal(res.body.action, 'no_change_needed');
  assert.equal(state.writes.length, 0);
});

test('downgrade also works: Elite affiliate with low volume moves down', async () => {
  setEnv({ DRY_RUN: 'false' });
  state.affiliate.affiliate_group_id = 105; // Elite
  const res = makeRes();
  await handler(makeReq({ body: webhookBody(nextConvId()) }), res);
  assert.equal(res.body.action, 'moved');
  assert.equal(state.writes[0].groupId, '102'); // down to Starter
});

test('Tapfiliate API failure returns 500 and releases idempotency for retry', async () => {
  setEnv({ DRY_RUN: 'false' });
  const convId = nextConvId();
  state.failAffiliateFetch = true;
  const res1 = makeRes();
  await handler(makeReq({ body: webhookBody(convId) }), res1);
  assert.equal(res1.statusCode, 500);

  state.failAffiliateFetch = false;
  const res2 = makeRes();
  await handler(makeReq({ body: webhookBody(convId) }), res2);
  assert.equal(res2.statusCode, 200);
  assert.equal(res2.body.action, 'moved'); // retry succeeded, not treated as duplicate
});

test('payload without envelope (bare conversion object) still works', async () => {
  const res = makeRes();
  await handler(makeReq({ body: webhookBody(nextConvId()).data }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'processed');
});

// ---------------------------------------------------------------------------

test('extractConversionEvent handles envelope, bare, and junk payloads', () => {
  assert.equal(extractConversionEvent(null).ok, false);
  assert.equal(extractConversionEvent({}).ok, false);
  assert.equal(extractConversionEvent({ event: 'affiliate.created', data: { id: 1 } }).reason, 'ignored_event_type');
  const enveloped = extractConversionEvent({ event: 'conversion.created', data: { id: 42, affiliate: { id: 'a1' } } });
  assert.deepEqual([enveloped.ok, enveloped.conversionId, enveloped.affiliateId], [true, '42', 'a1']);
  const bare = extractConversionEvent({ id: 43, affiliate: { id: 'a2' }, amount: 10 });
  assert.deepEqual([bare.ok, bare.conversionId, bare.affiliateId], [true, '43', 'a2']);
});

test('resolveGroups maps tiers, protects B2B groups, honors ID overrides', () => {
  const cfg = loadConfig({ ...BASE_ENV, TIER_GROUP_ID_ELITE: '300' });
  const { tierGroups, protectedIds } = resolveGroups(GROUPS, cfg);
  assert.equal(tierGroups.standard.id, 101);
  assert.equal(tierGroups.elite.id, 300); // override wins over "Elite 35%"
  assert.deepEqual([...protectedIds].sort(), ['201', '202', '203']);
});

test('an override pointing at a protected group is ignored (protection wins)', () => {
  const cfg = loadConfig({ ...BASE_ENV, TIER_GROUP_ID_ELITE: '201' }); // Competitive 40%
  const { tierGroups, protectedIds } = resolveGroups(GROUPS, cfg);
  assert.equal(tierGroups.elite.id, 105); // falls back to name-matched "Elite 35%"
  assert.ok(protectedIds.has('201'));
});

test('groups exposing `name` instead of `title` still resolve', () => {
  const cfg = loadConfig(BASE_ENV);
  const named = [
    { id: 'ag_1', name: 'Standard 15%' },
    { id: 'ag_2', name: 'Strategic Partner 50%' },
  ];
  const { tierGroups, protectedIds } = resolveGroups(named, cfg);
  assert.equal(tierGroups.standard.id, 'ag_1');
  assert.ok(protectedIds.has('ag_2'));
});

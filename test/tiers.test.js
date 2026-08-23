import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIERS,
  toCents,
  tierForVolumeCents,
  tierKeyForGroupTitle,
  isProtectedGroupTitle,
  sumQualifyingVolumeCents,
} from '../api/_lib/tiers.js';

test('tier boundaries land exactly per the AACTIVATED RX ladder', () => {
  const cases = [
    [0, 'standard'],
    [999.99, 'standard'],
    [1000.0, 'starter'],
    [2499.99, 'starter'],
    [2500.0, 'builder'],
    [4999.99, 'builder'],
    [5000.0, 'pro'],
    [9999.99, 'pro'],
    [10000.0, 'elite'],
    [250000, 'elite'],
  ];
  for (const [dollars, expected] of cases) {
    assert.equal(tierForVolumeCents(toCents(dollars)).key, expected, `$${dollars}`);
  }
});

test('negative or garbage volume clamps to standard', () => {
  assert.equal(tierForVolumeCents(-500).key, 'standard');
  assert.equal(toCents('not a number'), 0);
  assert.equal(toCents(null), 0);
});

test('float sums do not drift at boundaries', () => {
  // 10 x $99.999... style floats that would misbehave with naive float sums
  const cents = [...Array(10)].reduce((acc) => acc + toCents(100.0), 0);
  assert.equal(cents, 100_000);
  assert.equal(tierForVolumeCents(cents).key, 'starter');
});

test('group titles map to tier keys by exact word', () => {
  assert.equal(tierKeyForGroupTitle('Standard 15%'), 'standard');
  assert.equal(tierKeyForGroupTitle('Starter 20%'), 'starter');
  assert.equal(tierKeyForGroupTitle('Builder 25%'), 'builder');
  assert.equal(tierKeyForGroupTitle('Pro 30%'), 'pro');
  assert.equal(tierKeyForGroupTitle('Elite 35%'), 'elite');
  assert.equal(tierKeyForGroupTitle('ELITE'), 'elite');
  // Protected / unknown groups do not map to a tier
  assert.equal(tierKeyForGroupTitle('Strategic Partner 50%'), null);
  assert.equal(tierKeyForGroupTitle('Competitive 40%'), null);
  assert.equal(tierKeyForGroupTitle('Elevate 45%'), null);
  // "Elevate" must not fuzzy-match "elite", "Partner" must not match "pro"
  assert.equal(tierKeyForGroupTitle('Professional'), null);
});

test('protected group detection', () => {
  assert.ok(isProtectedGroupTitle('Competitive 40%'));
  assert.ok(isProtectedGroupTitle('Elevate 45%'));
  assert.ok(isProtectedGroupTitle('Strategic Partner 50%'));
  assert.ok(!isProtectedGroupTitle('Standard 15%'));
  assert.ok(!isProtectedGroupTitle('Elite 35%'));
});

test('tier ladder is sorted ascending and complete', () => {
  const mins = TIERS.map((t) => t.minCents);
  assert.deepEqual(mins, [...mins].sort((a, b) => a - b));
  assert.equal(TIERS.length, 5);
});

function conv(id, amount, approvals, createdAt = '2026-08-10T12:00:00+00:00') {
  return {
    id,
    amount,
    created_at: createdAt,
    commissions: approvals.map((a, i) => ({ id: id * 100 + i, approved: a, amount: 0 })),
  };
}

test('qualifying volume: approved and pending count, disapproved/refunded do not', () => {
  const conversions = [
    conv(1, 100.0, [true]),
    conv(2, 200.0, [null]), // pending
    conv(3, 300.0, [false]), // disapproved (refund) — excluded
    conv(4, 400.0, [false, true]), // partially approved — counts
    conv(5, 50.5, []), // no commissions yet — treated as pending
  ];
  const { totalCents, skipped } = sumQualifyingVolumeCents(conversions, { countPending: true });
  assert.equal(totalCents, toCents(100 + 200 + 400 + 50.5));
  assert.deepEqual(skipped, [{ id: 3, reason: 'disapproved_or_refunded' }]);
});

test('qualifying volume with countPending=false only counts approved', () => {
  const conversions = [
    conv(1, 100.0, [true]),
    conv(2, 200.0, [null]),
    conv(3, 300.0, [false]),
    conv(5, 50.5, []),
  ];
  const { totalCents } = sumQualifyingVolumeCents(conversions, { countPending: false });
  assert.equal(totalCents, toCents(100));
});

test('qualifying volume respects the month filter', () => {
  const conversions = [
    conv(1, 100.0, [true], '2026-08-01T00:00:00+00:00'),
    conv(2, 200.0, [true], '2026-07-31T23:59:59+00:00'),
  ];
  const inMonth = (c) => String(c.created_at).startsWith('2026-08');
  const { totalCents, skipped } = sumQualifyingVolumeCents(conversions, { inMonth });
  assert.equal(totalCents, toCents(100));
  assert.deepEqual(skipped, [{ id: 2, reason: 'outside_month' }]);
});

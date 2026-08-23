import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentMonthWindow, makeInMonth, yearMonthInZone } from '../api/_lib/month.js';

test('current month window in UTC', () => {
  const now = new Date('2026-08-23T10:00:00Z');
  const w = currentMonthWindow(now, 'UTC');
  assert.equal(w.yearMonth, '2026-08');
  // Padded one day each side for timezone skew
  assert.equal(w.dateFrom, '2026-07-31');
  assert.equal(w.dateTo, '2026-09-01');
});

test('month boundary respects timezone', () => {
  // 2026-09-01T02:00 UTC is still Aug 31 in Los Angeles
  const now = new Date('2026-09-01T02:00:00Z');
  assert.equal(currentMonthWindow(now, 'UTC').yearMonth, '2026-09');
  assert.equal(currentMonthWindow(now, 'America/Los_Angeles').yearMonth, '2026-08');
});

test('makeInMonth filters conversions by timezone-local month', () => {
  const inAugustLA = makeInMonth('2026-08', 'America/Los_Angeles');
  // 2026-08-01T05:00 UTC is July 31 22:00 in LA -> excluded
  assert.ok(!inAugustLA({ created_at: '2026-08-01T05:00:00+00:00' }));
  // 2026-09-01T05:00 UTC is Aug 31 22:00 in LA -> included
  assert.ok(inAugustLA({ created_at: '2026-09-01T05:00:00+00:00' }));
  assert.ok(inAugustLA({ created_at: '2026-08-15T12:00:00+00:00' }));
  assert.ok(!inAugustLA({ created_at: null }));
  assert.ok(!inAugustLA({ created_at: 'garbage' }));
});

test('yearMonthInZone formats correctly', () => {
  assert.equal(yearMonthInZone(new Date('2026-01-05T00:00:00Z'), 'UTC'), '2026-01');
  assert.equal(yearMonthInZone(new Date('2026-12-31T23:00:00Z'), 'Pacific/Auckland'), '2027-01');
});

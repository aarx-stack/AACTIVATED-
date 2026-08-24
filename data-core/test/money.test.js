import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  add,
  compare,
  divide,
  multiply,
  multiplyByInt,
  negate,
  roundToCents,
  subtract,
  sum,
  toDecimalString,
  toMicros,
} from '../src/money.js';

test('money: parses and formats exactly at 6dp', () => {
  assert.equal(toDecimalString(toMicros('14.85225')), '14.852250');
  assert.equal(toDecimalString(toMicros('0.15')), '0.150000');
  assert.equal(toDecimalString(toMicros('-3.5')), '-3.500000');
  assert.equal(toDecimalString(toMicros('129')), '129.000000');
});

test('money: refuses floating point numbers outright', () => {
  assert.throws(() => toMicros(0.1), /refusing JavaScript number/);
  assert.throws(() => toMicros(129.15), /refusing JavaScript number/);
});

test('money: refuses malformed and over-precise input', () => {
  assert.throws(() => toMicros('12.3456789')); // 7dp
  assert.throws(() => toMicros('12,50'));
  assert.throws(() => toMicros('abc'));
  assert.throws(() => toMicros(''));
});

test('money: classic float traps are exact here', () => {
  // 0.1 + 0.2 === 0.30000000000000004 in floats; must be exactly 0.3 here.
  assert.equal(toDecimalString(add('0.1', '0.2')), '0.300000');
  // 1.1 * 3 in floats is 3.3000000000000003
  assert.equal(toDecimalString(multiplyByInt('1.1', 3)), '3.300000');
});

test('money: add/subtract/negate/compare', () => {
  assert.equal(toDecimalString(subtract('100', '0.01')), '99.990000');
  assert.equal(toDecimalString(negate('12.5')), '-12.500000');
  assert.equal(compare('1.000001', '1.000000'), 1);
  assert.equal(compare('1.000000', '1.000000'), 0);
  assert.equal(compare('0.999999', '1.000000'), -1);
});

test('money: multiply applies half-up rounding at 6dp', () => {
  // 12.915 * 0.15 = 1.93725 exactly (no rounding needed)
  assert.equal(toDecimalString(multiply('12.915', '0.15')), '1.937250');
  // 0.000001 * 0.5 = 0.0000005 -> rounds half up to 0.000001
  assert.equal(toDecimalString(multiply('0.000001', '0.5')), '0.000001');
  // symmetric for negatives: -0.0000005 -> -0.000001
  assert.equal(toDecimalString(multiply('-0.000001', '0.5')), '-0.000001');
});

test('money: divide is exact when possible, half-up otherwise', () => {
  assert.equal(toDecimalString(divide('129.15', '10')), '12.915000');
  assert.equal(toDecimalString(divide('10', '3')), '3.333333');
  assert.equal(toDecimalString(divide('20', '3')), '6.666667'); // half-up
  assert.throws(() => divide('1', '0'), /division by zero/);
});

test('money: sum over decimal strings', () => {
  assert.equal(toDecimalString(sum(['0.1', '0.2', '0.3'])), '0.600000');
  assert.equal(toDecimalString(sum([])), '0.000000');
});

test('money: roundToCents half-up at 2dp', () => {
  assert.equal(toDecimalString(roundToCents('14.852250')), '14.850000');
  assert.equal(toDecimalString(roundToCents('14.855000')), '14.860000');
  assert.equal(toDecimalString(roundToCents('-14.855000')), '-14.860000');
});

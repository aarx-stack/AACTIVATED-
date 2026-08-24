/**
 * Exact decimal arithmetic for money and rates.
 *
 * Every value is a BigInt of MICROS — the amount scaled by 10^6, matching the
 * numeric(18,6) columns in the schema. JavaScript numbers (IEEE-754 floats) are
 * REJECTED at the boundary: passing one throws, so floating point can never
 * leak into a financial calculation.
 *
 * Values travel as strings ("14.852250") between the database (node-postgres
 * returns numeric as string) and this module; BigInt math happens in between.
 *
 * Rounding policy: ROUND HALF UP at 6 decimal places, applied only where an
 * operation cannot be exact (multiplication/division remainders). Documented in
 * docs/FINANCIAL_MODEL.md.
 */

export const SCALE = 6;
export const ONE = 10n ** BigInt(SCALE); // 1_000_000n == 1.000000

const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d{1,6}))?$/;

/**
 * Parse a decimal string (or pass through a BigInt in micros) to micros.
 * Rejects: numbers (floats), >6 decimal places, malformed strings.
 * @param {string | bigint} value
 * @returns {bigint} micros
 */
export function toMicros(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    throw new TypeError(
      `money: refusing JavaScript number ${value} — pass a decimal string to keep arithmetic exact`
    );
  }
  if (typeof value !== 'string') {
    throw new TypeError(`money: cannot parse ${typeof value}`);
  }
  const m = DECIMAL_RE.exec(value.trim());
  if (!m) {
    throw new TypeError(
      `money: "${value}" is not a decimal with at most ${SCALE} decimal places`
    );
  }
  const [, sign, whole, frac = ''] = m;
  const micros = BigInt(whole) * ONE + BigInt(frac.padEnd(SCALE, '0'));
  return sign === '-' ? -micros : micros;
}

/**
 * Format micros back to a canonical fixed-point string with 6 decimals.
 * @param {bigint} micros
 * @returns {string} e.g. "14.852250"
 */
export function toDecimalString(micros) {
  const neg = micros < 0n;
  const abs = neg ? -micros : micros;
  const whole = abs / ONE;
  const frac = (abs % ONE).toString().padStart(SCALE, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

/** @param {string|bigint} a @param {string|bigint} b @returns {bigint} */
export function add(a, b) {
  return toMicros(a) + toMicros(b);
}

/** @param {string|bigint} a @param {string|bigint} b @returns {bigint} */
export function subtract(a, b) {
  return toMicros(a) - toMicros(b);
}

/**
 * Multiply two scaled values (e.g. an amount by a rate), half-up at 6dp.
 * (a_micros * b_micros) / 10^6 with symmetric half-up rounding.
 * @param {string|bigint} a @param {string|bigint} b @returns {bigint}
 */
export function multiply(a, b) {
  return divideRounded(toMicros(a) * toMicros(b), ONE);
}

/**
 * Divide a by b (both scaled), half-up at 6dp. b must be non-zero.
 * @param {string|bigint} a @param {string|bigint} b @returns {bigint}
 */
export function divide(a, b) {
  const bm = toMicros(b);
  if (bm === 0n) throw new RangeError('money: division by zero');
  return divideRounded(toMicros(a) * ONE, bm);
}

/**
 * Integer division with ROUND HALF UP (symmetric: -1.5 -> -2).
 * @param {bigint} numerator @param {bigint} denominator @returns {bigint}
 */
function divideRounded(numerator, denominator) {
  const negative = (numerator < 0n) !== (denominator < 0n);
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/**
 * Sum an iterable of decimal strings / micros.
 * @param {Iterable<string|bigint>} values @returns {bigint}
 */
export function sum(values) {
  let total = 0n;
  for (const v of values) total += toMicros(v);
  return total;
}

/** Multiply an amount by an integer quantity (exact). */
export function multiplyByInt(amount, quantity) {
  if (!Number.isInteger(quantity)) {
    throw new TypeError(`money: quantity must be an integer, got ${quantity}`);
  }
  return toMicros(amount) * BigInt(quantity);
}

/** Compare: -1, 0, 1. */
export function compare(a, b) {
  const am = toMicros(a);
  const bm = toMicros(b);
  return am < bm ? -1 : am > bm ? 1 : 0;
}

export function negate(a) {
  return -toMicros(a);
}

export function isZero(a) {
  return toMicros(a) === 0n;
}

/**
 * Round micros to 2 decimal places (cents), half up — for payout/display
 * boundaries only; internal storage stays at 6dp.
 * @param {string|bigint} a @returns {bigint} micros still at 6dp scale
 */
export function roundToCents(a) {
  const CENT = 10n ** BigInt(SCALE - 2); // 10_000n
  return divideRounded(toMicros(a), CENT) * CENT;
}

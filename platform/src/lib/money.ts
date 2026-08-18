// All money is handled as integer cents. Never use floating point on dollars.

/** Parse a decimal amount (number or string, in major units) into integer cents. */
export function toCents(amount: number | string | null | undefined): number {
  if (amount === null || amount === undefined || amount === '') return 0
  const str = typeof amount === 'number' ? amount.toFixed(4) : String(amount).trim()
  const negative = str.startsWith('-')
  const clean = str.replace(/^-/, '')
  if (!/^\d+(\.\d+)?$/.test(clean)) {
    throw new Error(`Invalid monetary amount: ${amount}`)
  }
  const [whole, frac = ''] = clean.split('.')
  const fracPadded = (frac + '000').slice(0, 3) // 3 digits for rounding
  let cents = BigInt(whole) * 100n + BigInt(fracPadded.slice(0, 2))
  if (Number(fracPadded[2]) >= 5) cents += 1n
  const result = Number(cents)
  if (!Number.isSafeInteger(result)) throw new Error(`Amount out of range: ${amount}`)
  return negative ? -result : result
}

/** Format integer cents as a decimal string, e.g. 19997 -> "199.97". */
export function centsToDecimal(cents: number): string {
  const negative = cents < 0
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100)
  const frac = String(abs % 100).padStart(2, '0')
  return `${negative ? '-' : ''}${whole}.${frac}`
}

/** Format integer cents for display, e.g. 19997 -> "$199.97". */
export function formatCents(cents: number, currency = 'USD'): string {
  const sign = cents < 0 ? '-' : ''
  const symbol = currency === 'USD' ? '$' : `${currency} `
  return `${sign}${symbol}${centsToDecimal(Math.abs(cents))}`
}

/**
 * Apply a basis-points rate to a cent amount with banker-safe rounding
 * (round half up on absolute value). 3000 bps = 30%.
 */
export function applyBps(cents: number, bps: number): number {
  const product = BigInt(cents) * BigInt(bps)
  const negative = product < 0n
  const abs = negative ? -product : product
  const rounded = (abs + 5000n) / 10000n
  return Number(negative ? -rounded : rounded)
}

/**
 * Proportionally allocate `part` of `total` applied to `amount`
 * (used for partial-refund reversals): amount * part / total.
 */
export function proRata(amount: number, part: number, total: number): number {
  if (total === 0) return 0
  const product = BigInt(amount) * BigInt(part)
  const negative = product < 0n
  const abs = negative ? -product : product
  const t = BigInt(Math.abs(total))
  const rounded = (abs + t / 2n) / t
  return Number(negative ? -rounded : rounded)
}

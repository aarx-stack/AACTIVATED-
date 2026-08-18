import { randomBytes } from 'crypto'

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789' // no confusing chars

export function randomToken(length: number): string {
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

/** Public click id, e.g. clk_8f29dj2x4k */
export function newClickId(): string {
  return `clk_${randomToken(10)}`
}

/** Referral code used in tracking links, e.g. ABC123-style. */
export function newReferralCode(): string {
  return randomToken(8).toUpperCase()
}

/** Public affiliate code, e.g. AFF-83HD92 */
export function newAffiliateCode(): string {
  return `AFF-${randomToken(6).toUpperCase()}`
}

/** Full API key. Shown once; only the SHA-256 hash is stored. */
export function newApiKey(mode: 'LIVE' | 'TEST'): string {
  const prefix = mode === 'TEST' ? 'test_sk_' : 'live_sk_'
  return `${prefix}${randomToken(32)}`
}

export function newSessionId(): string {
  return `ses_${randomToken(16)}`
}

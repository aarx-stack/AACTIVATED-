import { createHmac, createHash, timingSafeEqual, createCipheriv, createDecipheriv, randomBytes } from 'crypto'

/** SHA-256 hash used for API key storage (keys are high-entropy, no salt needed). */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/** HMAC-SHA256 signature over `${timestamp}.${body}`. */
export function signWebhook(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

const REPLAY_TOLERANCE_SECONDS = 300

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: string }

/**
 * Verify an inbound webhook: HMAC-SHA256 of `${timestamp}.${rawBody}`
 * with timestamp freshness (replay protection).
 */
export function verifyWebhookSignature(opts: {
  secret: string
  signature: string | null
  timestamp: string | null
  rawBody: string
  nowSeconds?: number
}): SignatureCheck {
  const { secret, signature, timestamp, rawBody } = opts
  if (!signature) return { ok: false, reason: 'missing_signature' }
  if (!timestamp) return { ok: false, reason: 'missing_timestamp' }
  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return { ok: false, reason: 'invalid_timestamp' }
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > REPLAY_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'timestamp_out_of_tolerance' }
  }
  const expected = signWebhook(secret, timestamp, rawBody)
  if (!safeEqual(expected, signature)) return { ok: false, reason: 'signature_mismatch' }
  return { ok: true }
}

// ── Symmetric encryption for stored secrets (webhook endpoint secrets) ──────

function encryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY ?? ''
  return createHash('sha256').update(raw).digest()
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}.${tag.toString('hex')}.${enc.toString('hex')}`
}

export function decryptSecret(stored: string): string {
  const [ivHex, tagHex, dataHex] = stored.split('.')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8')
}

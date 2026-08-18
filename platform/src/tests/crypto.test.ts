import { describe, it, expect } from 'vitest'
import { signWebhook, verifyWebhookSignature, hashApiKey, encryptSecret, decryptSecret } from '@/lib/crypto'

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'test-key'

describe('webhook signatures', () => {
  const secret = 'whsec_test'
  const body = '{"order_id":"ORDER-1"}'

  it('verifies a valid signature', () => {
    const ts = String(Math.floor(Date.now() / 1000))
    const sig = signWebhook(secret, ts, body)
    expect(verifyWebhookSignature({ secret, signature: sig, timestamp: ts, rawBody: body })).toEqual({ ok: true })
  })

  it('rejects a tampered body', () => {
    const ts = String(Math.floor(Date.now() / 1000))
    const sig = signWebhook(secret, ts, body)
    const result = verifyWebhookSignature({ secret, signature: sig, timestamp: ts, rawBody: body + 'x' })
    expect(result.ok).toBe(false)
  })

  it('rejects a wrong secret', () => {
    const ts = String(Math.floor(Date.now() / 1000))
    const sig = signWebhook('other', ts, body)
    expect(verifyWebhookSignature({ secret, signature: sig, timestamp: ts, rawBody: body }).ok).toBe(false)
  })

  it('rejects replayed (stale) timestamps', () => {
    const staleTs = String(Math.floor(Date.now() / 1000) - 3600)
    const sig = signWebhook(secret, staleTs, body)
    const result = verifyWebhookSignature({ secret, signature: sig, timestamp: staleTs, rawBody: body })
    expect(result).toEqual({ ok: false, reason: 'timestamp_out_of_tolerance' })
  })

  it('rejects missing headers', () => {
    expect(verifyWebhookSignature({ secret, signature: null, timestamp: '1', rawBody: body }).ok).toBe(false)
    expect(verifyWebhookSignature({ secret, signature: 'x', timestamp: null, rawBody: body }).ok).toBe(false)
  })
})

describe('api key hashing', () => {
  it('is deterministic and one-way', () => {
    expect(hashApiKey('live_sk_abc')).toBe(hashApiKey('live_sk_abc'))
    expect(hashApiKey('live_sk_abc')).not.toBe(hashApiKey('live_sk_abd'))
    expect(hashApiKey('live_sk_abc')).toHaveLength(64)
  })
})

describe('secret encryption', () => {
  it('round-trips', () => {
    const enc = encryptSecret('whsec_super_secret')
    expect(enc).not.toContain('whsec_super_secret')
    expect(decryptSecret(enc)).toBe('whsec_super_secret')
  })
})

import { db } from './db'

export interface FraudSignal {
  type: string
  score: number
  details: string
}

/**
 * Basic fraud heuristics. Produces a 0-100 risk score; conversions above the
 * review threshold are flagged for manual review, never auto-rejected.
 */
export async function scoreConversionRisk(opts: {
  organizationId: string
  affiliateId: string | null
  affiliateEmail?: string | null
  customerEmail?: string | null
  clickIp?: string | null
  orderTotalCents: number
}): Promise<{ score: number; signals: FraudSignal[] }> {
  const signals: FraudSignal[] = []
  const { organizationId, affiliateId } = opts

  // self-referral: affiliate email matches customer email
  if (opts.affiliateEmail && opts.customerEmail &&
      opts.affiliateEmail.toLowerCase() === opts.customerEmail.toLowerCase()) {
    signals.push({ type: 'SELF_REFERRAL', score: 60, details: `affiliate email matches customer email` })
  }

  if (affiliateId) {
    // conversion velocity: many conversions in the last hour
    const recent = await db.conversion.count({
      where: {
        organizationId,
        affiliateId,
        createdAt: { gte: new Date(Date.now() - 3600_000) },
      },
    })
    if (recent >= 10) {
      signals.push({ type: 'CONVERSION_VELOCITY', score: 40, details: `${recent} conversions in last hour` })
    }

    // same IP converting repeatedly
    if (opts.clickIp) {
      const sameIp = await db.click.count({
        where: {
          organizationId,
          ipAddress: opts.clickIp,
          createdAt: { gte: new Date(Date.now() - 86_400_000) },
          conversions: { some: {} },
        },
      })
      if (sameIp >= 3) {
        signals.push({ type: 'IP_VELOCITY', score: 30, details: `${sameIp} converting clicks from ${opts.clickIp} in 24h` })
      }
    }

    // suspiciously high conversion rate (>50% with meaningful volume)
    const [clicks, conversions] = await Promise.all([
      db.click.count({ where: { organizationId, affiliateId } }),
      db.conversion.count({ where: { organizationId, affiliateId } }),
    ])
    if (clicks >= 10 && conversions / clicks > 0.5) {
      signals.push({ type: 'HIGH_CVR', score: 25, details: `${conversions}/${clicks} conversion rate` })
    }
  }

  const score = Math.min(100, signals.reduce((s, x) => s + x.score, 0))
  return { score, signals }
}

export const REVIEW_THRESHOLD = 40

export async function recordFraudAlerts(opts: {
  organizationId: string
  affiliateId: string | null
  conversionId: string
  signals: FraudSignal[]
  score: number
}) {
  for (const s of opts.signals) {
    await db.fraudAlert.create({
      data: {
        organizationId: opts.organizationId,
        affiliateId: opts.affiliateId,
        conversionId: opts.conversionId,
        type: s.type,
        riskScore: opts.score,
        details: s.details,
      },
    })
  }
}

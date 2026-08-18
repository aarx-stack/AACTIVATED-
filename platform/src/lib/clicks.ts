import { db } from './db'
import { newClickId, newSessionId } from './ids'
import { queueOutboundWebhook } from './webhooks-out'

function detectDevice(ua: string): string {
  if (/mobile|iphone|android.+mobile/i.test(ua)) return 'mobile'
  if (/ipad|tablet|android/i.test(ua)) return 'tablet'
  if (/bot|crawler|spider/i.test(ua)) return 'bot'
  return 'desktop'
}

function detectBrowser(ua: string): string {
  if (/edg\//i.test(ua)) return 'edge'
  if (/chrome|crios/i.test(ua)) return 'chrome'
  if (/firefox|fxios/i.test(ua)) return 'firefox'
  if (/safari/i.test(ua)) return 'safari'
  return 'other'
}

export interface RecordClickInput {
  organizationId: string
  affiliateId: string
  trackingLinkId?: string | null
  offerId?: string | null
  campaignId?: string | null
  sessionId?: string | null
  landingPage?: string | null
  referrer?: string | null
  utmSource?: string | null
  utmMedium?: string | null
  utmCampaign?: string | null
  utmContent?: string | null
  utmTerm?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  country?: string | null
  region?: string | null
}

export async function recordClick(input: RecordClickInput) {
  const ua = input.userAgent ?? ''
  const click = await db.click.create({
    data: {
      organizationId: input.organizationId,
      clickId: newClickId(),
      affiliateId: input.affiliateId,
      trackingLinkId: input.trackingLinkId ?? null,
      offerId: input.offerId ?? null,
      campaignId: input.campaignId ?? null,
      sessionId: input.sessionId ?? newSessionId(),
      landingPage: input.landingPage ?? null,
      referrer: input.referrer ?? null,
      utmSource: input.utmSource ?? null,
      utmMedium: input.utmMedium ?? null,
      utmCampaign: input.utmCampaign ?? null,
      utmContent: input.utmContent ?? null,
      utmTerm: input.utmTerm ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: ua || null,
      device: ua ? detectDevice(ua) : null,
      browser: ua ? detectBrowser(ua) : null,
      country: input.country ?? null,
      region: input.region ?? null,
    },
  })
  queueOutboundWebhook(input.organizationId, 'click.created', {
    click_id: click.clickId,
    affiliate_id: input.affiliateId,
  }).catch(() => {})
  return click
}

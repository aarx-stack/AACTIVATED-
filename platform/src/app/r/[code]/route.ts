// Tracking redirect: https://<host>/r/<referralCode-or-linkSlug>?url=...
// Records a click, sets attribution cookies, appends ref & click_id to the
// destination URL, then redirects.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordClick } from '@/lib/clicks'
import { getSetting, SETTING_KEYS } from '@/lib/settings'

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const sp = req.nextUrl.searchParams

  // resolve tracking link slug first, then affiliate referral code
  const link = await db.trackingLink.findUnique({ where: { slug: code }, include: { affiliate: true } })
  const affiliate = link
    ? link.affiliate
    : await db.affiliate.findFirst({ where: { OR: [{ referralCode: code }, { affiliateCode: code }] } })

  const fallback = sp.get('url') ?? process.env.APP_URL ?? '/'
  if (!affiliate || affiliate.status !== 'ACTIVE' || (link && !link.isActive)) {
    return NextResponse.redirect(fallback)
  }

  const destination = new URL(sp.get('url') ?? link?.destinationUrl ?? process.env.APP_URL ?? 'http://localhost:3000')

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const click = await recordClick({
    organizationId: affiliate.organizationId,
    affiliateId: affiliate.id,
    trackingLinkId: link?.id ?? null,
    offerId: link?.offerId ?? null,
    campaignId: link?.campaignId ?? null,
    sessionId: req.cookies.get('af_session')?.value ?? null,
    landingPage: destination.toString(),
    referrer: req.headers.get('referer'),
    utmSource: sp.get('utm_source'),
    utmMedium: sp.get('utm_medium'),
    utmCampaign: sp.get('utm_campaign'),
    utmContent: sp.get('utm_content'),
    utmTerm: sp.get('utm_term'),
    ipAddress: ip,
    userAgent: req.headers.get('user-agent'),
    country: req.headers.get('x-vercel-ip-country') ?? req.headers.get('cf-ipcountry'),
    region: req.headers.get('x-vercel-ip-country-region'),
  })

  destination.searchParams.set('ref', affiliate.referralCode)
  destination.searchParams.set('click_id', click.clickId)

  const res = NextResponse.redirect(destination.toString())
  const windowDays = Number(await getSetting(affiliate.organizationId, SETTING_KEYS.cookieWindowDays))
  const maxAge = windowDays < 0 ? 10 * 365 * 86400 : windowDays * 86400
  res.cookies.set('af_ref', affiliate.referralCode, { maxAge, sameSite: 'lax' })
  res.cookies.set('af_click', click.clickId, { maxAge, sameSite: 'lax' })
  if (!req.cookies.get('af_session')) {
    res.cookies.set('af_session', click.sessionId ?? '', { maxAge: 2 * 365 * 86400, sameSite: 'lax' })
  }
  return res
}

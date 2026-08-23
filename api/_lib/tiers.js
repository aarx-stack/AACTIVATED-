/**
 * Affiliate tier ladder for AACTIVATED RX.
 *
 * Monthly qualifying sales volume (USD) decides which affiliate group an
 * affiliate belongs in. All money math is done in integer cents to avoid
 * floating-point drift at the tier boundaries ($999.99 vs $1,000.00).
 */

export const TIERS = [
  { key: 'standard', minCents: 0, label: 'Standard 15%' },
  { key: 'starter', minCents: 100_000, label: 'Starter 20%' },
  { key: 'builder', minCents: 250_000, label: 'Builder 25%' },
  { key: 'pro', minCents: 500_000, label: 'Pro 30%' },
  { key: 'elite', minCents: 1_000_000, label: 'Elite 35%' },
];

// Groups the automation must never move an affiliate out of. Matched as
// word-prefix tokens against the Tapfiliate group title (case-insensitive),
// so "Competitive 40%", "Elevate 45%" and "Strategic Partner 50%" all match.
export const DEFAULT_PROTECTED_KEYWORDS = ['competitive', 'elevate', 'strategic'];

export function toCents(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function centsToDollars(cents) {
  return (cents / 100).toFixed(2);
}

/** Highest tier whose minimum the volume meets. Volumes below zero clamp to the base tier. */
export function tierForVolumeCents(volumeCents) {
  let match = TIERS[0];
  for (const tier of TIERS) {
    if (volumeCents >= tier.minCents) match = tier;
  }
  return match;
}

function tokens(title) {
  return String(title || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Match a Tapfiliate group title to a tier key, e.g. "Starter 20%" -> "starter".
 * Exact word match only, so "Pro 30%" matches "pro" but "Strategic Partner 50%" does not.
 */
export function tierKeyForGroupTitle(title) {
  const words = tokens(title);
  for (const tier of TIERS) {
    if (words.includes(tier.key)) return tier.key;
  }
  return null;
}

/** True when a group title matches one of the protected B2B keywords. */
export function isProtectedGroupTitle(title, protectedKeywords = DEFAULT_PROTECTED_KEYWORDS) {
  const words = tokens(title);
  return protectedKeywords.some((kw) => words.includes(String(kw).toLowerCase().trim()));
}

/**
 * Sum the qualifying sales volume, in cents, of a list of Tapfiliate conversions.
 *
 * Rules:
 *  - A conversion counts only if it is NOT fully disapproved: it must have at
 *    least one commission whose `approved` flag is not `false`. Tapfiliate
 *    marks refunded / rejected conversions by disapproving their commissions,
 *    so those drop out of the qualifying volume here.
 *  - `approved: null` means pending review; pending conversions count by
 *    default (countPending=true) so tier moves track real-time sales, and can
 *    be excluded by setting COUNT_PENDING_COMMISSIONS=false.
 *  - A conversion with no commissions at all is treated as pending.
 *  - `inMonth(conversion)` filters to the current calendar month.
 */
export function sumQualifyingVolumeCents(conversions, { countPending = true, inMonth = () => true } = {}) {
  let total = 0;
  const counted = [];
  const skipped = [];

  for (const conv of conversions) {
    if (!inMonth(conv)) {
      skipped.push({ id: conv.id, reason: 'outside_month' });
      continue;
    }

    const commissions = Array.isArray(conv.commissions) ? conv.commissions : [];
    const hasApproved = commissions.some((c) => c.approved === true);
    const hasPending = commissions.length === 0 || commissions.some((c) => c.approved === null || c.approved === undefined);
    const allDisapproved = commissions.length > 0 && commissions.every((c) => c.approved === false);

    if (allDisapproved) {
      skipped.push({ id: conv.id, reason: 'disapproved_or_refunded' });
      continue;
    }
    if (!hasApproved && hasPending && !countPending) {
      skipped.push({ id: conv.id, reason: 'pending_excluded' });
      continue;
    }

    total += toCents(conv.amount);
    counted.push(conv.id);
  }

  return { totalCents: total, countedIds: counted, skipped };
}

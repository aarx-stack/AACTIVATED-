/**
 * Environment-driven configuration. All secrets live in Vercel environment
 * variables — nothing sensitive is ever hardcoded or committed.
 */

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return !['false', '0', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function parseList(value, fallback) {
  if (!value) return fallback;
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig(env = process.env) {
  return {
    // --- Tapfiliate API ---
    apiKey: env.TAPFILIATE_API_KEY || '',
    apiBase: (env.TAPFILIATE_API_BASE || 'https://api.tapfiliate.com/1.6').replace(/\/$/, ''),
    programId: env.TAPFILIATE_PROGRAM_ID || '', // optional filter, e.g. "aactivatedrx"

    // --- Safety ---
    // DRY_RUN defaults to TRUE: the endpoint logs the decision it would make
    // but performs no writes until DRY_RUN=false is set explicitly.
    dryRun: parseBool(env.DRY_RUN, true),

    // --- Webhook authentication ---
    // WEBHOOK_TOKEN: shared secret required as ?token= or X-Webhook-Token.
    // TAPFILIATE_WEBHOOK_SECRET: HMAC secret for the X-Tapfiliate-Hmac header.
    // At least one must be configured; otherwise every request is rejected.
    webhookToken: env.WEBHOOK_TOKEN || '',
    webhookHmacSecret: env.TAPFILIATE_WEBHOOK_SECRET || '',

    // --- Tier evaluation ---
    timeZone: env.TIER_TIMEZONE || 'UTC',
    countPending: parseBool(env.COUNT_PENDING_COMMISSIONS, true),

    // Protected B2B groups: never auto-moved. Matched by keyword against the
    // group title, plus optional explicit IDs for belt-and-suspenders safety.
    protectedKeywords: parseList(env.PROTECTED_GROUP_KEYWORDS, ['competitive', 'elevate', 'strategic']),
    protectedGroupIds: parseList(env.PROTECTED_GROUP_IDS, []),

    // Optional explicit tier -> group ID overrides. When set they win over
    // name matching, e.g. TIER_GROUP_ID_STANDARD=12345.
    tierGroupIdOverrides: {
      standard: env.TIER_GROUP_ID_STANDARD || '',
      starter: env.TIER_GROUP_ID_STARTER || '',
      builder: env.TIER_GROUP_ID_BUILDER || '',
      pro: env.TIER_GROUP_ID_PRO || '',
      elite: env.TIER_GROUP_ID_ELITE || '',
    },

    // Move affiliates that currently have no group into their computed tier
    // group (true), or leave ungrouped affiliates alone (false).
    assignUngrouped: parseBool(env.ASSIGN_UNGROUPED_AFFILIATES, true),
  };
}

/** Human-readable validation problems; empty array means the config is usable. */
export function validateConfig(cfg) {
  const problems = [];
  if (!cfg.apiKey) problems.push('TAPFILIATE_API_KEY is not set');
  if (!cfg.webhookToken && !cfg.webhookHmacSecret) {
    problems.push('Neither WEBHOOK_TOKEN nor TAPFILIATE_WEBHOOK_SECRET is set — refusing to accept unauthenticated webhooks');
  }
  return problems;
}

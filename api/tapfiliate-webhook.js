/**
 * Tapfiliate "Conversion created" webhook — AACTIVATED RX affiliate tier system.
 *
 * Flow per event:
 *   1. Authenticate the request (shared token and/or HMAC signature).
 *   2. Fetch the conversion from Tapfiliate by the ID in the payload — the
 *      payload only tells us WHICH conversion to look at; the affiliate and
 *      all business data come from Tapfiliate's API, never from the caller.
 *   3. Idempotency: claim the conversion ID (short pending TTL, finalized to
 *      a long TTL only after success); duplicates are acknowledged and skipped.
 *   4. Pull the affiliate's conversions for the current calendar month and sum
 *      qualifying sales (refunded/disapproved conversions excluded).
 *   5. Map the volume to the tier ladder and, unless the affiliate sits in a
 *      protected B2B group, move them into the correct existing group.
 *
 * DRY_RUN defaults to true: decisions are logged, no write is made, until
 * DRY_RUN=false is set in Vercel env vars.
 *
 * The HTTP response is deliberately an opaque acknowledgement — no revenue
 * figures or group names are echoed to callers. Full detail goes to the
 * structured server logs only.
 */

import { loadConfig, validateConfig } from './_lib/config.js';
import { authenticate } from './_lib/auth.js';
import { createIdempotencyStore } from './_lib/idempotency.js';
import { createTapfiliateClient, TapfiliateError } from './_lib/tapfiliate.js';
import {
  tierForVolumeCents,
  tierKeyForGroupTitle,
  isProtectedGroupTitle,
  sumQualifyingVolumeCents,
  centsToDollars,
} from './_lib/tiers.js';
import { currentMonthWindow, makeInMonth } from './_lib/month.js';

const MAX_BODY_BYTES = 256 * 1024; // far above any real Tapfiliate payload

const idempotencyStore = createIdempotencyStore();

// Affiliate-group list changes rarely; cache it briefly across warm invocations.
let groupCache = { at: 0, groups: null };
const GROUP_CACHE_MS = 5 * 60 * 1000;

/** Test hook: clears the warm-instance group cache. */
export function __resetGroupCacheForTests() {
  groupCache = { at: 0, groups: null };
}

class BodyTooLargeError extends Error {}

async function readRawBody(req) {
  // Preferred path: consume the raw stream (needed for exact HMAC bytes).
  try {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > MAX_BODY_BYTES) throw new BodyTooLargeError();
      chunks.push(buf);
    }
    if (chunks.length > 0) return Buffer.concat(chunks).toString('utf8');
  } catch (err) {
    if (err instanceof BodyTooLargeError) throw err;
    // stream already consumed by a platform body-parser helper — fall through
  }
  // Fallback: some runtimes pre-read the body. Token auth is unaffected;
  // HMAC (optional) needs true raw bytes, so proxy-signed setups must keep
  // the raw stream path working.
  const body = req.body;
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (body && typeof body === 'object') return JSON.stringify(body);
  return '';
}

/**
 * Tolerant extraction of the conversion reference from the webhook payload.
 * Tapfiliate's standard trigger posts the bare conversion object; enveloped
 * shapes ({event, data}) are also accepted. Only the conversion ID is
 * ultimately trusted — everything else is re-fetched from the API.
 */
export function extractConversionEvent(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'payload_not_object' };
  }

  const eventType = payload.event || payload.event_type || payload.type || null;
  if (eventType && !/conversion[._-]?(created|new)/i.test(String(eventType))) {
    return { ok: false, reason: 'ignored_event_type', eventType };
  }

  const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;

  // A bare commission object (from e.g. a "Commission approved" trigger
  // pointed at this URL) also has an id — don't mistake it for a conversion.
  if (!eventType && ('approved' in data || 'kind' in data) && !('commissions' in data)) {
    return { ok: false, reason: 'not_a_conversion_payload' };
  }

  const conversionId = data.id ?? data.conversion_id ?? null;
  const affiliateId = data.affiliate?.id ?? data.affiliate_id ?? null;

  if (conversionId === null || conversionId === undefined || conversionId === '') {
    return { ok: false, reason: 'missing_conversion_id' };
  }
  return { ok: true, eventType, conversionId: String(conversionId), affiliateId };
}

/**
 * Classify the account's affiliate groups: which group implements each tier,
 * and which are protected from automation.
 */
export function resolveGroups(groups, cfg) {
  const byId = new Map();
  const tierGroups = {};
  const protectedIds = new Set(cfg.protectedGroupIds.map(String));

  for (const group of groups) {
    const id = String(group.id);
    byId.set(id, group);
    if (
      protectedIds.has(id) ||
      isProtectedGroupTitle(group.title ?? group.name ?? '', cfg.protectedKeywords)
    ) {
      protectedIds.add(id);
      continue;
    }
    const tierKey = tierKeyForGroupTitle(group.title ?? group.name ?? '');
    if (tierKey && !tierGroups[tierKey]) tierGroups[tierKey] = group;
  }

  // Explicit ID overrides win over name matching — but never over protection:
  // an override pointing at a protected group is ignored rather than allowing
  // the automation to move affiliates into a protected B2B group.
  for (const [tierKey, overrideId] of Object.entries(cfg.tierGroupIdOverrides)) {
    if (overrideId && byId.has(String(overrideId)) && !protectedIds.has(String(overrideId))) {
      tierGroups[tierKey] = byId.get(String(overrideId));
    }
  }

  return { byId, tierGroups, protectedIds };
}

function logEvent(fields) {
  // One structured JSON line per decision — greppable in Vercel logs.
  console.log(JSON.stringify({ source: 'tapfiliate-tier-webhook', ts: new Date().toISOString(), ...fields }));
}

function groupLabel(group) {
  if (!group) return null;
  return { id: String(group.id), title: group.title ?? group.name ?? null };
}

/**
 * The affiliate's current group, reading both shapes seen in the wild:
 * a scalar `affiliate_group_id` (observed live) or a nested `group: {id}`
 * (modeled by the API reference reconstructions). When NEITHER field is
 * present the group state is unknown and the caller must skip conservatively
 * rather than assume "ungrouped" (which could bypass protected-group checks).
 */
export function readAffiliateGroupState(affiliate) {
  if (!affiliate || typeof affiliate !== 'object') return { known: false, groupId: null };
  const hasScalar = Object.prototype.hasOwnProperty.call(affiliate, 'affiliate_group_id');
  const hasNested = Object.prototype.hasOwnProperty.call(affiliate, 'group');
  if (!hasScalar && !hasNested) return { known: false, groupId: null };
  const raw = affiliate.affiliate_group_id ?? (affiliate.group && typeof affiliate.group === 'object' ? affiliate.group.id : null);
  return { known: true, groupId: raw != null ? String(raw) : null };
}

export default async function handler(req, res) {
  const cfg = loadConfig();

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, service: 'tapfiliate-tier-webhook', message: 'POST Tapfiliate conversion webhooks here.' });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const configProblems = validateConfig(cfg);
  if (configProblems.length > 0) {
    // Details go to the server log only — never to unauthenticated callers.
    logEvent({ level: 'error', action: 'misconfigured', problems: configProblems });
    return res.status(500).json({ error: 'misconfigured' });
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      logEvent({ level: 'warn', action: 'rejected_body_too_large' });
      return res.status(413).json({ error: 'payload_too_large' });
    }
    throw err;
  }

  const auth = authenticate(req, rawBody, cfg);
  if (!auth.ok) {
    logEvent({ level: 'warn', action: 'rejected_unauthenticated' });
    return res.status(401).json({ error: 'unauthorized' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    logEvent({ level: 'warn', action: 'rejected_bad_json' });
    return res.status(400).json({ error: 'invalid_json' });
  }

  const event = extractConversionEvent(payload);
  if (!event.ok) {
    logEvent({ level: 'info', action: 'ignored', reason: event.reason, event_type: event.eventType ?? null });
    // 200 so Tapfiliate does not retry events we deliberately ignore.
    return res.status(200).json({ status: 'ignored', reason: event.reason });
  }

  const client = createTapfiliateClient(cfg);

  // --- Authoritative lookup: the conversion must exist in Tapfiliate. ---
  // This also prevents forged payloads from pre-claiming future conversion
  // IDs or steering the evaluation with caller-chosen affiliate IDs.
  let conversion;
  try {
    conversion = await client.getConversion(event.conversionId);
  } catch (err) {
    if (err instanceof TapfiliateError && err.status === 404) {
      logEvent({ level: 'warn', action: 'ignored', reason: 'conversion_not_found', conversion_id: event.conversionId });
      return res.status(200).json({ status: 'ignored', reason: 'conversion_not_found' });
    }
    logEvent({
      level: 'error',
      action: 'processing_failed',
      stage: 'fetch_conversion',
      conversion_id: event.conversionId,
      error: String(err?.message ?? err),
    });
    return res.status(500).json({ error: 'processing_failed', conversion_id: event.conversionId });
  }

  const affiliateId = conversion?.affiliate?.id != null ? String(conversion.affiliate.id) : null;
  if (!affiliateId) {
    logEvent({ level: 'warn', action: 'ignored', reason: 'no_affiliate_on_conversion', conversion_id: event.conversionId });
    return res.status(200).json({ status: 'ignored', reason: 'no_affiliate_on_conversion' });
  }
  const payloadAffiliateMismatch = Boolean(event.affiliateId && String(event.affiliateId) !== affiliateId);

  // --- Idempotency: claim only after the conversion is known to be real. ---
  const idemKey = `tapfiliate:conversion:${event.conversionId}`;
  const firstDelivery = await idempotencyStore.markProcessed(idemKey).catch((err) => {
    // Idempotency store outage: log and continue — reprocessing is safe
    // because the move below is a computed no-op on repeat.
    logEvent({ level: 'warn', action: 'idempotency_store_error', error: String(err) });
    return true;
  });
  if (!firstDelivery) {
    logEvent({ level: 'info', action: 'duplicate_skipped', conversion_id: event.conversionId });
    return res.status(200).json({ status: 'duplicate', conversion_id: event.conversionId });
  }

  try {
    const affiliate = await client.getAffiliate(affiliateId);

    // --- Load and classify groups (cached) ---
    if (!groupCache.groups || Date.now() - groupCache.at > GROUP_CACHE_MS) {
      groupCache = { at: Date.now(), groups: await client.listAffiliateGroups() };
    }
    const { byId, tierGroups, protectedIds } = resolveGroups(groupCache.groups, cfg);
    const tierGroupIds = new Set(
      Object.values(tierGroups)
        .filter(Boolean)
        .map((g) => String(g.id))
    );

    // --- Sum this month's qualifying sales ---
    const window = currentMonthWindow(new Date(), cfg.timeZone);
    const { conversions, truncated } = await client.listConversions({
      affiliateId,
      dateFrom: window.dateFrom,
      dateTo: window.dateTo,
      programId: cfg.programId,
    });
    const volume = sumQualifyingVolumeCents(conversions, {
      countPending: cfg.countPending,
      inMonth: makeInMonth(window.yearMonth, cfg.timeZone),
    });

    const tier = tierForVolumeCents(volume.totalCents);
    const targetGroup = tierGroups[tier.key] ?? null;

    const groupState = readAffiliateGroupState(affiliate);
    const currentGroupId = groupState.groupId;
    const currentGroup = currentGroupId ? byId.get(currentGroupId) ?? null : null;

    // A group is "tier-managed" when its id is one of the resolved tier
    // groups (covers TIER_GROUP_ID_* overrides whose titles carry no tier
    // keyword) OR its title matches a tier name.
    const currentIsTierManaged =
      currentGroup !== null &&
      (tierGroupIds.has(currentGroupId) || Boolean(tierKeyForGroupTitle(currentGroup.title ?? currentGroup.name ?? '')));

    // --- Decide the action ---
    let action;
    let detail = null;
    let writeEndpoint = null;

    if (!groupState.known) {
      // The affiliate object exposed no group information at all — never
      // assume "ungrouped", that could move a protected B2B affiliate.
      action = 'skipped_unknown_group_state';
      detail = 'Affiliate object carried neither affiliate_group_id nor group; refusing to act on unknown state';
    } else if (currentGroupId && protectedIds.has(currentGroupId)) {
      action = 'skipped_protected_group';
    } else if (currentGroupId && !currentGroup) {
      // Group ID not in the account's group list — never touch what we can't identify.
      action = 'skipped_unrecognized_group';
    } else if (currentGroup && !currentIsTierManaged) {
      // In a group that is neither a tier group nor explicitly protected —
      // treat as manually managed and leave it alone.
      action = 'skipped_non_tier_group';
    } else if (!currentGroupId && !cfg.assignUngrouped) {
      action = 'skipped_ungrouped_by_config';
    } else if (!targetGroup) {
      action = 'error_target_group_not_found';
      detail = `No affiliate group matched tier "${tier.key}" — check group titles or set TIER_GROUP_ID_${tier.key.toUpperCase()}`;
    } else if (currentGroupId === String(targetGroup.id)) {
      action = 'no_change_needed';
    } else if (cfg.dryRun) {
      action = 'dry_run_would_move';
    } else {
      const write = await client.setAffiliateGroup(affiliateId, targetGroup.id);
      writeEndpoint = write.endpoint;
      action = 'moved';
    }

    if (action === 'error_target_group_not_found') {
      // Leave the claim on its short pending TTL so a replay after the
      // configuration is fixed can reprocess this conversion.
    } else {
      await idempotencyStore.finalize(idemKey).catch(() => {});
    }

    logEvent({
      level: action.startsWith('error') ? 'error' : 'info',
      conversion_id: event.conversionId,
      affiliate_id: affiliateId,
      monthly_qualifying_sales_usd: centsToDollars(volume.totalCents),
      conversions_counted: volume.countedIds.length,
      conversions_excluded_count: volume.skipped.length,
      conversions_excluded: volume.skipped.slice(0, 50),
      month: window.yearMonth,
      timezone: cfg.timeZone,
      current_group: groupLabel(currentGroup) ?? (currentGroupId ? { id: currentGroupId, title: null } : null),
      calculated_group: groupLabel(targetGroup) ?? { tier: tier.key, label: tier.label },
      calculated_tier: tier.key,
      action,
      dry_run: cfg.dryRun,
      auth_method: auth.method,
      ...(payloadAffiliateMismatch ? { payload_affiliate_mismatch: true, payload_affiliate_id: String(event.affiliateId) } : {}),
      ...(detail ? { detail } : {}),
      ...(writeEndpoint ? { write_endpoint: writeEndpoint } : {}),
      ...(truncated ? { warning: 'conversion_list_truncated_at_page_cap' } : {}),
    });

    // Opaque acknowledgement only — no revenue, tier, or group data leaves
    // the server. Operators read the details in the Vercel function logs.
    return res.status(200).json({
      status: 'processed',
      conversion_id: event.conversionId,
      action,
      dry_run: cfg.dryRun,
    });
  } catch (err) {
    // Release the idempotency claim so Tapfiliate's retry can reprocess.
    await idempotencyStore.release(idemKey).catch(() => {});
    const isApi = err instanceof TapfiliateError;
    logEvent({
      level: 'error',
      action: 'processing_failed',
      conversion_id: event.conversionId,
      error: String(err?.message ?? err),
      ...(isApi ? { api_status: err.status, api_url: err.url } : {}),
    });
    return res.status(500).json({ error: 'processing_failed', conversion_id: event.conversionId });
  }
}

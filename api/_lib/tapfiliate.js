/**
 * Minimal Tapfiliate REST API v1.6 client (no dependencies, global fetch).
 *
 * Auth: API key request header (docs show `X-Api-Key`; the legacy `Api-Key`
 * spelling is also sent for compatibility). Base URL: https://api.tapfiliate.com/1.6
 * Handles 429 rate limits with a single Retry-After respecting retry, and
 * paginates list endpoints via the `page` query parameter (25 rows/page,
 * `Link: <...>; rel="next"` response header signals more pages).
 */

const PAGE_SIZE = 25;
const MAX_PAGES = 80; // hard cap: 2000 conversions per affiliate-month

function hasNextPage(linkHeader) {
  return typeof linkHeader === 'string' && /rel="?next"?/i.test(linkHeader);
}

// Which group-assignment endpoint shape the live API accepted (see
// setAffiliateGroup). Module-level so warm invocations skip the probe.
let knownGoodWriteStyle = null;

/** Test hook. */
export function __resetWriteStyleForTests() {
  knownGoodWriteStyle = null;
}

export class TapfiliateError extends Error {
  constructor(message, { status, body, url } = {}) {
    super(message);
    this.name = 'TapfiliateError';
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

export function createTapfiliateClient(cfg, fetchImpl = globalThis.fetch) {
  const base = cfg.apiBase;

  async function requestFull(path, { method = 'GET', query = {}, body, _retried = false } = {}) {
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }

    const res = await fetchImpl(url.toString(), {
      method,
      headers: {
        'X-Api-Key': cfg.apiKey,
        'Api-Key': cfg.apiKey,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 429 && !_retried) {
      const retryAfter = Number(res.headers.get('retry-after')) || 2;
      await new Promise((r) => setTimeout(r, Math.min(retryAfter, 10) * 1000));
      return requestFull(path, { method, query, body, _retried: true });
    }

    const text = await res.text();
    if (!res.ok) {
      throw new TapfiliateError(`Tapfiliate API ${method} ${path} failed: HTTP ${res.status}`, {
        status: res.status,
        body: text.slice(0, 500),
        url: url.toString(),
      });
    }
    const link = (res.headers?.get ? res.headers.get('link') : null) ?? null;
    if (!text) return { data: null, link };
    try {
      return { data: JSON.parse(text), link };
    } catch {
      throw new TapfiliateError(`Tapfiliate API ${method} ${path} returned non-JSON`, {
        status: res.status,
        body: text.slice(0, 500),
        url: url.toString(),
      });
    }
  }

  async function request(path, opts) {
    const { data } = await requestFull(path, opts);
    return data;
  }

  return {
    request,

    /** GET /affiliates/{id}/ — includes affiliate_group_id. */
    getAffiliate(affiliateId) {
      return request(`/affiliates/${encodeURIComponent(affiliateId)}/`);
    },

    /** GET /conversions/{id}/ — fallback when the webhook payload is missing fields. */
    getConversion(conversionId) {
      return request(`/conversions/${encodeURIComponent(conversionId)}/`);
    },

    /** GET /affiliate-groups/ — the account's existing groups (id, title, ...). */
    async listAffiliateGroups() {
      const groups = [];
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const { data: batch, link } = await requestFull('/affiliate-groups/', { query: { page } });
        if (!Array.isArray(batch) || batch.length === 0) break;
        groups.push(...batch);
        const more = link !== null ? hasNextPage(link) : batch.length === PAGE_SIZE;
        if (!more) break;
      }
      return groups;
    },

    /**
     * GET /conversions/ filtered to one affiliate and a date window, fully
     * paginated. date_from/date_to are YYYY-MM-DD (inclusive, interpreted in
     * UTC — use_profile_timezone=false is pinned so results are deterministic;
     * exact month membership is re-checked client-side in the configured tz).
     */
    async listConversions({ affiliateId, dateFrom, dateTo, programId }) {
      const conversions = [];
      let truncated = false;
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const { data: batch, link } = await requestFull('/conversions/', {
          query: {
            affiliate_id: affiliateId,
            date_from: dateFrom,
            date_to: dateTo,
            program_id: programId || undefined,
            use_profile_timezone: 'false',
            page,
          },
        });
        if (!Array.isArray(batch) || batch.length === 0) break;
        conversions.push(...batch);
        const more = link !== null ? hasNextPage(link) : batch.length === PAGE_SIZE;
        if (!more) break;
        if (page === MAX_PAGES) truncated = true;
      }
      return { conversions, truncated };
    },

    /**
     * THE ONLY WRITE CALL IN THIS SYSTEM.
     * Moves an affiliate into an EXISTING affiliate group — membership only;
     * commission rates and group definitions are never touched.
     *
     * The official reference (https://tapfiliate.com/docs/rest/) documents
     * group assignment under Affiliate Groups; two request shapes exist in
     * the wild for API v1.6 (docs page unreachable from this build network,
     * verified as far as official support articles + Tapfiliate's own
     * endpoint conventions allow):
     *
     *   A) POST /1.6/affiliate-groups/{affiliate_group_id}/affiliates/
     *      body: { "affiliate": { "id": "<affiliate_id>" } }
     *      (mirrors the documented "add affiliate to program" call
     *       POST /1.6/programs/{program_id}/affiliates/)
     *   B) PUT  /1.6/affiliates/{affiliate_id}/group/
     *      body: { "group": { "id": "<affiliate_group_id>" } }
     *
     * A wrong-shape call fails with 4xx and has NO side effect, so this
     * method tries A then B, remembers which form the live API accepted
     * (module-level, survives warm invocations), and reports it in the
     * result for logging. An affiliate belongs to at most one group
     * (scalar `affiliate_group_id`), so assignment replaces any previous
     * membership — no separate removal call is needed.
     */
    async setAffiliateGroup(affiliateId, groupId) {
      const attempts = [
        {
          style: 'post_group_members',
          label: 'POST /affiliate-groups/{group_id}/affiliates/',
          fn: () =>
            request(`/affiliate-groups/${encodeURIComponent(groupId)}/affiliates/`, {
              method: 'POST',
              body: { affiliate: { id: String(affiliateId) } },
            }),
        },
        {
          style: 'put_affiliate_group',
          label: 'PUT /affiliates/{affiliate_id}/group/',
          fn: () =>
            request(`/affiliates/${encodeURIComponent(affiliateId)}/group/`, {
              method: 'PUT',
              body: { group: { id: String(groupId) } },
            }),
        },
      ];
      if (knownGoodWriteStyle) {
        attempts.sort((a, b) => (a.style === knownGoodWriteStyle ? -1 : b.style === knownGoodWriteStyle ? 1 : 0));
      }

      const failures = [];
      for (const attempt of attempts) {
        try {
          const result = await attempt.fn();
          knownGoodWriteStyle = attempt.style;
          return { endpoint: attempt.label, result };
        } catch (err) {
          // 400/404/405 on one shape = endpoint-shape mismatch (or a genuinely
          // missing entity, in which case the other shape fails the same way).
          if (err instanceof TapfiliateError && [400, 404, 405].includes(err.status)) {
            failures.push(`${attempt.label} -> HTTP ${err.status} ${err.body ?? ''}`.trim());
            continue;
          }
          throw err;
        }
      }
      throw new TapfiliateError(
        `Tapfiliate group assignment failed on all documented endpoint forms: ${failures.join(' | ')}`,
        { status: 404 }
      );
    },
  };
}

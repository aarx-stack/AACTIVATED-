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
     * Endpoint path+method (corroborated by every known reconstruction of
     * the official v1.6 reference, with no competing form found anywhere):
     *
     *   PUT /1.6/affiliates/{affiliate_id}/group/
     *
     * The exact request body is NOT published verbatim by Tapfiliate; four
     * candidate shapes exist across the official support article and
     * production integrations. A wrong shape fails 4xx with no side effect,
     * so the shapes are tried in evidence order, and — critically — EVERY
     * 2xx is verified by re-reading the affiliate and checking that
     * affiliate_group_id actually changed to the target. Only a verified
     * write counts as success; the working shape is remembered
     * (module-level, survives warm invocations) and reported for logging.
     *
     * An affiliate belongs to at most one group (scalar affiliate_group_id),
     * so assignment replaces any previous membership — no removal needed.
     */
    async setAffiliateGroup(affiliateId, groupId) {
      const path = `/affiliates/${encodeURIComponent(affiliateId)}/group/`;
      const gid = String(groupId);
      const attempts = [
        // A: flat group_id — official support article: "group_id is a required parameter"
        { style: 'body_group_id', label: `PUT ${path} {"group_id"}`, opts: { method: 'PUT', body: { group_id: gid } } },
        // B: nested object — api-evangelist capture of the docs reference
        { style: 'body_group_obj', label: `PUT ${path} {"group":{"id"}}`, opts: { method: 'PUT', body: { group: { id: gid } } } },
        // C: flat string — metorial integration client
        { style: 'body_group_flat', label: `PUT ${path} {"group"}`, opts: { method: 'PUT', body: { group: gid } } },
        // D: query param, empty body — support article: "all required data
        //    will be added to the request URL as query parameters"
        { style: 'query_group_id', label: `PUT ${path}?group_id=`, opts: { method: 'PUT', query: { group_id: gid } } },
      ];
      if (knownGoodWriteStyle) {
        attempts.sort((a, b) => (a.style === knownGoodWriteStyle ? -1 : b.style === knownGoodWriteStyle ? 1 : 0));
      }

      const failures = [];
      for (const attempt of attempts) {
        try {
          await request(path, attempt.opts);
        } catch (err) {
          if (err instanceof TapfiliateError && [400, 404, 405, 415, 422].includes(err.status)) {
            failures.push(`${attempt.label} -> HTTP ${err.status} ${String(err.body ?? '').slice(0, 120)}`.trim());
            continue;
          }
          throw err;
        }

        // 2xx alone is not trusted: confirm the membership actually changed.
        // Both observed response shapes are accepted: scalar affiliate_group_id
        // (seen live) or nested group.id (per the reference reconstructions).
        const after = await request(`/affiliates/${encodeURIComponent(affiliateId)}/`);
        const afterGroupId = after?.affiliate_group_id ?? (after?.group && typeof after.group === 'object' ? after.group.id : null);
        if (afterGroupId != null && String(afterGroupId) === gid) {
          knownGoodWriteStyle = attempt.style;
          return { endpoint: attempt.label, verified: true };
        }
        failures.push(`${attempt.label} -> 2xx but affiliate group is still ${afterGroupId ?? 'null'}`);
      }
      throw new TapfiliateError(
        `Tapfiliate group assignment could not be verified with any documented request shape: ${failures.join(' | ')}`,
        { status: 502 }
      );
    },
  };
}

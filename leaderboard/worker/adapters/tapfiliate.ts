/**
 * Tapfiliate REST adapter — Tapfiliate is the authority for affiliate
 * attribution and configured commissions.
 *
 * ⚠ VERIFY BEFORE CONNECTING (docs/SETUP.md → "Verify before connecting"):
 * tapfiliate.com was unreachable from the build environment, so the endpoint
 * shapes below follow the historically documented REST API v1.6
 * (https://tapfiliate.com/docs/rest/) and MUST be checked against the current
 * docs — including whether your subscription includes MLM (team
 * relationships) and which webhook events are available — before enabling.
 * Confirmed via public search results: the REST API exists and webhook
 * trigger events include Conversion/Commission/Customer created/updated.
 *
 * Security model for webhooks (no invented signature headers): the inbound
 * webhook URL carries a random secret path segment, and payloads are treated
 * only as *hints* — the referenced record is always re-fetched from this
 * authenticated REST API before anything is written. A forged webhook can
 * therefore only trigger a re-sync, never inject data.
 */
import type { SourceTxn } from "../domain/ingest";

export interface TapfiliateConfig {
  apiKey: string;
  baseUrl?: string; // default v1.6 — verify against current docs
}

// Field names per REST API v1.6 conversion objects — verify before enabling.
export interface TapConversion {
  id: number | string;
  external_id?: string | null;
  affiliate?: { id?: string } | null;
  affiliate_id?: string | null;
  amount?: number | string | null;
  created_at?: string | null;
  meta_data?: Record<string, unknown> | null;
  commissions?: unknown[];
}

export interface TapAffiliate {
  id: string;
  firstname?: string;
  lastname?: string;
  email?: string;
  parent_id?: string | null; // MLM only — may be absent on your plan
  meta_data?: Record<string, unknown> | null;
}

export class TapfiliateClient {
  private base: string;
  constructor(private cfg: TapfiliateConfig) {
    this.base = cfg.baseUrl ?? "https://api.tapfiliate.com/1.6";
  }

  private async request<T>(path: string): Promise<{ data: T; linkNext: string | null }> {
    const res = await fetch(`${this.base}${path}`, {
      headers: { "Api-Key": this.cfg.apiKey, Accept: "application/json" },
    });
    if (res.status === 429) throw new Error("tapfiliate_rate_limited");
    if (!res.ok) throw new Error(`tapfiliate_http_${res.status}`);
    // v1.6 paginates with a Link header (rel="next") — verify.
    const link = res.headers.get("Link");
    const next = link?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
    return { data: (await res.json()) as T, linkNext: next };
  }

  async getConversion(id: string | number): Promise<TapConversion> {
    return (await this.request<TapConversion>(`/conversions/${id}/`)).data;
  }

  /** Page through conversions; `sinceIso` narrows reconciliation windows. */
  async *listConversions(sinceIso?: string): AsyncGenerator<TapConversion[]> {
    let page = 1;
    for (;;) {
      const qs = new URLSearchParams({ page: String(page) });
      if (sinceIso) qs.set("date_from", sinceIso.slice(0, 10)); // verify param name
      const { data, linkNext } = await this.request<TapConversion[]>(`/conversions/?${qs}`);
      if (data.length === 0) return;
      yield data;
      if (!linkNext) return;
      page += 1;
    }
  }

  async *listAffiliates(): AsyncGenerator<TapAffiliate[]> {
    let page = 1;
    for (;;) {
      const { data, linkNext } = await this.request<TapAffiliate[]>(`/affiliates/?page=${page}`);
      if (data.length === 0) return;
      yield data;
      if (!linkNext) return;
      page += 1;
    }
  }
}

/**
 * Map a Tapfiliate conversion to a ledger row. IMPORTANT INVARIANTS:
 *  - a conversion is NOT proof of payment → payment_status starts "pending",
 *    payment_verified false; only the Sellavi adapter or an admin flips it;
 *  - commissions[] are ignored for revenue: one conversion = one transaction,
 *    however many commission records exist;
 *  - amount granularity (does it include tax/shipping? gross or net?) MUST be
 *    verified against your store's integration before production — record it
 *    in docs/DECISIONS_NEEDED.md when confirming the eligibility policy.
 */
export function conversionToTxn(c: TapConversion, affiliateId: string): SourceTxn | null {
  const amount = typeof c.amount === "string" ? Number.parseFloat(c.amount) : (c.amount ?? null);
  if (amount === null || Number.isNaN(amount)) return null;
  const meta = c.meta_data ?? {};
  const num = (v: unknown) => {
    const n = typeof v === "string" ? Number.parseFloat(v) : typeof v === "number" ? v : 0;
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  };
  return {
    id: crypto.randomUUID(),
    source: "tapfiliate",
    externalId: String(c.external_id ?? c.id),
    orderRef: c.external_id ? String(c.external_id) : null,
    affiliateId,
    occurredAt: c.created_at ?? new Date().toISOString(),
    grossCents: Math.round(amount * 100),
    discountCents: num(meta["discount"]),
    taxCents: num(meta["tax"]),
    shippingCents: num(meta["shipping"]),
    refundedCents: 0,
    paymentStatus: "pending",
    paymentVerified: false,
    paymentVerifiedVia: null,
    isFoundersPack: meta["product_sku"] === "FOUNDERS-PACK" || meta["founders_pack"] === true,
    sourceUpdatedAt: c.created_at ?? null,
  };
}

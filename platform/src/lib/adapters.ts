// Commerce adapter layer: map storefront-specific webhook payloads into the
// internal normalized order format. Adding a storefront = adding an adapter.
import { orderPayloadSchema, type OrderPayload } from './conversions'

export interface CommerceAdapter {
  name: string
  /** Convert a raw storefront payload into the normalized order payload. */
  normalizeOrder(raw: Record<string, unknown>): OrderPayload
  /** Extract refund info: external order id + refund amount (major units) or null for full. */
  normalizeRefund(raw: Record<string, unknown>): { order_id: string; amount?: number | null; kind: 'REFUND' | 'CHARGEBACK' | 'CANCELLED' }
}

function str(v: unknown): string | null {
  return v == null ? null : String(v)
}

/** Our own canonical format — passes straight through validation. */
const customAdapter: CommerceAdapter = {
  name: 'custom',
  normalizeOrder(raw) {
    return orderPayloadSchema.parse(raw)
  },
  normalizeRefund(raw) {
    const event = String(raw.event ?? '')
    return {
      order_id: String(raw.order_id),
      amount: raw.refund_amount != null ? Number(raw.refund_amount) : null,
      kind: event === 'chargeback.created' ? 'CHARGEBACK' : event === 'order.cancelled' ? 'CANCELLED' : 'REFUND',
    }
  },
}

/** Sellavi-style payload adapter. */
const sellaviAdapter: CommerceAdapter = {
  name: 'sellavi',
  normalizeOrder(raw) {
    const o = (raw.order ?? raw) as Record<string, unknown>
    const items = ((o.items ?? o.products ?? []) as Record<string, unknown>[]).map(i => ({
      sku: String(i.sku ?? i.product_code ?? i.id ?? 'UNKNOWN'),
      name: String(i.name ?? i.title ?? 'Item'),
      quantity: Number(i.quantity ?? i.qty ?? 1),
      unit_price: Number(i.price ?? i.unit_price ?? 0),
    }))
    return orderPayloadSchema.parse({
      order_id: String(o.id ?? o.order_id),
      customer_id: str(o.customer_id ?? (o.customer as Record<string, unknown> | undefined)?.id),
      customer_email: str(o.customer_email ?? (o.customer as Record<string, unknown> | undefined)?.email),
      subtotal: Number(o.subtotal ?? o.items_total ?? 0),
      discount: Number(o.discount ?? o.discount_total ?? 0),
      shipping: Number(o.shipping ?? o.shipping_total ?? 0),
      tax: Number(o.tax ?? o.tax_total ?? 0),
      total: Number(o.total ?? o.grand_total ?? 0),
      currency: String(o.currency ?? 'USD'),
      promo_code: str(o.coupon ?? o.promo_code ?? o.coupon_code),
      affiliate_id: str(o.affiliate_id ?? o.ref),
      click_id: str(o.click_id),
      products: items,
      created_at: str(o.created_at ?? o.date),
    })
  },
  normalizeRefund(raw) {
    const o = (raw.order ?? raw) as Record<string, unknown>
    return {
      order_id: String(o.id ?? o.order_id),
      amount: o.refund_amount != null ? Number(o.refund_amount) : null,
      kind: 'REFUND',
    }
  },
}

/** Shopify order webhook adapter. */
const shopifyAdapter: CommerceAdapter = {
  name: 'shopify',
  normalizeOrder(raw) {
    const items = ((raw.line_items ?? []) as Record<string, unknown>[]).map(i => ({
      sku: String(i.sku ?? i.variant_id ?? 'UNKNOWN'),
      name: String(i.title ?? 'Item'),
      quantity: Number(i.quantity ?? 1),
      unit_price: Number(i.price ?? 0),
    }))
    const attrs = Object.fromEntries(
      ((raw.note_attributes ?? []) as { name: string; value: string }[]).map(a => [a.name, a.value]),
    )
    const discounts = ((raw.discount_codes ?? []) as { code: string }[])[0]?.code
    return orderPayloadSchema.parse({
      order_id: String(raw.id ?? raw.order_number),
      customer_id: str((raw.customer as Record<string, unknown> | undefined)?.id),
      customer_email: str(raw.email ?? (raw.customer as Record<string, unknown> | undefined)?.email),
      subtotal: Number(raw.subtotal_price ?? 0),
      discount: Number(raw.total_discounts ?? 0),
      shipping: Number(
        ((raw.total_shipping_price_set as Record<string, Record<string, unknown>> | undefined)?.shop_money?.amount) ?? 0,
      ),
      tax: Number(raw.total_tax ?? 0),
      total: Number(raw.total_price ?? 0),
      currency: String(raw.currency ?? 'USD'),
      promo_code: discounts ?? null,
      affiliate_id: str(attrs['ref'] ?? attrs['affiliate_id']),
      click_id: str(attrs['click_id']),
      products: items,
      created_at: str(raw.created_at),
    })
  },
  normalizeRefund(raw) {
    return {
      order_id: String(raw.order_id ?? raw.id),
      amount:
        raw.transactions != null
          ? (raw.transactions as { amount: string }[]).reduce((s, t) => s + Number(t.amount), 0)
          : null,
      kind: 'REFUND',
    }
  },
}

/** WooCommerce order webhook adapter. */
const wooAdapter: CommerceAdapter = {
  name: 'woocommerce',
  normalizeOrder(raw) {
    const items = ((raw.line_items ?? []) as Record<string, unknown>[]).map(i => ({
      sku: String(i.sku ?? i.product_id ?? 'UNKNOWN'),
      name: String(i.name ?? 'Item'),
      quantity: Number(i.quantity ?? 1),
      unit_price: Number(i.price ?? 0),
    }))
    const coupon = ((raw.coupon_lines ?? []) as { code: string }[])[0]?.code
    const meta = Object.fromEntries(
      ((raw.meta_data ?? []) as { key: string; value: string }[]).map(m => [m.key, m.value]),
    )
    return orderPayloadSchema.parse({
      order_id: String(raw.id),
      customer_id: str(raw.customer_id),
      customer_email: str((raw.billing as Record<string, unknown> | undefined)?.email),
      subtotal:
        Number(raw.total ?? 0) - Number(raw.total_tax ?? 0) - Number(raw.shipping_total ?? 0) + Number(raw.discount_total ?? 0),
      discount: Number(raw.discount_total ?? 0),
      shipping: Number(raw.shipping_total ?? 0),
      tax: Number(raw.total_tax ?? 0),
      total: Number(raw.total ?? 0),
      currency: String(raw.currency ?? 'USD'),
      promo_code: coupon ?? null,
      affiliate_id: str(meta['ref'] ?? meta['affiliate_id']),
      click_id: str(meta['click_id']),
      products: items,
      created_at: str(raw.date_created),
    })
  },
  normalizeRefund(raw) {
    return {
      order_id: String(raw.order_id ?? raw.id),
      amount: raw.amount != null ? Number(raw.amount) : null,
      kind: 'REFUND',
    }
  },
}

const adapters: Record<string, CommerceAdapter> = {
  custom: customAdapter,
  sellavi: sellaviAdapter,
  shopify: shopifyAdapter,
  woocommerce: wooAdapter,
}

export function getAdapter(name: string | null | undefined): CommerceAdapter {
  return adapters[(name ?? 'custom').toLowerCase()] ?? customAdapter
}

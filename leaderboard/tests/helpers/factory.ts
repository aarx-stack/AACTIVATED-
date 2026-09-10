import type { Txn } from "@shared/types";

let seq = 0;

export function txn(partial: Partial<Txn> & { occurredAt: string; grossCents: number }): Txn {
  seq += 1;
  return {
    id: `t-${seq}`,
    source: "tapfiliate",
    externalId: `ext-${seq}`,
    orderRef: null,
    affiliateId: "aff-1",
    currency: "USD",
    discountCents: 0,
    taxCents: 0,
    shippingCents: 0,
    refundedCents: 0,
    paymentStatus: "paid",
    paymentVerified: true,
    paymentVerifiedVia: "sellavi",
    isFoundersPack: false,
    correctedBy: null,
    ...partial,
  };
}

/**
 * Payment verification adapter. A Tapfiliate conversion is never proof of
 * payment; something must confirm the order was actually paid before it
 * counts as an eligible sale.
 *
 * Two implementations:
 *  - ManualVerifier (active default): payment confirmations flow through the
 *    admin review queue / corrections API, with audit reasons. Unpaid
 *    Zelle/manual orders therefore can never count as paid sales.
 *  - SellaviApiVerifier (stub): Sellavi's public API/webhook contract was not
 *    verifiable from the build environment. Once you confirm with Sellavi
 *    support how paid-order status can be queried or pushed (and how
 *    deliveries are authenticated per their docs), implement `lookupOrder`
 *    and set SELLAVI_API_KEY. Until then the stub reports "unavailable" and
 *    the system stays in manual mode — it never guesses payment state.
 */

export interface PaymentCheck {
  status: "paid" | "unpaid" | "refunded" | "partially_refunded" | "unknown";
  refundedCents?: number;
  checkedVia: "sellavi" | "manual" | "unavailable";
}

export interface PaymentVerifier {
  readonly mode: "sellavi" | "manual";
  lookupOrder(orderRef: string): Promise<PaymentCheck>;
}

export class ManualVerifier implements PaymentVerifier {
  readonly mode = "manual" as const;
  async lookupOrder(): Promise<PaymentCheck> {
    // Manual mode has no automatic source of truth — admins verify through
    // the review queue; automated jobs must treat payment state as unknown.
    return { status: "unknown", checkedVia: "manual" };
  }
}

export class SellaviApiVerifier implements PaymentVerifier {
  readonly mode = "sellavi" as const;
  constructor(private apiKey: string) {}
  async lookupOrder(_orderRef: string): Promise<PaymentCheck> {
    void this.apiKey;
    // Implement against the confirmed Sellavi API contract; do not invent
    // endpoints. See docs/SETUP.md → "Verify before connecting".
    return { status: "unknown", checkedVia: "unavailable" };
  }
}

export function makeVerifier(env: { SELLAVI_API_KEY?: string }): PaymentVerifier {
  return env.SELLAVI_API_KEY ? new SellaviApiVerifier(env.SELLAVI_API_KEY) : new ManualVerifier();
}

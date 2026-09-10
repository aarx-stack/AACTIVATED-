/** Integer USD cents. All money in the system is integer cents — never floats. */
export type Cents = number;

export type AffiliateStatus = "active" | "suspended" | "pending";

export interface Affiliate {
  /** Stable internal id (never reuse). */
  id: string;
  /** Tapfiliate affiliate id — the authority for attribution. Null until linked. */
  tapfiliateId: string | null;
  /** Approved display name (the only name ever shown to other affiliates). */
  displayName: string;
  displayNameApproved: boolean;
  avatarUrl: string | null;
  status: AffiliateStatus;
  /** UTC ISO instant. */
  enrolledAt: string;
}

export type TxnSource = "tapfiliate" | "sellavi" | "manual";

export type PaymentStatus =
  | "paid"
  | "pending"
  | "unpaid"
  | "partially_refunded"
  | "refunded";

/**
 * One row of the transaction-level ledger. Keyed by (source, externalId) so a
 * transaction can never be counted twice, no matter how many webhook
 * deliveries or commission records reference it.
 */
export interface Txn {
  id: string;
  source: TxnSource;
  /** Stable transaction id from the source system. */
  externalId: string;
  orderRef: string | null;
  affiliateId: string;
  /** UTC ISO instant the order occurred (source-controlled). */
  occurredAt: string;
  currency: "USD";
  /** Product revenue before discounts; tax and shipping are carried separately. */
  grossCents: Cents;
  discountCents: Cents;
  taxCents: Cents;
  shippingCents: Cents;
  /** Cumulative refunds applied against the product-revenue base. */
  refundedCents: Cents;
  paymentStatus: PaymentStatus;
  /** True only after a payment-verification adapter or an admin confirmed payment. */
  paymentVerified: boolean;
  paymentVerifiedVia: "sellavi" | "admin" | null;
  isFoundersPack: boolean;
  /** Audit id when an admin correction has been applied to this row. */
  correctedBy: string | null;
}

export interface EligibilityPolicy {
  netOfDiscounts: boolean;
  excludeTax: boolean;
  excludeShipping: boolean;
  netOfRefunds: boolean;
  /** When true (default), a Tapfiliate conversion alone is NOT proof of payment. */
  requireVerifiedPayment: boolean;
}

/**
 * PROPOSED policy: paid product revenue after discounts and refunds, excluding
 * tax and shipping. Must be confirmed by the program owner before production
 * qualification is activated (see ChallengeConfig.policyConfirmed).
 */
export const DEFAULT_POLICY: EligibilityPolicy = {
  netOfDiscounts: true,
  excludeTax: true,
  excludeShipping: true,
  netOfRefunds: true,
  requireVerifiedPayment: true,
};

export type ExclusionReason =
  | "unpaid"
  | "payment_pending_verification"
  | "refunded"
  | "zero_after_adjustments";

export interface EligibleResult {
  eligible: boolean;
  /** 0 when not eligible. */
  amountCents: Cents;
  reason: ExclusionReason | null;
}

export type QualPath = "direct" | "team" | "founders_pack";

export type ChallengeState =
  | "not_started"
  | "in_progress"
  | "pending_verification"
  | "qualified"
  | "window_ended"
  | "capacity_reached"
  | "membership_expired";

export interface ChallengeConfig {
  /** UTC ISO. Null = launch pending (production default until the owner picks a date). */
  launchAt: string | null;
  /** Demo builds set this so the UI can label the date as a sample. */
  launchIsDemoSample: boolean;
  /** Window length in days; a "day" is exactly 24h, so 30 days = 720h (DST-safe). */
  windowDays: number;
  directTargetCents: Cents;
  teamTargetCents: Cents;
  foundersPackMinCents: Cents;
  seatCap: number;
  policy: EligibilityPolicy;
  /** Owner must confirm the eligibility policy before production qualification runs. */
  policyConfirmed: boolean;
}

export interface Membership {
  affiliateId: string;
  /** 1..seatCap, allocated in verification-completion order (basis pending owner confirmation). */
  seatNo: number;
  path: QualPath;
  /** Instant the qualification path was completed. */
  qualifiedAt: string;
  /** Instant verification completed — current seat-priority basis (pending confirmation). */
  verifiedAt: string;
  /** verifiedAt + 1 year (start basis pending owner confirmation). */
  membershipExpiresAt: string;
}

export interface PendingVerification {
  affiliateId: string;
  path: QualPath;
  submittedAt: string;
  txnId: string | null;
}

export interface TeamEdge {
  parentId: string;
  childId: string;
  verified: boolean;
  source: "tapfiliate_mlm" | "admin";
}

/**
 * SAMPLE rollup policy (pending owner confirmation): a team total is the
 * affiliate's own eligible sales plus every verified descendant's eligible
 * sales, each transaction counted exactly once per ancestor line.
 */
export type RollupPolicy = "self_plus_descendants" | "descendants_only";

export type PeriodType = "monthly" | "weekly" | "alltime";
export type Scope = "personal" | "team";

export interface RankedRow {
  rank: number;
  affiliateId: string;
  amountCents: Cents;
  orders: number;
}

/** Rank movement vs. the latest comparable snapshot; null when none exists. */
export type Movement = number | "new";

export interface SnapshotRow {
  affiliateId: string;
  rank: number;
}

import type {
  ChallengeConfig,
  ChallengeState,
  Membership,
  PendingVerification,
  QualPath,
  Txn,
} from "./types";
import { eligibleAmount } from "./eligibility";
import { DAY_MS } from "./time";

export interface ChallengeWindow {
  /** UTC ms, inclusive. */
  startMs: number;
  /** UTC ms, exclusive: a transaction at exactly `endMs` is outside the window. */
  endMs: number;
}

/**
 * Bonus-window rule (decided):
 *  - enrolled before launch  → window starts at launch;
 *  - enrolled on/after launch → window starts at enrollment;
 *  - length is windowDays × 24h exactly (30 days = 720 hours, DST-safe);
 *  - no launch date configured → no window exists yet ("Launch date pending");
 *  - expired windows never restart automatically.
 */
export function challengeWindow(
  enrolledAtMs: number,
  launchAtMs: number | null,
  windowDays: number,
): ChallengeWindow | null {
  if (launchAtMs === null) return null;
  const startMs = enrolledAtMs < launchAtMs ? launchAtMs : enrolledAtMs;
  return { startMs, endMs: startMs + windowDays * DAY_MS };
}

export interface FoundersPackProgress {
  /** A qualifying-priced Founders Pack order exists inside the window. */
  present: boolean;
  txnId: string | null;
  /** Present AND payment verified. */
  verified: boolean;
  /** Present but payment not yet verified (e.g. Zelle awaiting confirmation). */
  awaitingPayment: boolean;
}

export interface PathProgress {
  directCents: number;
  /** Null = team data not connected (unverified relationships or no rollup policy). */
  teamCents: number | null;
  foundersPack: FoundersPackProgress;
}

/**
 * Founders Pack detection. The pack is an ordinary transaction: when paid it
 * counts once toward eligible sales like any other order (never as synthetic
 * volume), and — independently — a verified pack at/above the minimum price
 * satisfies the founders-pack path.
 */
export function foundersPackProgress(
  txns: Iterable<Txn>,
  cfg: ChallengeConfig,
  window: ChallengeWindow | null,
): FoundersPackProgress {
  const none: FoundersPackProgress = {
    present: false,
    txnId: null,
    verified: false,
    awaitingPayment: false,
  };
  if (!window) return none;
  let best: FoundersPackProgress = none;
  for (const txn of txns) {
    if (!txn.isFoundersPack) continue;
    const t = Date.parse(txn.occurredAt);
    if (t < window.startMs || t >= window.endMs) continue;
    if (txn.grossCents - txn.discountCents < cfg.foundersPackMinCents) continue;
    if (txn.paymentStatus === "refunded") continue;
    const verified = eligibleAmount(txn, cfg.policy).eligible;
    const candidate: FoundersPackProgress = {
      present: true,
      txnId: txn.id,
      verified,
      awaitingPayment: !verified,
    };
    if (verified) return candidate;
    best = best.present ? best : candidate;
  }
  return best;
}

export interface ChallengeStatusInput {
  nowMs: number;
  window: ChallengeWindow | null;
  membership: Membership | null;
  pending: PendingVerification | null;
  seatsClaimed: number;
  seatCap: number;
  progress: PathProgress;
}

export interface ChallengeStatus {
  state: ChallengeState;
  window: ChallengeWindow | null;
  membership: Membership | null;
  pending: PendingVerification | null;
  /** Which path is currently satisfied (before verification), if any. */
  completedPath: QualPath | null;
}

function completedPath(progress: PathProgress, cfg: ChallengeConfig): QualPath | null {
  if (progress.directCents >= cfg.directTargetCents) return "direct";
  if (progress.teamCents !== null && progress.teamCents >= cfg.teamTargetCents) return "team";
  if (progress.foundersPack.verified) return "founders_pack";
  return null;
}

/**
 * Status precedence (documented in docs/TIME_AND_BOUNDARIES.md):
 *  1. qualified / membership_expired — membership is permanent state;
 *  2. pending_verification — a completed path awaiting verification survives
 *     the window closing (the qualifying activity happened inside it);
 *  3. capacity_reached — all seats verified-claimed, affiliate isn't one of them;
 *  4. not_started — no launch configured, or window hasn't opened;
 *  5. window open: in_progress once any path shows progress, else not_started;
 *  6. window_ended — at exactly endMs the window is over.
 */
export function challengeStatus(input: ChallengeStatusInput, cfg: ChallengeConfig): ChallengeStatus {
  const { nowMs, window, membership, pending, seatsClaimed, seatCap, progress } = input;
  const path = completedPath(progress, cfg);
  const base = { window, membership, pending, completedPath: path };

  if (membership) {
    const expired = nowMs >= Date.parse(membership.membershipExpiresAt);
    return { state: expired ? "membership_expired" : "qualified", ...base };
  }
  if (pending) return { state: "pending_verification", ...base };
  if (seatsClaimed >= seatCap) return { state: "capacity_reached", ...base };
  if (!window || nowMs < window.startMs) return { state: "not_started", ...base };
  if (nowMs >= window.endMs) return { state: "window_ended", ...base };

  const anyProgress =
    progress.directCents > 0 ||
    (progress.teamCents !== null && progress.teamCents > 0) ||
    progress.foundersPack.present;
  return { state: anyProgress ? "in_progress" : "not_started", ...base };
}

/**
 * Pure decision for one seat-claim attempt; the persistence layer must apply
 * it atomically (see worker/domain/seats.ts for the single-statement D1 form).
 */
export function decideSeatClaim(args: {
  seatsClaimed: number;
  seatCap: number;
  alreadyMember: boolean;
}): { granted: boolean; seatNo: number | null; reason: "ok" | "already_member" | "capacity" } {
  if (args.alreadyMember) return { granted: false, seatNo: null, reason: "already_member" };
  if (args.seatsClaimed >= args.seatCap) return { granted: false, seatNo: null, reason: "capacity" };
  return { granted: true, seatNo: args.seatsClaimed + 1, reason: "ok" };
}

export const YEAR_MS = 365 * DAY_MS;

/** Membership term: one year from verification (start basis pending owner confirmation). */
export function membershipExpiry(verifiedAtMs: number): number {
  return verifiedAtMs + YEAR_MS;
}

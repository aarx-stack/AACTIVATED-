/**
 * DEMO — NOT LIVE. Every name, sale, and date in this file is fictional and
 * generated with a fixed seed. This module is only ever loaded by the demo
 * store; nothing here touches production storage (D1) or real integrations.
 */
import type {
  Affiliate,
  ChallengeConfig,
  Membership,
  PendingVerification,
  QualPath,
  SnapshotRow,
  TeamEdge,
  Txn,
} from "@shared/types";
import { DEFAULT_POLICY } from "@shared/types";
import { DAY_MS, laWallClock, utcForLaWallClock, weekRange, monthRange } from "@shared/time";
import { totalsInRange } from "@shared/eligibility";
import { rank, type Entrant } from "@shared/leaderboard";
import { membershipExpiry } from "@shared/challenge";
import { mulberry32, pick, intBetween, chance } from "./rng";

/* ————— demo-only admin/ops record shapes ————— */

export interface ReviewItem {
  id: string;
  kind: "founders_pack" | "refund_review";
  affiliateId: string;
  txnId: string | null;
  submittedAt: string;
  status: "pending" | "approved" | "rejected";
  note: string;
}

export interface FailedEvent {
  id: string;
  source: "tapfiliate" | "sellavi";
  receivedAt: string;
  error: string;
  payloadRef: string;
  resolved: boolean;
}

export interface SyncRun {
  id: string;
  kind: "reconcile" | "webhook" | "import" | "retry";
  source: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  scanned: number;
  updated: number;
  discrepancies: number;
  note: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  reason: string;
}

export interface DemoCompPlan {
  /** Loud label so sample tiers can never read as real compensation terms. */
  label: string;
  tiers: { name: string; minMonthlyCents: number }[];
  rateNote: string;
}

export interface PersonaDef {
  affiliateId: string;
  tagline: string;
}

export interface DemoData {
  nowMs: number;
  config: ChallengeConfig;
  affiliates: Affiliate[];
  txnsByAffiliate: Map<string, Txn[]>;
  edges: TeamEdge[];
  /** Baseline verified members (43 of 50 seats). */
  memberships: Membership[];
  /** Seven more verified members used by the "seats full" demo toggle. */
  extraMemberships: Membership[];
  pending: PendingVerification[];
  monthlySnapshotPersonal: SnapshotRow[];
  monthlySnapshotTeam: SnapshotRow[];
  reviewQueue: ReviewItem[];
  failedEvents: FailedEvent[];
  syncRuns: SyncRun[];
  auditLog: AuditEntry[];
  compPlanByAffiliate: Map<string, DemoCompPlan>;
  personas: PersonaDef[];
}

/* ————— fictional roster ————— */

const NAMES = [
  "Marcus Webb", "Ava Chen", "Elena Rodriguez", "Trent Kowalski", "Dana Whitfield",
  "Chris Okafor", "Riley Nakamura", "Sofia Marín", "James Park", "Aaliyah Brooks",
  "Diego Fuentes", "Priya Raman", "Noah Bergström", "Zoe Laurent", "Malik Thompson",
  "Hana Suzuki", "Oliver Grant", "Isabela Costa", "Ethan Cole", "Mei Lin",
  "Gabriel Silva", "Nora Haddad", "Lucas Meyer", "Yara Aziz", "Tom Eriksen",
  "Grace Kim", "Andre Villanueva", "Bianca Rossi", "Sam Ortiz", "Kai Watanabe",
  "Omar Farouk", "Layla Hassan", "Felix Braun", "Amara Diallo", "Jonas Weber",
  "Camila Reyes", "Theo Dubois", "Ingrid Larsen", "Ravi Patel", "Selin Demir",
  "Mateo Alvarez", "Freya Jensen", "Kenji Tanaka", "Alicia Gomez", "Viktor Petrov",
  "Naomi Osei", "Leo Marchetti", "Tara Singh", "Emil Novak", "Rosa Delgado",
  "Owen McCarthy", "Yuki Mori", "Clara Fontaine", "Ibrahim Sall", "Maja Kowal",
  "Dante Russo", "Aisha Bello", "Nils Andersen", "Lucia Herrera", "Finn Gallagher",
  "Suki Chan", "Pablo Mendez", "Greta Voss", "Jamal Carter", "Petra Zeman",
  "Kofi Mensah", "Lena Fischer", "Marco Bellini", "Sana Iqbal", "Erik Lindqvist",
  "Talia Ben-Ami", "Hugo Fernandes", "Wren Ashford", "Nadia Popova", "Cedric Boone",
  "Mira Solberg",
] as const;

type Name = (typeof NAMES)[number];

const id = (i: number) => `aff-${String(i + 1).padStart(3, "0")}`;
const byName = new Map(NAMES.map((n, i) => [n, id(i)]));
export const affId = (name: Name): string => byName.get(name)!;

/* ————— transaction generation ————— */

const PRICE_POINTS = [8900, 12900, 14900, 19700, 24900, 29700, 34900, 44900];
const FOUNDERS_PACK_CENTS = 250_000;
const TAX_RATE = 0.086;

let txnSeq = 0;
let extSeq = 10_000;

interface OrderOpts {
  paymentStatus?: Txn["paymentStatus"];
  verified?: boolean;
  isFoundersPack?: boolean;
  discountCents?: number;
  refundedCents?: number;
  shipping?: boolean;
}

function order(
  affiliateId: string,
  occurredAtMs: number,
  grossCents: number,
  opts: OrderOpts = {},
): Txn {
  const status = opts.paymentStatus ?? "paid";
  const verified = opts.verified ?? (status === "paid" || status === "partially_refunded");
  const discount = opts.discountCents ?? 0;
  return {
    id: `tx-${++txnSeq}`,
    source: "tapfiliate",
    externalId: `sv-${++extSeq}`,
    orderRef: `#AR-${extSeq}`,
    affiliateId,
    occurredAt: new Date(occurredAtMs).toISOString(),
    currency: "USD",
    grossCents,
    discountCents: discount,
    taxCents: Math.round((grossCents - discount) * TAX_RATE),
    shippingCents: opts.shipping ? 1295 : 0,
    refundedCents: opts.refundedCents ?? 0,
    paymentStatus: status,
    paymentVerified: verified,
    paymentVerifiedVia: verified ? "sellavi" : null,
    isFoundersPack: opts.isFoundersPack ?? false,
    correctedBy: null,
  };
}

/** Generate paid+verified orders summing exactly to `targetCents` inside [fromMs, toMs). */
function ordersTotaling(
  rng: () => number,
  affiliateId: string,
  targetCents: number,
  fromMs: number,
  toMs: number,
  recentBias?: { fromMs: number; share: number },
): Txn[] {
  const out: Txn[] = [];
  let sum = 0;
  while (targetCents - sum > 6000) {
    const qty = chance(rng, 0.2) ? 2 : 1;
    let gross = pick(rng, PRICE_POINTS) * qty;
    if (gross > targetCents - sum) gross = targetCents - sum;
    const discount = chance(rng, 0.18) ? Math.round(gross * 0.1) : 0;
    const eligible = gross - discount;
    if (eligible <= 0) continue;
    let at: number;
    if (recentBias && chance(rng, recentBias.share) && recentBias.fromMs < toMs) {
      at = recentBias.fromMs + rng() * (toMs - recentBias.fromMs);
    } else {
      at = fromMs + rng() * (toMs - fromMs);
    }
    out.push(order(affiliateId, at, gross, { discountCents: discount, shipping: chance(rng, 0.3) }));
    sum += eligible;
  }
  const gap = targetCents - sum;
  if (gap > 0) {
    out.push(order(affiliateId, fromMs + rng() * (toMs - fromMs), gap));
  }
  return out;
}

/* ————— the dataset ————— */

export function buildDemoData(nowMs: number): DemoData {
  const rng = mulberry32(0xa4c7_2e6b);
  txnSeq = 0;
  extSeq = 10_000;

  // Sample launch date (DEMO ONLY — production keeps launchAt null until the
  // owner configures it): ~14 months ago at 9:00 AM LA time.
  const lw = laWallClock(nowMs - 420 * DAY_MS);
  const launchMs = utcForLaWallClock(lw.year, lw.month, lw.day, 9);

  const config: ChallengeConfig = {
    launchAt: new Date(launchMs).toISOString(),
    launchIsDemoSample: true,
    windowDays: 30,
    directTargetCents: 1_000_000,
    teamTargetCents: 5_000_000,
    foundersPackMinCents: FOUNDERS_PACK_CENTS,
    seatCap: 50,
    policy: DEFAULT_POLICY,
    policyConfirmed: false,
  };

  /* — cast assignments —
     openWindow: exact enrollment offsets, window still running
     earlyCohort: enrolled before launch → window was [launch, launch+30d]
     everyone else: enrolled ≥45 days ago, so windows closed before this month
     began (keeps monthly rankings visibly independent of challenge windows). */

  const openWindowPersonas: Name[] = ["Ava Chen", "Elena Rodriguez", "Chris Okafor", "Ibrahim Sall", "Suki Chan"];

  const earlyCohort: Name[] = [
    "Dana Whitfield", "Tom Eriksen", "Nora Haddad", "Lucas Meyer", "Yara Aziz",
    "Kai Watanabe", "Owen McCarthy", "Clara Fontaine", "Maja Kowal", "Dante Russo",
    "Nils Andersen", "Greta Voss",
  ];
  const earlyQuals: [Name, QualPath][] = [
    ["Dana Whitfield", "direct"], ["Tom Eriksen", "founders_pack"], ["Nora Haddad", "direct"],
    ["Lucas Meyer", "founders_pack"], ["Yara Aziz", "direct"], ["Kai Watanabe", "founders_pack"],
    ["Owen McCarthy", "founders_pack"], ["Clara Fontaine", "direct"],
  ];

  /** Verified in the last 24h — the extra seven that fill the pool to 50 under the demo toggle. */
  const extraNames: Name[] = [
    "Zoe Laurent", "Malik Thompson", "Hana Suzuki", "Oliver Grant",
    "Jonas Weber", "Selin Demir", "Mateo Alvarez",
  ];

  /** Never members: personas with non-member states, edge-case rows, kids with scripted volume. */
  const neverMembers = new Set<string>(
    ([
      "Ava Chen", "Elena Rodriguez", "Chris Okafor", "Trent Kowalski", "Riley Nakamura",
      "Ibrahim Sall", "Suki Chan", "Viktor Petrov", "Omar Farouk",
      "Freya Jensen", "Pablo Mendez", "Jamal Carter", "Aisha Bello",
      "Andre Villanueva", "Bianca Rossi", "Sam Ortiz", "Emil Novak", "Rosa Delgado",
      "Maja Kowal", "Dante Russo", "Nils Andersen", "Greta Voss",
    ] as Name[]).map(affId),
  );

  /* — enrollment dates — */
  const enrolledAtMs = new Map<string, number>();
  const setEnroll = (name: Name, ms: number) => enrolledAtMs.set(affId(name), ms);

  for (const n of earlyCohort) setEnroll(n, launchMs - intBetween(rng, 5, 180) * DAY_MS);

  setEnroll("Ava Chen", nowMs - 21 * DAY_MS);        // open window, ~9 days left
  setEnroll("Elena Rodriguez", nowMs - 12 * DAY_MS); // open window, FP pending
  setEnroll("Chris Okafor", nowMs - 6 * 3_600_000);  // enrolled today, not started
  setEnroll("Ibrahim Sall", nowMs - 26 * DAY_MS);    // open window, ~4 days left
  setEnroll("Suki Chan", nowMs - 8 * DAY_MS);        // open window, early days
  setEnroll("Trent Kowalski", nowMs - 75 * DAY_MS);  // window ended, not qualified

  // Persona members: pin enrollments so their membership state is stable
  // (qualified ≈ verified inside the last year → active membership).
  setEnroll("Marcus Webb", nowMs - 80 * DAY_MS);
  setEnroll("Diego Fuentes", nowMs - 120 * DAY_MS);
  setEnroll("Grace Kim", nowMs - 150 * DAY_MS);
  setEnroll("Tara Singh", nowMs - 200 * DAY_MS);

  for (const n of NAMES) {
    if (!enrolledAtMs.has(affId(n))) {
      setEnroll(n, launchMs + intBetween(rng, 3, 330) * DAY_MS);
    }
  }
  // Clamp every non-open-window enrollment to ≥45 days back.
  const openWindowIds = new Set(openWindowPersonas.map(affId));
  for (const [aid, ms] of enrolledAtMs) {
    if (!openWindowIds.has(aid) && ms > nowMs - 45 * DAY_MS) {
      enrolledAtMs.set(aid, nowMs - 45 * DAY_MS - intBetween(rng, 0, 90) * DAY_MS);
    }
  }
  // Team kids with scripted in-window volume must predate their leader's window.
  for (const [lead, kids] of [
    ["Grace Kim", ["Andre Villanueva", "Bianca Rossi", "Sam Ortiz"]],
    ["Tara Singh", ["Emil Novak", "Rosa Delgado"]],
  ] as [Name, Name[]][]) {
    const leadMs = enrolledAtMs.get(affId(lead))!;
    for (const kid of kids) {
      if (enrolledAtMs.get(affId(kid))! > leadMs - 5 * DAY_MS) {
        enrolledAtMs.set(affId(kid), leadMs - intBetween(rng, 5, 60) * DAY_MS);
      }
    }
  }

  const affiliates: Affiliate[] = NAMES.map((name, i) => ({
    id: id(i),
    tapfiliateId: `tap-${(100 + i).toString(36)}${(i * 7919) % 97}`,
    displayName: name,
    displayNameApproved: true,
    avatarUrl: null,
    status: name === "Viktor Petrov" ? "suspended" : "active",
    enrolledAt: new Date(enrolledAtMs.get(id(i))!).toISOString(),
  }));

  /* — team hierarchy (verified except Riley's) — */
  const E = (parent: Name, child: Name, verified = true): TeamEdge => ({
    parentId: affId(parent),
    childId: affId(child),
    verified,
    source: "tapfiliate_mlm",
  });
  const edges: TeamEdge[] = [
    E("Marcus Webb", "James Park"), E("Marcus Webb", "Priya Raman"), E("Marcus Webb", "Noah Bergström"),
    E("James Park", "Aaliyah Brooks"),
    E("Grace Kim", "Andre Villanueva"), E("Grace Kim", "Bianca Rossi"), E("Grace Kim", "Sam Ortiz"),
    E("Tara Singh", "Emil Novak"), E("Tara Singh", "Rosa Delgado"),
    E("Ava Chen", "Zoe Laurent"), E("Ava Chen", "Malik Thompson"),
    E("Sofia Marín", "Isabela Costa"), E("Sofia Marín", "Ethan Cole"), E("Sofia Marín", "Mei Lin"),
    E("Diego Fuentes", "Gabriel Silva"),
    E("Kenji Tanaka", "Alicia Gomez"), E("Kenji Tanaka", "Naomi Osei"), E("Kenji Tanaka", "Yuki Mori"),
    E("Riley Nakamura", "Hana Suzuki", false), E("Riley Nakamura", "Oliver Grant", false),
  ];

  /* — transactions — */
  const txnsByAffiliate = new Map<string, Txn[]>();
  const add = (t: Txn[] | Txn) => {
    for (const txn of Array.isArray(t) ? t : [t]) {
      const list = txnsByAffiliate.get(txn.affiliateId) ?? [];
      list.push(txn);
      txnsByAffiliate.set(txn.affiliateId, list);
    }
  };

  const month = monthRange(nowMs);
  const week = weekRange(nowMs);

  // Monthly volume ladder (month-to-date): podium at the top, long tail below.
  const monthlyTargets = new Map<string, number>();
  const setMonthly = (name: Name, cents: number) => monthlyTargets.set(affId(name), cents);
  setMonthly("Marcus Webb", 3_254_000);
  setMonthly("Sofia Marín", 2_791_000);
  setMonthly("James Park", 2_430_000);
  setMonthly("Grace Kim", 2_118_000);
  setMonthly("Kenji Tanaka", 1_842_000);
  setMonthly("Priya Raman", 1_565_000);
  setMonthly("Diego Fuentes", 1_390_000);
  setMonthly("Tara Singh", 1_247_000);
  setMonthly("Camila Reyes", 1_102_000);
  setMonthly("Ravi Patel", 986_000);
  setMonthly("Amara Diallo", 897_000);
  setMonthly("Theo Dubois", 815_000);
  setMonthly("Layla Hassan", 748_000);
  setMonthly("Felix Braun", 692_000);
  setMonthly("Riley Nakamura", 655_000);

  let tail = 610_000;
  for (const n of NAMES) {
    const aid = affId(n);
    if (monthlyTargets.has(aid)) continue;
    if (openWindowIds.has(aid) || aid === affId("Viktor Petrov")) continue;
    tail = Math.max(9_000, Math.round(tail * (0.82 + rng() * 0.08)));
    monthlyTargets.set(aid, tail);
  }

  for (const [aid, target] of monthlyTargets) {
    add(
      ordersTotaling(rng, aid, target, month.startMs, nowMs - 3_600_000, {
        fromMs: Math.max(week.startMs, month.startMs),
        share: 0.45,
      }),
    );
  }

  // Historical volume (before this month) → all-time depth. Open-window
  // personas are skipped: their in-window history is scripted exactly above.
  for (const a of affiliates) {
    if (openWindowIds.has(a.id)) continue;
    const enrolled = enrolledAtMs.get(a.id)!;
    const histStart = Math.max(enrolled, launchMs - 120 * DAY_MS);
    const histEnd = Math.min(month.startMs - DAY_MS, nowMs - 20 * DAY_MS);
    if (histEnd <= histStart) continue;
    const monthly = monthlyTargets.get(a.id) ?? 120_000;
    const hist = Math.round(monthly * (2.2 + rng() * 5.5));
    add(ordersTotaling(rng, a.id, hist, histStart, histEnd));
  }

  /* — open-window personas: exact in-window figures — */
  const avaStart = enrolledAtMs.get(affId("Ava Chen"))!;
  add(ordersTotaling(rng, affId("Ava Chen"), 742_000, avaStart, nowMs - 2 * 3_600_000, {
    fromMs: Math.max(week.startMs, avaStart),
    share: 0.5,
  }));
  add(ordersTotaling(rng, affId("Elena Rodriguez"), 285_000, enrolledAtMs.get(affId("Elena Rodriguez"))!, nowMs - 5 * 3_600_000));
  add(ordersTotaling(rng, affId("Ibrahim Sall"), 891_000, enrolledAtMs.get(affId("Ibrahim Sall"))!, nowMs - 8 * 3_600_000));
  add(ordersTotaling(rng, affId("Suki Chan"), 124_000, enrolledAtMs.get(affId("Suki Chan"))!, nowMs - 12 * 3_600_000));
  const trentStart = enrolledAtMs.get(affId("Trent Kowalski"))!;
  add(ordersTotaling(rng, affId("Trent Kowalski"), 418_000, trentStart, trentStart + 30 * DAY_MS - 3_600_000));

  // Elena's Founders Pack: bought 2 days ago via Zelle, payment not yet verified.
  const elenaPack = order(affId("Elena Rodriguez"), nowMs - 2 * DAY_MS, FOUNDERS_PACK_CENTS, {
    paymentStatus: "pending",
    verified: false,
    isFoundersPack: true,
  });
  add(elenaPack);

  // Omar's Founders Pack: also awaiting verification (second queue item).
  const omarPack = order(affId("Omar Farouk"), nowMs - 4 * DAY_MS, FOUNDERS_PACK_CENTS, {
    paymentStatus: "pending",
    verified: false,
    isFoundersPack: true,
  });
  add(omarPack);

  /* — demo ledger edge cases (excluded rows never shift rankings) — */
  add(order(affId("Lucia Herrera"), nowMs - 1.2 * DAY_MS, 29_700, { paymentStatus: "unpaid", verified: false }));
  add(order(affId("Finn Gallagher"), nowMs - 2.6 * DAY_MS, 44_900, { paymentStatus: "unpaid", verified: false }));
  add(order(affId("Petra Zeman"), nowMs - 0.4 * DAY_MS, 19_700, { paymentStatus: "pending", verified: false }));
  add(order(affId("Freya Jensen"), nowMs - 3.1 * DAY_MS, 34_900, { paymentStatus: "refunded", verified: false }));
  add(order(affId("Pablo Mendez"), nowMs - 5.4 * DAY_MS, 24_900, { paymentStatus: "refunded", verified: false }));
  add(order(affId("Jamal Carter"), nowMs - 1.8 * DAY_MS, 59_400, { paymentStatus: "partially_refunded", refundedCents: 29_700 }));
  add(order(affId("Aisha Bello"), nowMs - 4.2 * DAY_MS, 44_900, { paymentStatus: "partially_refunded", refundedCents: 14_900 }));

  // Diego: post-qualification refund → flagged for review, membership untouched.
  const diegoRefund = order(affId("Diego Fuentes"), nowMs - 40 * DAY_MS, 98_000, {
    paymentStatus: "refunded",
    verified: false,
  });
  add(diegoRefund);

  /* — qualification history —
     Baseline: 8 early-cohort members + 35 later members = 43 of 50 seats.
     Every qualification instant sits INSIDE that affiliate's own window;
     seat numbers are assigned strictly by verification-completion order. */

  interface Qual {
    affiliateId: string;
    path: QualPath;
    qualifiedAtMs: number;
    verifiedAtMs: number;
  }
  const quals: Qual[] = [];

  for (const [n, path] of earlyQuals) {
    const q = launchMs + intBetween(rng, 12, 28) * DAY_MS;
    quals.push({
      affiliateId: affId(n),
      path,
      qualifiedAtMs: q,
      verifiedAtMs: q + intBetween(rng, 1, 4) * DAY_MS,
    });
  }

  const earlyIds = new Set(earlyCohort.map(affId));
  const extraIds = new Set(extraNames.map(affId));
  const laterCandidates = NAMES.filter((n) => {
    const aid = affId(n);
    return !neverMembers.has(aid) && !earlyIds.has(aid) && !extraIds.has(aid);
  });
  const teamQualIds = new Set([affId("Grace Kim"), affId("Tara Singh")]);

  for (const n of laterCandidates.slice(0, 35)) {
    const aid = affId(n);
    const enrolled = enrolledAtMs.get(aid)!;
    const wStart = Math.max(enrolled, launchMs);
    const q = wStart + intBetween(rng, 8, 28) * DAY_MS;
    const path: QualPath = teamQualIds.has(aid) ? "team" : chance(rng, 0.42) ? "founders_pack" : "direct";
    quals.push({
      affiliateId: aid,
      path,
      qualifiedAtMs: q,
      verifiedAtMs: Math.min(q + intBetween(rng, 1, 5) * DAY_MS, nowMs - 2 * DAY_MS),
    });
  }

  quals.sort((a, b) => a.verifiedAtMs - b.verifiedAtMs);
  const memberships: Membership[] = quals.map((q, i) => ({
    affiliateId: q.affiliateId,
    seatNo: i + 1,
    path: q.path,
    qualifiedAt: new Date(q.qualifiedAtMs).toISOString(),
    verifiedAt: new Date(q.verifiedAtMs).toISOString(),
    membershipExpiresAt: new Date(membershipExpiry(q.verifiedAtMs)).toISOString(),
  }));

  // Seats-full toggle: 7 more FP members verified within the last 24h (long
  // manual-verification lag after in-window purchases).
  const extraMemberships: Membership[] = extraNames.map((n, i) => {
    const aid = affId(n);
    const wStart = Math.max(enrolledAtMs.get(aid)!, launchMs);
    const q = wStart + intBetween(rng, 6, 24) * DAY_MS;
    const v = nowMs - (24 - i * 3) * 3_600_000;
    add(order(aid, q, FOUNDERS_PACK_CENTS, { isFoundersPack: true, verified: true }));
    return {
      affiliateId: aid,
      seatNo: 44 + i,
      path: "founders_pack",
      qualifiedAt: new Date(q).toISOString(),
      verifiedAt: new Date(v).toISOString(),
      membershipExpiresAt: new Date(membershipExpiry(v)).toISOString(),
    };
  });

  // Consistent in-window evidence for every baseline member.
  for (const m of memberships) {
    const aid = m.affiliateId;
    const wStart = Math.max(enrolledAtMs.get(aid)!, launchMs);
    const qMs = Date.parse(m.qualifiedAt);
    if (m.path === "direct") {
      add(ordersTotaling(rng, aid, 1_000_000 + intBetween(rng, 4, 38) * 10_000, wStart, qMs));
    } else if (m.path === "founders_pack") {
      add(order(aid, qMs, FOUNDERS_PACK_CENTS, { isFoundersPack: true, verified: true }));
    }
  }
  // Team-path members: descendants produced the volume inside the leader's window.
  for (const [leadName, kids] of [
    ["Grace Kim", ["Andre Villanueva", "Bianca Rossi", "Sam Ortiz"]],
    ["Tara Singh", ["Emil Novak", "Rosa Delgado"]],
  ] as [Name, Name[]][]) {
    const m = memberships.find((x) => x.affiliateId === affId(leadName));
    if (!m) continue;
    const wStart = Math.max(enrolledAtMs.get(m.affiliateId)!, launchMs);
    const qMs = Date.parse(m.qualifiedAt);
    const per = Math.ceil(5_400_000 / kids.length);
    for (const kid of kids) add(ordersTotaling(rng, affId(kid), per, wStart, qMs));
  }

  /* — pending verifications — */
  const pending: PendingVerification[] = [
    {
      affiliateId: affId("Elena Rodriguez"),
      path: "founders_pack",
      submittedAt: elenaPack.occurredAt,
      txnId: elenaPack.id,
    },
    {
      affiliateId: affId("Omar Farouk"),
      path: "founders_pack",
      submittedAt: omarPack.occurredAt,
      txnId: omarPack.id,
    },
  ];

  /* — movement snapshots (monthly only; weekly deliberately has none) — */
  const policy = config.policy;
  const active = affiliates.filter((a) => a.status === "active");
  const personalEntrants: Entrant[] = active.map((a) => {
    const t = totalsInRange(txnsByAffiliate.get(a.id) ?? [], policy, month);
    return { affiliateId: a.id, displayName: a.displayName, amountCents: t.amountCents, orders: t.orders };
  });
  const currentPersonal = rank(personalEntrants);
  const perturb = (rows: { affiliateId: string }[]): SnapshotRow[] => {
    const ids = rows.map((r) => r.affiliateId);
    for (let i = 2; i + 1 < ids.length; i += 3) {
      const a = ids[i]!;
      ids[i] = ids[i + 1]!;
      ids[i + 1] = a;
    }
    ids.splice(7, 1); // yesterday's board didn't have this entrant → "NEW"
    return ids.map((affiliateId, idx) => ({ affiliateId, rank: idx + 1 }));
  };
  const monthlySnapshotPersonal = perturb(currentPersonal);

  const monthAmounts = new Map<string, number>();
  for (const a of active) {
    monthAmounts.set(a.id, totalsInRange(txnsByAffiliate.get(a.id) ?? [], policy, month).amountCents);
  }
  const teamEntrants: Entrant[] = active
    .filter((a) => edges.some((e) => e.parentId === a.id && e.verified))
    .map((a) => {
      let sum = monthAmounts.get(a.id) ?? 0;
      for (const e of edges) if (e.parentId === a.id && e.verified) sum += monthAmounts.get(e.childId) ?? 0;
      return { affiliateId: a.id, displayName: a.displayName, amountCents: sum, orders: 0 };
    });
  const monthlySnapshotTeam = perturb(rank(teamEntrants));

  /* — ops / integration demo records — */
  const iso = (ms: number) => new Date(ms).toISOString();
  const reviewQueue: ReviewItem[] = [
    {
      id: "rq-1", kind: "founders_pack", affiliateId: affId("Elena Rodriguez"), txnId: elenaPack.id,
      submittedAt: elenaPack.occurredAt, status: "pending",
      note: "Zelle payment reported by affiliate; awaiting payment confirmation.",
    },
    {
      id: "rq-2", kind: "founders_pack", affiliateId: affId("Omar Farouk"), txnId: omarPack.id,
      submittedAt: omarPack.occurredAt, status: "pending",
      note: "Founders Pack order placed; manual payment marked \"sent\" — unverified.",
    },
    {
      id: "rq-3", kind: "refund_review", affiliateId: affId("Diego Fuentes"), txnId: diegoRefund.id,
      submittedAt: iso(nowMs - 5 * DAY_MS), status: "pending",
      note: "Refund landed after qualification. No revocation policy configured — held for human review.",
    },
  ];

  const failedEvents: FailedEvent[] = [
    {
      id: "ev-9174", source: "tapfiliate", receivedAt: iso(nowMs - 6.5 * 3_600_000),
      error: "Conversion re-fetch returned 404 (deleted at source?)", payloadRef: "conversion 448121", resolved: false,
    },
    {
      id: "ev-9151", source: "sellavi", receivedAt: iso(nowMs - 1.9 * DAY_MS),
      error: "Order lookup timed out after 3 attempts", payloadRef: "order #AR-18744", resolved: false,
    },
  ];

  const syncRuns: SyncRun[] = [
    { id: "sr-1", kind: "reconcile", source: "tapfiliate", startedAt: iso(nowMs - 14 * 60_000), finishedAt: iso(nowMs - 13 * 60_000), ok: true, scanned: 412, updated: 3, discrepancies: 0, note: "Clean pass" },
    { id: "sr-2", kind: "webhook", source: "tapfiliate", startedAt: iso(nowMs - 52 * 60_000), finishedAt: iso(nowMs - 52 * 60_000), ok: true, scanned: 1, updated: 1, discrepancies: 0, note: "Conversion 448902 ingested" },
    { id: "sr-3", kind: "reconcile", source: "tapfiliate", startedAt: iso(nowMs - 4.2 * 3_600_000), finishedAt: iso(nowMs - 4.1 * 3_600_000), ok: true, scanned: 405, updated: 0, discrepancies: 0, note: "Clean pass" },
    { id: "sr-4", kind: "reconcile", source: "tapfiliate", startedAt: iso(nowMs - 3.1 * DAY_MS), finishedAt: iso(nowMs - 3.1 * DAY_MS + 40_000), ok: false, scanned: 122, updated: 0, discrepancies: 0, note: "Aborted: source API 502" },
    { id: "sr-5", kind: "import", source: "tapfiliate", startedAt: iso(launchMs - 2 * DAY_MS), finishedAt: iso(launchMs - 2 * DAY_MS + 8 * 60_000), ok: true, scanned: 1893, updated: 1893, discrepancies: 0, note: "Initial historical import (demo)" },
  ];

  const auditLog: AuditEntry[] = [
    {
      id: "au-1", at: iso(nowMs - 9 * DAY_MS), actor: "admin@aactivatedrx.com (demo)",
      action: "correction.payment_status", entity: "txn", entityId: "sv-10442",
      reason: "Zelle transfer never received after 7 days — order excluded until payment lands.",
    },
    {
      id: "au-2", at: iso(nowMs - 16 * DAY_MS), actor: "admin@aactivatedrx.com (demo)",
      action: "display_name.approved", entity: "affiliate", entityId: affId("Suki Chan"),
      reason: "Requested public name matches account identity.",
    },
    {
      id: "au-3", at: iso(launchMs - DAY_MS), actor: "admin@aactivatedrx.com (demo)",
      action: "challenge.launch_date.set", entity: "challenge_config", entityId: "1",
      reason: "SAMPLE launch date for demo build — production launch remains unconfigured.",
    },
  ];

  const compPlanByAffiliate = new Map<string, DemoCompPlan>([
    [
      affId("Marcus Webb"),
      {
        label: "SAMPLE PLAN — fictional tiers for layout preview only",
        tiers: [
          { name: "Launch", minMonthlyCents: 0 },
          { name: "Builder", minMonthlyCents: 1_500_000 },
          { name: "Elite", minMonthlyCents: 3_500_000 },
        ],
        rateNote: "Commission rates always come from the verified Tapfiliate program configuration — never estimated here.",
      },
    ],
  ]);

  const personas: PersonaDef[] = [
    { affiliateId: affId("Ava Chen"), tagline: "In progress — direct path 74%" },
    { affiliateId: affId("Marcus Webb"), tagline: "Qualified member · sample comp plan" },
    { affiliateId: affId("Elena Rodriguez"), tagline: "Founders Pack pending verification" },
    { affiliateId: affId("Chris Okafor"), tagline: "Enrolled today — not started" },
    { affiliateId: affId("Trent Kowalski"), tagline: "Window ended, not qualified" },
    { affiliateId: affId("Dana Whitfield"), tagline: "Membership expired (early cohort)" },
    { affiliateId: affId("Riley Nakamura"), tagline: "Team data not connected" },
  ];

  // Ledger reads newest-first everywhere.
  for (const list of txnsByAffiliate.values()) {
    list.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  }

  return {
    nowMs,
    config,
    affiliates,
    txnsByAffiliate,
    edges,
    memberships,
    extraMemberships,
    pending,
    monthlySnapshotPersonal,
    monthlySnapshotTeam,
    reviewQueue,
    failedEvents,
    syncRuns,
    auditLog,
    compPlanByAffiliate,
    personas,
  };
}

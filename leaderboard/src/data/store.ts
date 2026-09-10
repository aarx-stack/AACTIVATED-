/**
 * Demo store: in-memory only, seeded fixtures, mutations for the admin demo.
 * Production data lives in D1 behind the Worker API — the two never mix, and
 * nothing in this store can grant access to anything real.
 */
import type {
  Affiliate,
  ChallengeConfig,
  Membership,
  Movement,
  PendingVerification,
  PeriodType,
  Scope,
  Txn,
} from "@shared/types";
import {
  challengeStatus,
  challengeWindow,
  foundersPackProgress,
  membershipExpiry,
  type ChallengeStatus,
  type ChallengeWindow,
  type PathProgress,
} from "@shared/challenge";
import { eligibleAmount, totalsInRange } from "@shared/eligibility";
import { movement, rank, type Entrant } from "@shared/leaderboard";
import { periodRange, weekRange, DAY_MS, type PeriodRange } from "@shared/time";
import {
  buildDemoData,
  type AuditEntry,
  type DemoCompPlan,
  type DemoData,
  type PersonaDef,
  type ReviewItem,
} from "./fixtures";
import { mulberry32, pick } from "./rng";

export type ViewMode = "affiliate" | "admin";
export type SortKey = "sales" | "orders" | "name";
export type SortDir = "asc" | "desc";

export interface LeaderboardQuery {
  scope: Scope;
  period: PeriodType;
  page: number;
  pageSize: number;
  search: string;
  sort: SortKey;
  dir: SortDir;
}

export interface BoardRow {
  rank: number;
  affiliateId: string;
  displayName: string;
  amountCents: number;
  orders: number;
  movement: Movement | null;
  isMe: boolean;
}

export interface BoardResult {
  rows: BoardRow[];
  podium: BoardRow[];
  total: number;
  page: number;
  pageCount: number;
  hasSnapshot: boolean;
  /** Where the viewer sits on the unfiltered board (null when absent, e.g. team-disconnected). */
  me: { rank: number; page: number; amountCents: number } | null;
  /** Affiliates hidden from the team board because their team data is unverified. */
  disconnectedCount: number;
  range: PeriodRange;
}

export interface PerformanceVM {
  rank: number | null;
  rankMovement: Movement | null;
  personalMonthCents: number;
  personalOrders: number;
  teamMonthCents: number | null; // null = team data not connected
  teamOrders: number | null;
  spark: number[]; // 12 weekly buckets, oldest first
  compPlan: DemoCompPlan | null;
  tier: { current: string; next: string | null; toNextCents: number | null; pct: number } | null;
}

export interface ChallengeVM {
  status: ChallengeStatus;
  window: ChallengeWindow | null;
  progress: PathProgress;
  config: ChallengeConfig;
  seatsClaimed: number;
  seatCap: number;
  enrolledAtMs: number;
}

export interface RecognitionRow {
  affiliateId: string;
  displayName: string;
  seatNo: number;
  qualifiedAtMs: number;
  membershipExpiresAtMs: number;
  expired: boolean;
}

export interface AdminAffiliateRow {
  affiliate: Affiliate;
  monthCents: number;
  allTimeCents: number;
  teamMonthCents: number | null;
  state: ChallengeStatus["state"];
  window: ChallengeWindow | null;
  membership: Membership | null;
  enrolledAtMs: number;
}

export interface LedgerRow {
  txn: Txn;
  affiliateName: string;
  eligibleCents: number;
  eligible: boolean;
  reason: string | null;
}

export interface HierarchyNode {
  affiliate: Affiliate;
  verified: boolean; // the edge from parent to this node
  monthCents: number;
  children: HierarchyNode[];
}

type Listener = () => void;

export class DemoStore {
  data: DemoData;
  version = 0;
  loading = true;
  viewerId: string;
  view: ViewMode = "affiliate";
  seatsFull = false;
  syncError = false;
  lastSyncMs: number;
  failedRetryAtMs: number | null = null;
  lastSimulatedSale: { affiliateId: string; amountCents: number; atMs: number } | null = null;

  private listeners = new Set<Listener>();
  private saleRng = mulberry32(0x51e5);

  constructor() {
    this.data = buildDemoData(Date.now());
    this.viewerId = this.data.personas[0]!.affiliateId;
    this.lastSyncMs = Date.now() - 90_000;
    // Simulated initial fetch so loading skeletons are demonstrable.
    setTimeout(() => {
      this.loading = false;
      this.bump();
    }, 750);
    // Demo feed heartbeat: refresh the "last update" stamp every 60s.
    setInterval(() => {
      if (!this.syncError) {
        this.lastSyncMs = Date.now();
        this.bump();
      }
    }, 60_000);
  }

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private bump() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  /* ————— core lookups ————— */

  affiliate(idArg: string): Affiliate {
    return this.data.affiliates.find((a) => a.id === idArg)!;
  }

  txns(affiliateId: string): Txn[] {
    return this.data.txnsByAffiliate.get(affiliateId) ?? [];
  }

  memberships(): Membership[] {
    return this.seatsFull
      ? [...this.data.memberships, ...this.data.extraMemberships]
      : this.data.memberships;
  }

  seatsClaimed(): number {
    return this.memberships().length;
  }

  membershipOf(affiliateId: string): Membership | null {
    return this.memberships().find((m) => m.affiliateId === affiliateId) ?? null;
  }

  pendingOf(affiliateId: string): PendingVerification | null {
    return this.data.pending.find((p) => p.affiliateId === affiliateId) ?? null;
  }

  launchMs(): number | null {
    return this.data.config.launchAt ? Date.parse(this.data.config.launchAt) : null;
  }

  /* ————— team graph ————— */

  private verifiedChildren(): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const e of this.data.edges) {
      if (!e.verified) continue;
      const list = map.get(e.parentId) ?? [];
      list.push(e.childId);
      map.set(e.parentId, list);
    }
    return map;
  }

  /** Verified descendant set, or null when the subtree touches an unverified edge. */
  descendantsOf(affiliateId: string): Set<string> | null {
    const unverifiedParents = new Set(
      this.data.edges.filter((e) => !e.verified).map((e) => e.parentId),
    );
    const children = this.verifiedChildren();
    if (unverifiedParents.has(affiliateId)) return null;
    const out = new Set<string>();
    const stack = [...(children.get(affiliateId) ?? [])];
    while (stack.length) {
      const cur = stack.pop()!;
      if (out.has(cur) || cur === affiliateId) continue;
      out.add(cur);
      if (unverifiedParents.has(cur)) return null;
      for (const c of children.get(cur) ?? []) stack.push(c);
    }
    return out;
  }

  /** Team totals over a range (sample policy: self + verified descendants). Null = not connected. */
  teamTotalsInRange(
    affiliateId: string,
    range: { startMs: number; endMs: number | null },
  ): { amountCents: number; orders: number } | null {
    const desc = this.descendantsOf(affiliateId);
    if (desc === null) return null;
    const policy = this.data.config.policy;
    let amountCents = 0;
    let orders = 0;
    for (const idArg of [affiliateId, ...desc]) {
      const t = totalsInRange(this.txns(idArg), policy, range);
      amountCents += t.amountCents;
      orders += t.orders;
    }
    return { amountCents, orders };
  }

  /* ————— leaderboard ————— */

  board(q: LeaderboardQuery): BoardResult {
    const range = periodRange(q.period, Date.now());
    const policy = this.data.config.policy;
    const active = this.data.affiliates.filter((a) => a.status === "active");

    let entrants: Entrant[] = [];
    let disconnectedCount = 0;

    if (q.scope === "personal") {
      entrants = active.map((a) => {
        const t = totalsInRange(this.txns(a.id), policy, range);
        return { affiliateId: a.id, displayName: a.displayName, amountCents: t.amountCents, orders: t.orders };
      });
    } else {
      for (const a of active) {
        const t = this.teamTotalsInRange(a.id, range);
        if (t === null) {
          disconnectedCount++;
          continue;
        }
        entrants.push({ affiliateId: a.id, displayName: a.displayName, amountCents: t.amountCents, orders: t.orders });
      }
    }

    const ranked = rank(entrants);

    // Movement only where a comparable snapshot exists (demo: monthly only).
    let moves: Map<string, Movement> | null = null;
    if (q.period === "monthly") {
      const snap =
        q.scope === "personal" ? this.data.monthlySnapshotPersonal : this.data.monthlySnapshotTeam;
      moves = movement(ranked, snap);
    }

    const toRow = (r: (typeof ranked)[number]): BoardRow => ({
      rank: r.rank,
      affiliateId: r.affiliateId,
      displayName: r.displayName,
      amountCents: r.amountCents,
      orders: r.orders,
      movement: moves?.get(r.affiliateId) ?? null,
      isMe: r.affiliateId === this.viewerId,
    });

    const all = ranked.map(toRow);
    const podium = all.slice(0, 3);

    const meIdx = all.findIndex((r) => r.isMe);
    const me =
      meIdx >= 0
        ? { rank: all[meIdx]!.rank, page: Math.floor(meIdx / q.pageSize) + 1, amountCents: all[meIdx]!.amountCents }
        : null;

    const needle = q.search.trim().toLowerCase();
    let filtered = needle
      ? all.filter((r) => r.displayName.toLowerCase().includes(needle))
      : all;

    if (q.sort === "name") {
      filtered = [...filtered].sort((a, b) =>
        q.dir === "asc" ? a.displayName.localeCompare(b.displayName) : b.displayName.localeCompare(a.displayName),
      );
    } else if (q.sort === "orders") {
      filtered = [...filtered].sort((a, b) => (q.dir === "asc" ? a.orders - b.orders : b.orders - a.orders));
    } else if (q.dir === "asc") {
      filtered = [...filtered].reverse();
    }

    const pageCount = Math.max(1, Math.ceil(filtered.length / q.pageSize));
    const page = Math.min(q.page, pageCount);
    const rows = filtered.slice((page - 1) * q.pageSize, page * q.pageSize);

    return {
      rows,
      podium,
      total: filtered.length,
      page,
      pageCount,
      hasSnapshot: moves !== null,
      me,
      disconnectedCount,
      range,
    };
  }

  /* ————— my performance ————— */

  performance(affiliateId: string): PerformanceVM {
    const nowMs = Date.now();
    const month = periodRange("monthly", nowMs);
    const policy = this.data.config.policy;
    const personal = totalsInRange(this.txns(affiliateId), policy, month);
    const team = this.teamTotalsInRange(affiliateId, month);

    const boardResult = this.board({
      scope: "personal", period: "monthly", page: 1, pageSize: 10, search: "", sort: "sales", dir: "desc",
    });
    const myRank = boardResult.me?.rank ?? null;
    let rankMovement: Movement | null = null;
    if (myRank && boardResult.hasSnapshot) {
      const snap = this.data.monthlySnapshotPersonal.find((s) => s.affiliateId === affiliateId);
      rankMovement = snap ? snap.rank - myRank : "new";
    }

    // 12 weekly buckets ending this week.
    const spark: number[] = [];
    const week = weekRange(nowMs);
    for (let i = 11; i >= 0; i--) {
      const start = week.startMs - i * 7 * DAY_MS;
      const end = start + 7 * DAY_MS;
      spark.push(totalsInRange(this.txns(affiliateId), policy, { startMs: start, endMs: end }).amountCents);
    }

    const compPlan = this.data.compPlanByAffiliate.get(affiliateId) ?? null;
    let tier: PerformanceVM["tier"] = null;
    if (compPlan) {
      const sorted = [...compPlan.tiers].sort((a, b) => a.minMonthlyCents - b.minMonthlyCents);
      let current = sorted[0]!;
      let next: (typeof sorted)[number] | null = null;
      for (const t of sorted) {
        if (personal.amountCents >= t.minMonthlyCents) current = t;
      }
      const idx = sorted.indexOf(current);
      next = sorted[idx + 1] ?? null;
      tier = {
        current: current.name,
        next: next?.name ?? null,
        toNextCents: next ? Math.max(0, next.minMonthlyCents - personal.amountCents) : null,
        pct: next ? Math.min(1, personal.amountCents / next.minMonthlyCents) : 1,
      };
    }

    return {
      rank: myRank,
      rankMovement,
      personalMonthCents: personal.amountCents,
      personalOrders: personal.orders,
      teamMonthCents: team?.amountCents ?? null,
      teamOrders: team?.orders ?? null,
      spark,
      compPlan,
      tier,
    };
  }

  /* ————— challenge ————— */

  challenge(affiliateId: string): ChallengeVM {
    const nowMs = Date.now();
    const cfg = this.data.config;
    const enrolledAtMs = Date.parse(this.affiliate(affiliateId).enrolledAt);
    const window = challengeWindow(enrolledAtMs, this.launchMs(), cfg.windowDays);

    const winRange = window ? { startMs: window.startMs, endMs: window.endMs } : null;
    const directCents = winRange
      ? totalsInRange(this.txns(affiliateId), cfg.policy, winRange).amountCents
      : 0;
    const disconnected = this.descendantsOf(affiliateId) === null;
    let teamCents: number | null = null;
    if (!disconnected) {
      teamCents = winRange ? (this.teamTotalsInRange(affiliateId, winRange)?.amountCents ?? 0) : 0;
    }
    const progress: PathProgress = {
      directCents,
      teamCents,
      foundersPack: foundersPackProgress(this.txns(affiliateId), cfg, window),
    };

    const status = challengeStatus(
      {
        nowMs,
        window,
        membership: this.membershipOf(affiliateId),
        pending: this.pendingOf(affiliateId),
        seatsClaimed: this.seatsClaimed(),
        seatCap: cfg.seatCap,
        progress,
      },
      cfg,
    );

    return {
      status,
      window,
      progress,
      config: cfg,
      seatsClaimed: this.seatsClaimed(),
      seatCap: cfg.seatCap,
      enrolledAtMs,
    };
  }

  /* ————— recognition ————— */

  recognition(): RecognitionRow[] {
    const nowMs = Date.now();
    return this.memberships()
      .map((m) => ({
        affiliateId: m.affiliateId,
        displayName: this.affiliate(m.affiliateId).displayName,
        seatNo: m.seatNo,
        qualifiedAtMs: Date.parse(m.qualifiedAt),
        membershipExpiresAtMs: Date.parse(m.membershipExpiresAt),
        expired: nowMs >= Date.parse(m.membershipExpiresAt),
      }))
      .sort((a, b) => a.seatNo - b.seatNo);
  }

  /* ————— admin ————— */

  adminAffiliates(search: string, status: "all" | Affiliate["status"]): AdminAffiliateRow[] {
    const nowMs = Date.now();
    const month = periodRange("monthly", nowMs);
    const all = periodRange("alltime", nowMs);
    const needle = search.trim().toLowerCase();
    return this.data.affiliates
      .filter((a) => (status === "all" ? true : a.status === status))
      .filter((a) => !needle || a.displayName.toLowerCase().includes(needle) || a.id.includes(needle))
      .map((a) => {
        const ch = this.challenge(a.id);
        return {
          affiliate: a,
          monthCents: totalsInRange(this.txns(a.id), this.data.config.policy, month).amountCents,
          allTimeCents: totalsInRange(this.txns(a.id), this.data.config.policy, all).amountCents,
          teamMonthCents: this.teamTotalsInRange(a.id, month)?.amountCents ?? null,
          state: ch.status.state,
          window: ch.window,
          membership: this.membershipOf(a.id),
          enrolledAtMs: Date.parse(a.enrolledAt),
        };
      })
      .sort((a, b) => b.monthCents - a.monthCents);
  }

  ledger(filter: { payment: "all" | Txn["paymentStatus"]; eligibility: "all" | "eligible" | "excluded"; search: string }, page: number, pageSize: number) {
    const policy = this.data.config.policy;
    const rows: LedgerRow[] = [];
    for (const [aid, txns] of this.data.txnsByAffiliate) {
      const name = this.affiliate(aid).displayName;
      for (const txn of txns) {
        const r = eligibleAmount(txn, policy);
        rows.push({
          txn,
          affiliateName: name,
          eligibleCents: r.amountCents,
          eligible: r.eligible,
          reason: r.reason,
        });
      }
    }
    rows.sort((a, b) => Date.parse(b.txn.occurredAt) - Date.parse(a.txn.occurredAt));
    const needle = filter.search.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (filter.payment !== "all" && r.txn.paymentStatus !== filter.payment) return false;
      if (filter.eligibility === "eligible" && !r.eligible) return false;
      if (filter.eligibility === "excluded" && r.eligible) return false;
      if (
        needle &&
        !r.affiliateName.toLowerCase().includes(needle) &&
        !r.txn.externalId.toLowerCase().includes(needle) &&
        !(r.txn.orderRef ?? "").toLowerCase().includes(needle)
      )
        return false;
      return true;
    });
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    const p = Math.min(page, pageCount);
    return { rows: filtered.slice((p - 1) * pageSize, p * pageSize), total: filtered.length, page: p, pageCount };
  }

  queue(): (ReviewItem & { affiliateName: string; txn: Txn | null })[] {
    return this.data.reviewQueue
      .filter((r) => r.status === "pending")
      .map((r) => ({
        ...r,
        affiliateName: this.affiliate(r.affiliateId).displayName,
        txn: r.txnId ? this.findTxn(r.txnId) : null,
      }));
  }

  findTxn(txnId: string): Txn | null {
    for (const list of this.data.txnsByAffiliate.values()) {
      const t = list.find((x) => x.id === txnId);
      if (t) return t;
    }
    return null;
  }

  hierarchy(): HierarchyNode[] {
    const month = periodRange("monthly", Date.now());
    const childrenAll = new Map<string, { id: string; verified: boolean }[]>();
    const hasParent = new Set<string>();
    for (const e of this.data.edges) {
      const list = childrenAll.get(e.parentId) ?? [];
      list.push({ id: e.childId, verified: e.verified });
      childrenAll.set(e.parentId, list);
      hasParent.add(e.childId);
    }
    const build = (idArg: string, verified: boolean, seen: Set<string>): HierarchyNode => ({
      affiliate: this.affiliate(idArg),
      verified,
      monthCents: totalsInRange(this.txns(idArg), this.data.config.policy, month).amountCents,
      children: (childrenAll.get(idArg) ?? [])
        .filter((c) => !seen.has(c.id))
        .map((c) => build(c.id, c.verified, new Set([...seen, idArg]))),
    });
    return [...childrenAll.keys()]
      .filter((idArg) => !hasParent.has(idArg))
      .map((idArg) => build(idArg, true, new Set()))
      .sort((a, b) => b.monthCents - a.monthCents);
  }

  integrations() {
    return {
      tapfiliate: {
        mode: "demo" as const,
        connected: false,
        lastSyncMs: this.lastSyncMs,
        note: "Demo feed — no credentials configured. Adapter ready in worker/adapters/tapfiliate.ts.",
      },
      sellavi: {
        mode: "manual" as const,
        connected: false,
        note: "Payment verification runs through the admin review queue until a Sellavi integration is confirmed.",
      },
      failedEvents: this.data.failedEvents.filter((e) => !e.resolved),
      syncRuns: [...this.data.syncRuns].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)),
    };
  }

  audit(): AuditEntry[] {
    return [...this.data.auditLog].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }

  personas(): (PersonaDef & { name: string })[] {
    return this.data.personas.map((p) => ({ ...p, name: this.affiliate(p.affiliateId).displayName }));
  }

  /* ————— exports (permitted fields only — never customer data) ————— */

  exportCsv(kind: "affiliates" | "ledger"): { filename: string; content: string } {
    const esc = (v: string | number | null) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
    };
    if (kind === "affiliates") {
      const rows = this.adminAffiliates("", "all");
      const header = "affiliate_id,display_name,status,enrolled_at_utc,month_eligible_usd,alltime_eligible_usd,team_month_usd,challenge_state,seat_no,membership_expires_utc";
      const body = rows.map((r) =>
        [
          r.affiliate.id, esc(r.affiliate.displayName), r.affiliate.status, r.affiliate.enrolledAt,
          (r.monthCents / 100).toFixed(2), (r.allTimeCents / 100).toFixed(2),
          r.teamMonthCents === null ? "" : (r.teamMonthCents / 100).toFixed(2),
          r.state, r.membership?.seatNo ?? "", r.membership?.membershipExpiresAt ?? "",
        ].join(","),
      );
      return { filename: "aactivated-affiliates-demo.csv", content: [header, ...body].join("\n") };
    }
    const { rows } = this.ledger({ payment: "all", eligibility: "all", search: "" }, 1, 100_000);
    const header = "txn_external_id,order_ref,source,affiliate_id,affiliate_name,occurred_at_utc,gross_usd,discount_usd,tax_usd,shipping_usd,refunded_usd,payment_status,payment_verified,eligible,eligible_usd,exclusion_reason,founders_pack";
    const body = rows.map((r) =>
      [
        r.txn.externalId, esc(r.txn.orderRef), r.txn.source, r.txn.affiliateId, esc(r.affiliateName), r.txn.occurredAt,
        (r.txn.grossCents / 100).toFixed(2), (r.txn.discountCents / 100).toFixed(2), (r.txn.taxCents / 100).toFixed(2),
        (r.txn.shippingCents / 100).toFixed(2), (r.txn.refundedCents / 100).toFixed(2),
        r.txn.paymentStatus, String(r.txn.paymentVerified), String(r.eligible), (r.eligibleCents / 100).toFixed(2),
        r.reason ?? "", String(r.txn.isFoundersPack),
      ].join(","),
    );
    return { filename: "aactivated-ledger-demo.csv", content: [header, ...body].join("\n") };
  }

  /* ————— demo controls / mutations ————— */

  setViewer(affiliateId: string) {
    this.viewerId = affiliateId;
    this.bump();
  }

  setView(view: ViewMode) {
    this.view = view;
    this.bump();
  }

  setSeatsFull(on: boolean) {
    this.seatsFull = on;
    this.bump();
  }

  setSyncError(on: boolean) {
    this.syncError = on;
    if (!on) {
      this.failedRetryAtMs = null;
      this.lastSyncMs = Date.now();
    }
    this.bump();
  }

  refreshNow() {
    if (this.syncError) {
      this.failedRetryAtMs = Date.now();
    } else {
      this.lastSyncMs = Date.now();
    }
    this.bump();
  }

  /** Demo-only: post one new verified sale to a random leader so updates are visible on demand. */
  simulateSale(): { affiliateId: string; name: string; amountCents: number } {
    // Exclude open-window personas (Ava/Elena/Chris) so their scripted
    // challenge figures stay exact for the walkthrough.
    const candidates = this.board({
      scope: "personal", period: "monthly", page: 1, pageSize: 12, search: "", sort: "sales", dir: "desc",
    }).rows.filter((r) => !["aff-002", "aff-003", "aff-006"].includes(r.affiliateId));
    const target = pick(this.saleRng, candidates);
    const amountCents = pick(this.saleRng, [14900, 19700, 24900, 29700, 34900, 44900]);
    const list = this.data.txnsByAffiliate.get(target.affiliateId)!;
    list.unshift({
      id: `tx-live-${Date.now()}`,
      source: "tapfiliate",
      externalId: `sv-live-${Date.now()}`,
      orderRef: `#AR-${Math.floor(20000 + this.saleRng() * 999)}`,
      affiliateId: target.affiliateId,
      occurredAt: new Date().toISOString(),
      currency: "USD",
      grossCents: amountCents,
      discountCents: 0,
      taxCents: Math.round(amountCents * 0.086),
      shippingCents: 0,
      refundedCents: 0,
      paymentStatus: "paid",
      paymentVerified: true,
      paymentVerifiedVia: "sellavi",
      isFoundersPack: false,
      correctedBy: null,
    });
    this.lastSyncMs = Date.now();
    this.lastSimulatedSale = { affiliateId: target.affiliateId, amountCents, atMs: Date.now() };
    this.bump();
    return { affiliateId: target.affiliateId, name: target.displayName, amountCents };
  }

  private audit_(action: string, entity: string, entityId: string, reason: string) {
    this.data.auditLog.push({
      id: `au-${this.data.auditLog.length + 1}-${Date.now()}`,
      at: new Date().toISOString(),
      actor: "admin (demo preview)",
      action,
      entity,
      entityId,
      reason,
    });
  }

  /** Approve a queue item. Founders-pack approvals claim a seat atomically-in-spirit (capacity checked at claim). */
  approve(reviewId: string, reason: string): { ok: boolean; message: string } {
    const item = this.data.reviewQueue.find((r) => r.id === reviewId && r.status === "pending");
    if (!item) return { ok: false, message: "Item not found" };

    if (item.kind === "refund_review") {
      item.status = "approved";
      this.audit_("refund_review.resolved", "review", item.id, reason);
      this.bump();
      return { ok: true, message: "Refund reviewed — membership unchanged." };
    }

    const txn = item.txnId ? this.findTxn(item.txnId) : null;
    if (txn) {
      txn.paymentStatus = "paid";
      txn.paymentVerified = true;
      txn.paymentVerifiedVia = "admin";
    }
    const already = this.membershipOf(item.affiliateId);
    if (already) {
      item.status = "approved";
      this.bump();
      return { ok: true, message: "Payment verified — affiliate already holds a seat." };
    }
    if (this.seatsClaimed() >= this.data.config.seatCap) {
      // Payment verified, but the pool filled first: capacity is authoritative.
      this.data.pending = this.data.pending.filter((p) => p.affiliateId !== item.affiliateId);
      item.status = "approved";
      this.audit_("founders_pack.verified.capacity_reached", "review", item.id, reason);
      this.bump();
      return { ok: false, message: "Payment verified, but all 50 seats are claimed — affiliate marked Capacity reached." };
    }
    // seatsFull toggle would have hit the capacity branch above, so a grant
    // can only land in the baseline list.
    const verifiedAtMs = Date.now();
    this.data.memberships.push({
      affiliateId: item.affiliateId,
      seatNo: this.seatsClaimed() + 1,
      path: item.kind === "founders_pack" ? "founders_pack" : "direct",
      qualifiedAt: txn?.occurredAt ?? new Date(verifiedAtMs).toISOString(),
      verifiedAt: new Date(verifiedAtMs).toISOString(),
      membershipExpiresAt: new Date(membershipExpiry(verifiedAtMs)).toISOString(),
    });
    this.data.pending = this.data.pending.filter((p) => p.affiliateId !== item.affiliateId);
    item.status = "approved";
    this.audit_("founders_pack.verified", "affiliate", item.affiliateId, reason);
    this.bump();
    return { ok: true, message: `Verified — seat ${this.seatsClaimed()} of ${this.data.config.seatCap} claimed.` };
  }

  reject(reviewId: string, reason: string): { ok: boolean; message: string } {
    const item = this.data.reviewQueue.find((r) => r.id === reviewId && r.status === "pending");
    if (!item) return { ok: false, message: "Item not found" };
    item.status = "rejected";
    this.data.pending = this.data.pending.filter((p) => p.affiliateId !== item.affiliateId);
    this.audit_(`${item.kind}.rejected`, "review", item.id, reason);
    this.bump();
    return { ok: true, message: "Rejected — affiliate status recomputed." };
  }

  /** Audited correction. `reason` is mandatory by construction. */
  correctTxn(
    txnId: string,
    change: { paymentStatus?: Txn["paymentStatus"]; paymentVerified?: boolean; refundedCents?: number },
    reason: string,
  ): { ok: boolean; message: string } {
    const txn = this.findTxn(txnId);
    if (!txn) return { ok: false, message: "Transaction not found" };
    if (!reason.trim()) return { ok: false, message: "A reason is required" };
    if (change.paymentStatus !== undefined) txn.paymentStatus = change.paymentStatus;
    if (change.paymentVerified !== undefined) {
      txn.paymentVerified = change.paymentVerified;
      txn.paymentVerifiedVia = change.paymentVerified ? "admin" : null;
    }
    if (change.refundedCents !== undefined) txn.refundedCents = change.refundedCents;
    txn.correctedBy = "admin (demo preview)";
    this.audit_("correction.applied", "txn", txn.externalId, reason);
    this.bump();
    return { ok: true, message: `Correction applied to ${txn.externalId}.` };
  }

  setLaunchDate(isoOrNull: string | null, reason: string): { ok: boolean; message: string } {
    if (!reason.trim()) return { ok: false, message: "A reason is required" };
    this.data.config = {
      ...this.data.config,
      launchAt: isoOrNull,
      launchIsDemoSample: isoOrNull !== null,
    };
    this.audit_("challenge.launch_date.set", "challenge_config", "1", reason);
    this.bump();
    return { ok: true, message: isoOrNull ? "Sample launch date updated (demo store only)." : "Launch date cleared — production behavior: “Launch date pending.”" };
  }

  retryFailedEvent(idArg: string) {
    const ev = this.data.failedEvents.find((e) => e.id === idArg);
    if (!ev) return;
    ev.resolved = true;
    this.data.syncRuns.unshift({
      id: `sr-retry-${Date.now()}`,
      kind: "retry",
      source: ev.source,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      ok: true,
      scanned: 1,
      updated: 1,
      discrepancies: 0,
      note: `Replayed ${ev.payloadRef}`,
    });
    this.audit_("failed_event.retried", "event", ev.id, "Manual replay from admin console (demo).");
    this.bump();
  }
}

export const store = new DemoStore();

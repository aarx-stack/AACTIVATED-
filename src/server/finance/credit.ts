/**
 * Credit Builder: the Finance division that builds the company's credit and business profile.
 * Executive-only, like the rest of Finance.
 *
 * - The plan: standard business-credit steps (entity, EIN, bank account, D-U-N-S, bureau
 *   profiles, reporting vendor accounts, monitoring), each with a status and notes.
 * - Tradelines: accounts that report to the business credit bureaus.
 * - Scores: entered by hand from the bureaus' reports. Nothing connects to a bureau.
 * Never store full account numbers or the full EIN here.
 */
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { CreditCategory } from "@/generated/prisma/enums";
import {
  CreditBureau,
  CreditStepStatus,
  TradelineKind,
  TradelineStatus,
} from "@/generated/prisma/enums";
import { db, type Db, type DbClient } from "@/lib/db";
import { recordAudit } from "@/server/audit/audit";
import { CREDIT_PLAN } from "./credit-plan";

export { CREDIT_PLAN };
import { authorize, ForbiddenError, type Actor } from "@/server/authz/permissions";

export const CATEGORY_LABEL: Record<CreditCategory, string> = {
  FOUNDATION: "Business foundation",
  BUREAUS: "Credit bureau profiles",
  TRADELINES: "Accounts that report",
  MONITORING: "Monitoring",
};

export const BUREAU: Record<
  CreditBureau,
  { label: string; min: number; max: number; good: string }
> = {
  DNB_PAYDEX: { label: "D&B Paydex", min: 0, max: 100, good: "80 or higher means on-time payment" },
  EXPERIAN_INTELLISCORE: {
    label: "Experian Intelliscore Plus",
    min: 1,
    max: 100,
    good: "Higher is lower risk",
  },
  EQUIFAX_BUSINESS: {
    label: "Equifax Business Credit Risk",
    min: 101,
    max: 992,
    good: "Higher is lower risk",
  },
  FICO_SBSS: { label: "FICO SBSS", min: 0, max: 300, good: "Many lenders look for 160+" },
};

export const TRADELINE_KIND: Record<TradelineKind, string> = {
  VENDOR_NET30: "Vendor account (Net-30)",
  CREDIT_CARD: "Business credit card",
  LINE_OF_CREDIT: "Line of credit",
  LOAN: "Loan",
};

export const REPORTS_TO = ["Dun & Bradstreet", "Experian", "Equifax"] as const;

/** Adds any plan steps that are missing (new installs and existing databases). */
async function ensurePlan(client: DbClient) {
  const existing = new Set(
    (await client.creditMilestone.findMany({ select: { key: true } })).map((m) => m.key),
  );
  const missing = CREDIT_PLAN.map((m, i) => ({ ...m, sortOrder: i })).filter(
    (m) => !existing.has(m.key),
  );
  if (missing.length)
    await client.creditMilestone.createMany({ data: missing, skipDuplicates: true });
}

export async function getCreditBuilder(actor: Actor, client: Db = db) {
  authorize(actor, "credit.manage");
  await ensurePlan(client);
  const [milestones, tradelines, scores, division] = await Promise.all([
    client.creditMilestone.findMany({ orderBy: { sortOrder: "asc" } }),
    client.tradeline.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }] }),
    client.creditScore.findMany({ orderBy: { recordedAt: "desc" }, take: 120 }),
    client.department.findUnique({
      where: { slug: "credit-builder" },
      include: {
        agents: {
          orderBy: { name: "asc" },
          select: { id: true, name: true, title: true, status: true, currentFocus: true },
        },
      },
    }),
  ]);
  const latest = Object.fromEntries(
    (Object.keys(BUREAU) as CreditBureau[]).map((b) => {
      const series = scores.filter((s) => s.bureau === b);
      return [b, { latest: series[0] ?? null, previous: series[1] ?? null }];
    }),
  ) as Record<
    CreditBureau,
    { latest: (typeof scores)[number] | null; previous: (typeof scores)[number] | null }
  >;
  const done = milestones.filter((m) => m.status === CreditStepStatus.DONE).length;
  const reporting = tradelines.filter(
    (t) => t.status === TradelineStatus.OPEN && t.reportsTo.length > 0,
  );
  return {
    milestones,
    tradelines,
    scores,
    latest,
    progress: { done, total: milestones.length },
    reportingAccounts: reporting.length,
    agents: division?.agents ?? [],
  };
}

export const milestoneSchema = z.object({
  id: z.string().min(1),
  status: z.nativeEnum(CreditStepStatus),
  notes: z.string().trim().max(2000).default(""),
});

/** Long digit runs look like account numbers or an EIN: refuse them. */
function refuseNumbers(text: string) {
  if (/\d[\d\s-]{7,}\d/.test(text)) {
    throw new ForbiddenError(
      "Leave out account numbers and the EIN. Note where they are kept instead.",
    );
  }
}

export async function updateMilestone(
  actor: Actor,
  input: z.input<typeof milestoneSchema>,
  client: Db = db,
) {
  authorize(actor, "credit.manage");
  const data = milestoneSchema.parse(input);
  refuseNumbers(data.notes);
  const before = await client.creditMilestone.findUnique({ where: { id: data.id } });
  if (!before) throw new ForbiddenError("That step does not exist.");
  return client.$transaction(async (tx) => {
    const updated = await tx.creditMilestone.update({
      where: { id: data.id },
      data: {
        status: data.status,
        notes: data.notes,
        updatedById: actor.id,
        completedAt:
          data.status === CreditStepStatus.DONE ? (before.completedAt ?? new Date()) : null,
      },
    });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "credit.step_updated",
      entityType: "CreditMilestone",
      entityId: data.id,
      before: { status: before.status },
      after: { status: updated.status },
    });
    return updated;
  });
}

export const tradelineSchema = z.object({
  vendor: z.string().trim().min(2, "Who is the account with?").max(120),
  kind: z.nativeEnum(TradelineKind),
  reportsTo: z.array(z.enum(REPORTS_TO)).default([]),
  limitUsd: z.coerce.number().min(0).max(100_000_000).optional(),
  openedAt: z.coerce.date().optional(),
  status: z.nativeEnum(TradelineStatus).default(TradelineStatus.APPLIED),
  notes: z.string().trim().max(1000).default(""),
});

export async function addTradeline(
  actor: Actor,
  input: z.input<typeof tradelineSchema>,
  client: Db = db,
) {
  authorize(actor, "credit.manage");
  const data = tradelineSchema.parse(input);
  refuseNumbers(`${data.vendor} ${data.notes}`);
  return client.$transaction(async (tx) => {
    const t = await tx.tradeline.create({
      data: {
        vendor: data.vendor,
        kind: data.kind,
        reportsTo: data.reportsTo,
        limitUsd: data.limitUsd != null ? new Prisma.Decimal(data.limitUsd.toFixed(2)) : null,
        openedAt: data.openedAt ?? null,
        status: data.status,
        notes: data.notes,
        createdById: actor.id,
      },
    });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "credit.tradeline_added",
      entityType: "Tradeline",
      entityId: t.id,
      after: { vendor: t.vendor, kind: t.kind, status: t.status },
    });
    return t;
  });
}

export async function setTradelineStatus(
  actor: Actor,
  id: string,
  status: TradelineStatus,
  client: Db = db,
) {
  authorize(actor, "credit.manage");
  const next = z.nativeEnum(TradelineStatus).parse(status);
  const before = await client.tradeline.findUnique({ where: { id } });
  if (!before) throw new ForbiddenError("That account does not exist.");
  return client.$transaction(async (tx) => {
    const t = await tx.tradeline.update({
      where: { id },
      data: {
        status: next,
        openedAt: next === TradelineStatus.OPEN ? (before.openedAt ?? new Date()) : before.openedAt,
      },
    });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "credit.tradeline_updated",
      entityType: "Tradeline",
      entityId: id,
      before: { status: before.status },
      after: { status: next },
    });
    return t;
  });
}

export const scoreSchema = z
  .object({
    bureau: z.nativeEnum(CreditBureau),
    score: z.coerce.number().int("Whole numbers only."),
    recordedAt: z.coerce.date().default(() => new Date()),
    note: z.string().trim().max(300).optional(),
  })
  .superRefine((v, ctx) => {
    const range = BUREAU[v.bureau];
    if (v.score < range.min || v.score > range.max) {
      ctx.addIssue({
        code: "custom",
        path: ["score"],
        message: `${range.label} scores run from ${range.min} to ${range.max}.`,
      });
    }
    if (v.recordedAt.getTime() > Date.now() + 86_400_000) {
      ctx.addIssue({
        code: "custom",
        path: ["recordedAt"],
        message: "That date is in the future.",
      });
    }
  });

export async function recordScore(
  actor: Actor,
  input: z.input<typeof scoreSchema>,
  client: Db = db,
) {
  authorize(actor, "credit.manage");
  const data = scoreSchema.parse(input);
  return client.$transaction(async (tx) => {
    const s = await tx.creditScore.create({
      data: {
        bureau: data.bureau,
        score: data.score,
        recordedAt: data.recordedAt,
        note: data.note || null,
        recordedById: actor.id,
      },
    });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "credit.score_recorded",
      entityType: "CreditScore",
      entityId: s.id,
      after: { bureau: s.bureau, score: s.score },
    });
    return s;
  });
}

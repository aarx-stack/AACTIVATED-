/**
 * Budgets and the 75% rule, applied to real spending.
 *
 *   gateSpend()             before any spend: refuses it (and asks executives) when the rule says so
 *   recordSpend()           writes a SpendEvent against the right budget, then refreshBudget()
 *   refreshBudget()         recomputes status; alerts management once at 75%; opens a
 *                           "continue spending" approval when the budget locks
 *   recordApprovedPurchase() records an approved purchase exactly once
 *   recordManualSpend()     an executive records spend that the rule allows
 *   setBudgetLimit()        an executive changes a limit directly (audited; other executives
 *                           are notified). Staff request changes through the Approval Queue
 *                           (change-requests.ts).
 *
 * Every model call goes through gateSpend/recordSpend (see lib/ai), so agents pause when an AI
 * budget locks and resume once an executive approves more.
 */
import { z } from "zod";
import { Prisma, type Budget } from "@/generated/prisma/client";
import type { SpendKind } from "@/generated/prisma/enums";
import {
  ApprovalStatus,
  ApprovalType,
  NotificationKind,
  RiskLevel,
  Role,
} from "@/generated/prisma/enums";
import { db, type Db, type DbClient } from "@/lib/db";
import { formatUsd } from "@/lib/utils";
import { recordAudit, type AuditActor } from "@/server/audit/audit";
import { authorize, ForbiddenError, type Actor } from "@/server/authz/permissions";
import { getSlack } from "@/server/integrations";
import { notifyApprovers } from "@/server/notifications";
import { BudgetApprovalRequiredError } from "./errors";
import { budgetState, continueAmount, decideSpend, type BudgetFigures } from "./rules";

export { BudgetApprovalRequiredError } from "./errors";

const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;

/** Purpose stored on SPEND approvals: "continue" lifts a paused budget; anything else is one purchase. */
export function isContinuePayload(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { purpose?: unknown }).purpose === "continue"
  );
}

function rootOf(client: DbClient): Db {
  return "$transaction" in client ? (client as Db) : db;
}

// ------------------------------------------------------------------ lookup --

/** The most specific budget that covers this spend right now: the department's, else company-wide. */
export async function findBudgetFor(
  client: DbClient,
  kind: SpendKind,
  departmentId: string | null | undefined,
  at = new Date(),
) {
  const candidates = await client.budget.findMany({
    where: {
      kind,
      periodStart: { lte: at },
      periodEnd: { gte: at },
      OR: departmentId ? [{ departmentId }, { departmentId: null }] : [{ departmentId: null }],
    },
  });
  return candidates.find((b) => b.departmentId === departmentId) ?? candidates[0] ?? null;
}

export async function budgetFigures(client: DbClient, budget: Budget): Promise<BudgetFigures> {
  const [spent, approved] = await Promise.all([
    client.spendEvent.aggregate({ where: { budgetId: budget.id }, _sum: { amountUsd: true } }),
    client.approvalRequest.findMany({
      where: { budgetId: budget.id, type: ApprovalType.SPEND, status: ApprovalStatus.APPROVED },
      select: { amountUsd: true, payload: true, dispatchedAt: true },
    }),
  ]);
  const approvedExtraUsd = approved
    .filter((a) => isContinuePayload(a.payload) || a.dispatchedAt)
    .reduce((n, a) => n + num(a.amountUsd), 0);
  return {
    limitUsd: num(budget.limitUsd),
    threshold: num(budget.threshold),
    spentUsd: num(spent._sum.amountUsd),
    approvedExtraUsd,
  };
}

// --------------------------------------------------------- continue request --

/** One pending "approve more spending" request per budget; reuses it if one is already waiting. */
export async function ensureContinueRequest(
  client: DbClient,
  budget: Budget,
  figures: BudgetFigures,
  wantedUsd = 0,
) {
  const pending = await client.approvalRequest.findFirst({
    where: {
      budgetId: budget.id,
      type: ApprovalType.SPEND,
      status: ApprovalStatus.PENDING,
      payload: { path: ["purpose"], equals: "continue" },
    },
  });
  if (pending) return pending;

  // Imported lazily: the approval service refreshes budgets when spend is approved.
  const { submitApproval } = await import("@/server/approvals/service");
  const amountUsd = continueAmount(figures, wantedUsd);
  const state = budgetState(figures);
  return submitApproval(client, {
    type: ApprovalType.SPEND,
    title: `More spending: ${budget.name}`,
    summary: `${budget.name} is at ${pct(state.ratio)} of its ${formatUsd(figures.limitUsd)} budget. Approve up to ${formatUsd(amountUsd)} more this period.`,
    payload: {
      purpose: "continue",
      budgetId: budget.id,
      budget: budget.name,
      amountUsd,
      limitUsd: figures.limitUsd,
      spentUsd: Math.round(figures.spentUsd * 100) / 100,
    },
    reasoning: `Budget rule: once spend reaches ${pct(figures.threshold)} of a budget, more spending in it needs management approval. ${budget.name} has spent ${formatUsd(figures.spentUsd)} of ${formatUsd(figures.limitUsd)}. Approving lets spending continue by up to ${formatUsd(amountUsd)} this period. Rejecting keeps it paused.`,
    sources: [
      { title: `${budget.name} budget, this period` },
      { title: "Business rule: approval required from 75% of a budget" },
    ],
    risk: RiskLevel.MEDIUM,
    budgetId: budget.id,
    amountUsd,
  });
}

// ------------------------------------------------------------------ refresh --

/**
 * Recompute a budget's status from its spend and approvals and act on the change:
 * alert management once when it reaches the threshold, and open a "continue" approval when it locks.
 */
export async function refreshBudget(client: DbClient, budgetId: string, now = new Date()) {
  const budget = await client.budget.findUniqueOrThrow({ where: { id: budgetId } });
  const figures = await budgetFigures(client, budget);
  const state = budgetState(figures);

  const data: Prisma.BudgetUpdateInput = {};
  if (state.status !== budget.status) data.status = state.status;
  const newlyLocked = state.locked && !budget.lockedAt;
  const unlocked = !state.locked && !!budget.lockedAt;
  const newlyAlerted = state.reachedThreshold && !budget.alertSentAt;
  if (newlyLocked) data.lockedAt = now;
  if (unlocked) data.lockedAt = null;
  if (newlyAlerted) data.alertSentAt = now;
  // A raised limit takes the budget back under the threshold: re-arm the alert.
  if (!state.reachedThreshold && budget.alertSentAt) data.alertSentAt = null;

  const updated =
    Object.keys(data).length > 0
      ? await client.budget.update({ where: { id: budgetId }, data })
      : budget;

  const system: AuditActor = { type: "SYSTEM" };
  const figuresJson = {
    spentUsd: Math.round(figures.spentUsd * 100) / 100,
    limitUsd: figures.limitUsd,
    ratio: Math.round(state.ratio * 1000) / 1000,
    allowanceUsd: state.allowanceUsd,
  };

  if (newlyAlerted) {
    await recordAudit(client, {
      actor: system,
      action: "budget.threshold_reached",
      entityType: "Budget",
      entityId: budgetId,
      after: figuresJson,
    });
    const title = `${budget.name} budget reached ${pct(state.ratio)}`;
    const body = `Spent ${formatUsd(figures.spentUsd)} of ${formatUsd(figures.limitUsd)}. More spending in this budget now needs executive approval.`;
    await notifyApprovers(client, Role.EXECUTIVE, {
      title,
      body,
      href: "/finance",
      kind: NotificationKind.BUDGET_ALERT,
    });
    // Internal team alert. A Slack outage must never block the rule itself.
    try {
      await getSlack().notify("#management", `${title}. ${body}`);
    } catch (error) {
      console.warn("[budgets] Slack alert not delivered", error);
    }
  }
  if (newlyLocked) {
    await recordAudit(client, {
      actor: system,
      action: "budget.locked",
      entityType: "Budget",
      entityId: budgetId,
      before: { status: budget.status },
      after: { status: state.status, ...figuresJson },
    });
    await ensureContinueRequest(client, updated, figures);
  }
  if (unlocked) {
    await recordAudit(client, {
      actor: system,
      action: "budget.unlocked",
      entityType: "Budget",
      entityId: budgetId,
      before: { status: budget.status },
      after: { status: state.status, ...figuresJson },
    });
  }
  return { budget: updated, figures, state };
}

// --------------------------------------------------------------------- gate --

export interface SpendIntent {
  kind: SpendKind;
  departmentId?: string | null;
  /** Known cost of the spend, or 0 when it is only known afterwards (model calls). */
  amountUsd: number;
  /** Check this budget instead of looking one up. */
  budget?: Budget;
}

/**
 * Throws BudgetApprovalRequiredError when the spend needs approval first. The lock and the
 * approval request are written through the root client so they survive the caller's rollback.
 * Returns the covering budget (or null when no budget covers this kind of spend).
 */
export async function gateSpend(client: DbClient, intent: SpendIntent) {
  const budget = intent.budget ?? (await findBudgetFor(client, intent.kind, intent.departmentId));
  if (!budget) return null;
  const figures = await budgetFigures(client, budget);
  const decision = decideSpend(figures, intent.amountUsd);
  if (decision.allowed) return budget;

  const root = rootOf(client);
  const { budget: current } = await refreshBudget(root, budget.id);
  const request = await ensureContinueRequest(root, current, figures, intent.amountUsd);
  const message =
    decision.reason === "LOCKED"
      ? `${budget.name} has reached ${pct(budgetState(figures).ratio)} of its budget. Spending in it is paused until an executive approves more in the Approval Queue.`
      : `This would take ${budget.name} to ${pct((figures.spentUsd + intent.amountUsd) / figures.limitUsd)} of its budget, past the ${pct(figures.threshold)} approval point. An executive needs to approve more spending in the Approval Queue first.`;
  throw new BudgetApprovalRequiredError(message, budget.id, request.id);
}

// ------------------------------------------------------------------- record --

export interface SpendRecord {
  kind: SpendKind;
  description: string;
  amountUsd: number;
  departmentId?: string | null;
  agentId?: string | null;
  /** The budget it counts against; looked up when omitted. */
  budget?: Budget | null;
  approvalRequestId?: string | null;
  provider?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

/** Writes the spend and refreshes its budget. Callers gate first (gateSpend) unless it was approved. */
export async function recordSpend(client: DbClient, input: SpendRecord) {
  const budget =
    input.budget === undefined
      ? await findBudgetFor(client, input.kind, input.departmentId)
      : input.budget;
  const event = await client.spendEvent.create({
    data: {
      kind: input.kind,
      description: input.description,
      amountUsd: new Prisma.Decimal(input.amountUsd.toFixed(6)),
      budgetId: budget?.id ?? null,
      departmentId: input.departmentId ?? budget?.departmentId ?? null,
      agentId: input.agentId ?? null,
      approvalRequestId: input.approvalRequestId ?? null,
      provider: input.provider ?? null,
      model: input.model ?? null,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
    },
  });
  if (budget) await refreshBudget(client, budget.id);
  return event;
}

// ---------------------------------------------------------------- executive --

export const manualSpendSchema = z.object({
  budgetId: z.string().min(1),
  amountUsd: z.coerce
    .number({ message: "Enter an amount." })
    .positive("Enter an amount above zero.")
    .max(1_000_000, "That amount is too large for one entry."),
  description: z.string().trim().min(3, "Describe the spend.").max(160),
});

/** An executive records spend in a budget. Refused (with an approval opened) when the 75% rule applies. */
export async function recordManualSpend(
  actor: Actor,
  input: z.input<typeof manualSpendSchema>,
  client: Db = db,
) {
  authorize(actor, "budget.manage");
  const data = manualSpendSchema.parse(input);
  const budget = await client.budget.findUnique({ where: { id: data.budgetId } });
  if (!budget) throw new ForbiddenError("That budget does not exist.");
  // Checked outside the transaction so a refusal still records the lock and the request.
  await gateSpend(client, {
    kind: budget.kind,
    departmentId: budget.departmentId,
    amountUsd: data.amountUsd,
    budget,
  });
  return client.$transaction(async (tx) => {
    // Re-check inside the transaction to close the race with a concurrent spend.
    const figures = await budgetFigures(tx, budget);
    if (!decideSpend(figures, data.amountUsd).allowed) {
      throw new BudgetApprovalRequiredError(
        "This budget changed while you were recording. Reload and try again.",
        budget.id,
      );
    }
    const event = await recordSpend(tx, {
      kind: budget.kind,
      description: data.description,
      amountUsd: data.amountUsd,
      budget,
    });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "spend.recorded",
      entityType: "SpendEvent",
      entityId: event.id,
      after: { budgetId: budget.id, amountUsd: data.amountUsd, description: data.description },
    });
    return event;
  });
}

/** Record an approved purchase. Only once, only as approved, and only by an executive. */
export async function recordApprovedPurchase(actor: Actor, approvalId: string, client: Db = db) {
  authorize(actor, "budget.manage");
  const { assertDispatchable, DispatchBlockedError } = await import("@/server/approvals/service");
  return client.$transaction(async (tx) => {
    const request = await tx.approvalRequest.findUnique({
      where: { id: approvalId },
      include: { budget: true },
    });
    if (!request || request.type !== ApprovalType.SPEND)
      throw new ForbiddenError("That is not a spend request.");
    if (isContinuePayload(request.payload))
      throw new ForbiddenError(
        "This approval lifts a budget pause; there is no purchase to record.",
      );
    if (!request.budget || request.amountUsd == null)
      throw new ForbiddenError("This request has no budget or amount to record.");
    if (request.dispatchedAt) throw new DispatchBlockedError("This purchase was already recorded.");
    await assertDispatchable(tx, request.id, request.payload);

    const claimed = await tx.approvalRequest.updateMany({
      where: { id: request.id, dispatchedAt: null },
      data: { dispatchedAt: new Date() },
    });
    if (claimed.count !== 1) throw new DispatchBlockedError("This purchase was already recorded.");

    const event = await recordSpend(tx, {
      kind: request.budget.kind,
      description: request.title.replace(/^Spend:\s*/, ""),
      amountUsd: num(request.amountUsd),
      budget: request.budget,
      approvalRequestId: request.id,
      agentId: request.requestedByAgentId,
    });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "spend.recorded",
      entityType: "SpendEvent",
      entityId: event.id,
      correlationId: request.correlationId,
      after: {
        approvalRequestId: request.id,
        budgetId: request.budget.id,
        amountUsd: num(request.amountUsd),
      },
    });
    return event;
  });
}

export const limitSchema = z.object({
  budgetId: z.string().min(1),
  limitUsd: z.coerce
    .number({ message: "Enter a limit." })
    .positive("The limit must be above zero.")
    .max(10_000_000, "That limit is too large."),
  note: z.string().trim().min(5, "Say why the limit is changing.").max(300),
});

/** Change a budget's limit. Audited with the reason; the status is recomputed straight away. */
export async function setBudgetLimit(
  actor: Actor,
  input: z.input<typeof limitSchema>,
  client: Db = db,
) {
  authorize(actor, "budget.manage");
  const data = limitSchema.parse(input);
  return client.$transaction(async (tx) => {
    const before = await tx.budget.findUnique({ where: { id: data.budgetId } });
    if (!before) throw new ForbiddenError("That budget does not exist.");
    await tx.budget.update({
      where: { id: before.id },
      data: { limitUsd: new Prisma.Decimal(data.limitUsd.toFixed(2)) },
    });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "budget.limit_changed",
      entityType: "Budget",
      entityId: before.id,
      before: { limitUsd: num(before.limitUsd) },
      after: { limitUsd: data.limitUsd },
      metadata: { note: data.note },
    });
    // Other executives hear about a direct change (staff changes go through the Approval Queue).
    const others = await tx.user.findMany({
      where: { role: Role.EXECUTIVE, status: "ACTIVE", id: { not: actor.id } },
      select: { id: true },
    });
    if (others.length) {
      await tx.notification.createMany({
        data: others.map((u) => ({
          userId: u.id,
          kind: NotificationKind.BUDGET_ALERT,
          title: `Budget limit changed: ${before.name}`,
          body: `${formatUsd(num(before.limitUsd))} to ${formatUsd(data.limitUsd)}. ${data.note}`,
          href: "/finance",
        })),
      });
    }
    return refreshBudget(tx, before.id);
  });
}

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { Role, SpendKind } from "@/generated/prisma/enums";
import { runModel } from "@/lib/ai";
import type { ModelAdapter } from "@/lib/ai/types";
import { decideApproval, DispatchBlockedError, submitApproval } from "@/server/approvals/service";
import { ForbiddenError } from "@/server/authz/permissions";
import {
  BudgetApprovalRequiredError,
  recordApprovedPurchase,
  recordManualSpend,
  setBudgetLimit,
} from "@/server/budgets/service";
import { ensureWorkflowFixtures } from "./fixtures";
import { createUser, db } from "./helpers";

beforeAll(ensureWorkflowFixtures);
afterAll(() => db.$disconnect());

/** Costs exactly $1.00 at Sonnet prices (250k in x $2/M + 50k out x $10/M). */
const oneDollarModel: ModelAdapter = {
  provider: "anthropic",
  complete: async () => ({
    text: "{}",
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    inputTokens: 250_000,
    outputTokens: 50_000,
    refused: false,
    stopReason: "end_turn",
  }),
};

/** An isolated department with its own budget, so tests never touch other budgets. */
async function makeBudget(kind: SpendKind, limitUsd: number, spentUsd = 0) {
  const tag = randomUUID().slice(0, 8);
  const dept = await db.department.create({
    data: { slug: `budget-test-${tag}`, name: `Budget test ${tag}`, description: "test" },
  });
  const now = Date.now();
  const budget = await db.budget.create({
    data: {
      name: `Test budget ${tag}`,
      kind,
      departmentId: dept.id,
      periodStart: new Date(now - 86_400_000),
      periodEnd: new Date(now + 86_400_000),
      limitUsd: new Prisma.Decimal(limitUsd),
    },
  });
  if (spentUsd > 0) {
    await db.spendEvent.create({
      data: {
        kind,
        description: "earlier spend",
        amountUsd: new Prisma.Decimal(spentUsd),
        budgetId: budget.id,
        departmentId: dept.id,
      },
    });
  }
  return { dept, budget };
}

const callModel = (departmentId: string) =>
  runModel(
    {
      tier: "agent",
      purpose: "test: budget gate",
      departmentId,
      system: "test",
      messages: [{ role: "user", content: "hi" }],
    },
    { adapter: oneDollarModel },
  );

const continueRequests = (budgetId: string) =>
  db.approvalRequest.findMany({
    where: { budgetId, type: "SPEND", payload: { path: ["purpose"], equals: "continue" } },
  });

const auditFor = (budgetId: string) =>
  db.auditLog
    .findMany({
      where: { entityType: "Budget", entityId: budgetId },
      orderBy: { createdAt: "asc" },
    })
    .then((rows) => rows.map((r) => r.action));

describe("75% budget rule: AI model calls", () => {
  it("records each call against the covering budget and locks it when it reaches 75%", async () => {
    const exec = await createUser(Role.EXECUTIVE);
    const { dept, budget } = await makeBudget(SpendKind.AI_MODEL, 10, 7);

    await callModel(dept.id); // 7 -> 8: crosses 7.50 during the call
    const event = await db.spendEvent.findFirstOrThrow({
      where: { budgetId: budget.id, description: "test: budget gate" },
    });
    expect(event.amountUsd.toNumber()).toBe(1);

    const after = await db.budget.findUniqueOrThrow({ where: { id: budget.id } });
    expect(after.status).toBe("LOCKED");
    expect(after.lockedAt).not.toBeNull();
    expect(after.alertSentAt).not.toBeNull();
    expect(await auditFor(budget.id)).toEqual(["budget.threshold_reached", "budget.locked"]);

    // Management is alerted in-app.
    const alert = await db.notification.findFirst({
      where: { userId: exec.id, kind: "BUDGET_ALERT", title: { contains: budget.name } },
    });
    expect(alert).not.toBeNull();

    // One approval request asks executives to approve more spending.
    const requests = await continueRequests(budget.id);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.status).toBe("PENDING");
    expect(requests[0]!.requiredRole).toBe(Role.EXECUTIVE);
    expect(requests[0]!.requestedByUserId).toBeNull();
  });

  it("refuses further calls until an executive approves, then lets work resume", async () => {
    const exec = await createUser(Role.EXECUTIVE);
    const staff = await createUser(Role.STAFF);
    const { dept, budget } = await makeBudget(SpendKind.AI_MODEL, 10, 8);

    await expect(callModel(dept.id)).rejects.toBeInstanceOf(BudgetApprovalRequiredError);
    await expect(callModel(dept.id)).rejects.toThrow(/paused until an executive approves/);
    // Refused calls cost nothing and do not pile up requests.
    expect(await db.spendEvent.count({ where: { budgetId: budget.id } })).toBe(1);
    const [request] = await continueRequests(budget.id);
    expect(await continueRequests(budget.id)).toHaveLength(1);
    expect(request!.amountUsd?.toNumber()).toBe(2); // up to the limit

    await expect(
      decideApproval(staff, request!.id, { decision: "APPROVE" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await decideApproval(exec, request!.id, { decision: "APPROVE" });

    const unlocked = await db.budget.findUniqueOrThrow({ where: { id: budget.id } });
    expect(unlocked.status).toBe("WARNING");
    expect(unlocked.lockedAt).toBeNull();
    expect(await auditFor(budget.id)).toContain("budget.unlocked");

    await callModel(dept.id); // 8 -> 9, within the approved $2
    await callModel(dept.id); // 9 -> 10, uses it up
    await expect(callModel(dept.id)).rejects.toBeInstanceOf(BudgetApprovalRequiredError);
    expect(
      await continueRequests(budget.id).then((r) => r.filter((x) => x.status === "PENDING")),
    ).toHaveLength(1);
  });
});

describe("75% budget rule: recorded spend", () => {
  it("lets an executive record spend under the approval point, and refuses spend that would cross it", async () => {
    const exec = await createUser(Role.EXECUTIVE);
    const { budget } = await makeBudget(SpendKind.SOFTWARE, 1000, 500);

    await recordManualSpend(exec, { budgetId: budget.id, amountUsd: 200, description: "Seats" });
    await expect(
      recordManualSpend(exec, { budgetId: budget.id, amountUsd: 100, description: "More seats" }),
    ).rejects.toThrow(/past the 75% approval point/);
    expect(await db.spendEvent.count({ where: { budgetId: budget.id } })).toBe(2);

    // The refusal opened a request big enough for the purchase.
    const [request] = await continueRequests(budget.id);
    expect(request!.amountUsd?.toNumber()).toBe(300);
    const audit = await db.auditLog.findFirst({
      where: { action: "spend.recorded", actorUserId: exec.id },
    });
    expect(audit).not.toBeNull();

    // Another executive approves; the purchase can now be recorded.
    const approver = await createUser(Role.EXECUTIVE);
    await decideApproval(approver, request!.id, { decision: "APPROVE" });
    await recordManualSpend(exec, {
      budgetId: budget.id,
      amountUsd: 100,
      description: "More seats",
    });
  });

  it("only executives can record spend or change limits", async () => {
    const staff = await createUser(Role.STAFF);
    const { budget } = await makeBudget(SpendKind.SOFTWARE, 1000);
    await expect(
      recordManualSpend(staff, { budgetId: budget.id, amountUsd: 10, description: "Seats" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      setBudgetLimit(staff, { budgetId: budget.id, limitUsd: 2000, note: "More room" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("raising the limit is audited with the reason and recomputes the status", async () => {
    const exec = await createUser(Role.EXECUTIVE);
    const { budget } = await makeBudget(SpendKind.SOFTWARE, 1000, 800);
    await expect(
      recordManualSpend(exec, { budgetId: budget.id, amountUsd: 1, description: "Extra seat" }),
    ).rejects.toBeInstanceOf(BudgetApprovalRequiredError);
    expect((await db.budget.findUniqueOrThrow({ where: { id: budget.id } })).status).toBe("LOCKED");

    await setBudgetLimit(exec, { budgetId: budget.id, limitUsd: 2000, note: "New tools approved" });
    const after = await db.budget.findUniqueOrThrow({ where: { id: budget.id } });
    expect(after.status).toBe("OK");
    const change = await db.auditLog.findFirstOrThrow({
      where: { entityId: budget.id, action: "budget.limit_changed" },
    });
    expect(change.metadata).toEqual({ note: "New tools approved" });
  });
});

describe("approved purchases", () => {
  async function purchaseRequest(budgetId: string, amountUsd: number) {
    const agent = await db.agent.findUniqueOrThrow({ where: { slug: "ops-manager" } });
    return submitApproval(db, {
      type: "SPEND",
      title: `Spend: Test tool ($${amountUsd})`,
      summary: "Needs approval.",
      payload: { vendor: "Test tool", amountUsd },
      reasoning: "The team needs this tool for the content sprint.",
      sources: [{ title: "Vendor quote" }],
      risk: "MEDIUM",
      requestedByAgentId: agent.id,
      budgetId,
      amountUsd,
    });
  }

  it("records an approved purchase exactly once, by an executive", async () => {
    const exec = await createUser(Role.EXECUTIVE);
    const staff = await createUser(Role.STAFF);
    const { budget } = await makeBudget(SpendKind.SOFTWARE, 1000, 780);
    const request = await purchaseRequest(budget.id, 150);

    await expect(recordApprovedPurchase(exec, request.id)).rejects.toBeInstanceOf(
      DispatchBlockedError,
    );
    await decideApproval(exec, request.id, { decision: "APPROVE" });
    await expect(recordApprovedPurchase(staff, request.id)).rejects.toBeInstanceOf(ForbiddenError);

    const event = await recordApprovedPurchase(exec, request.id);
    expect(event.approvalRequestId).toBe(request.id);
    expect(event.amountUsd.toNumber()).toBe(150);
    await expect(recordApprovedPurchase(exec, request.id)).rejects.toThrow(/already recorded/);
    expect(await db.spendEvent.count({ where: { approvalRequestId: request.id } })).toBe(1);

    // The approved purchase does not use up general headroom: still locked for other spend.
    const after = await db.budget.findUniqueOrThrow({ where: { id: budget.id } });
    expect(after.status).toBe("LOCKED");
  });

  it("a continue approval is not a purchase", async () => {
    const exec = await createUser(Role.EXECUTIVE);
    const { dept, budget } = await makeBudget(SpendKind.AI_MODEL, 10, 9);
    await expect(callModel(dept.id)).rejects.toBeInstanceOf(BudgetApprovalRequiredError);
    const [request] = await continueRequests(budget.id);
    await decideApproval(exec, request!.id, { decision: "APPROVE" });
    await expect(recordApprovedPurchase(exec, request!.id)).rejects.toThrow(
      /no purchase to record/,
    );
  });
});

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { Role } from "@/generated/prisma/enums";
import { ApprovalConflictError, decideApproval } from "@/server/approvals/service";
import { ForbiddenError } from "@/server/authz/permissions";
import { listBudgetsForRequests, requestLimitChange } from "@/server/budgets/change-requests";
import { BudgetChangePendingError } from "@/server/budgets/errors";
import { refreshBudget, setBudgetLimit } from "@/server/budgets/service";
import { ensureWorkflowFixtures } from "./fixtures";
import { createUser, db } from "./helpers";

beforeAll(ensureWorkflowFixtures);
afterAll(() => db.$disconnect());

async function makeBudget(limitUsd: number, spentUsd = 0, confidential = false) {
  const tag = randomUUID().slice(0, 8);
  const dept = await db.department.create({
    data: {
      slug: `change-${tag}`,
      name: `Change test ${tag}`,
      description: "test",
      isConfidential: confidential,
    },
  });
  const now = Date.now();
  const budget = await db.budget.create({
    data: {
      name: `Change budget ${tag}`,
      kind: "ADVERTISING",
      departmentId: dept.id,
      periodStart: new Date(now - 86_400_000),
      periodEnd: new Date(now + 86_400_000),
      limitUsd: new Prisma.Decimal(limitUsd),
    },
  });
  if (spentUsd > 0) {
    await db.spendEvent.create({
      data: {
        kind: "ADVERTISING",
        description: "earlier spend",
        amountUsd: new Prisma.Decimal(spentUsd),
        budgetId: budget.id,
        departmentId: dept.id,
      },
    });
    await refreshBudget(db, budget.id);
  }
  return budget;
}

const limitOf = async (id: string) =>
  Number((await db.budget.findUniqueOrThrow({ where: { id } })).limitUsd);

describe("budget limit changes through the Approval Queue", () => {
  it("staff request, only an executive decides, and the new limit applies on approval", async () => {
    const staff = await createUser(Role.STAFF);
    const otherStaff = await createUser(Role.STAFF);
    const exec = await createUser(Role.EXECUTIVE);
    const budget = await makeBudget(1000, 200);

    const request = await requestLimitChange(staff, {
      budgetId: budget.id,
      limitUsd: 1500,
      reason: "Two more campaigns launch this month.",
    });
    expect(request.type).toBe("BUDGET_CHANGE");
    expect(request.requiredRole).toBe("EXECUTIVE");
    expect(request.status).toBe("PENDING");
    expect(request.payload).toEqual({ budgetId: budget.id, fromLimitUsd: 1000, toLimitUsd: 1500 });
    expect(await limitOf(budget.id)).toBe(1000);

    const listed = (await listBudgetsForRequests(otherStaff)).find((b) => b.id === budget.id);
    expect(listed?.pendingChange).toMatchObject({ id: request.id, toLimitUsd: 1500 });

    // One open request per budget.
    await expect(
      requestLimitChange(otherStaff, {
        budgetId: budget.id,
        limitUsd: 2000,
        reason: "Another reason for the change.",
      }),
    ).rejects.toBeInstanceOf(BudgetChangePendingError);

    // Staff cannot decide it; the requester certainly cannot.
    await expect(
      decideApproval(otherStaff, request.id, { decision: "APPROVE" }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await decideApproval(exec, request.id, { decision: "APPROVE", note: "Agreed for November." });
    expect(await limitOf(budget.id)).toBe(1500);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "budget.limit_changed", entityId: budget.id },
    });
    expect(audit.actorUserId).toBe(exec.id);
    expect(audit.metadata).toMatchObject({ approvalRequestId: request.id });
    expect(
      await db.notification.count({
        where: { userId: staff.id, title: { startsWith: "Approved: Budget:" } },
      }),
    ).toBe(1);
  });

  it("executives change limits directly; reps cannot see budgets at all", async () => {
    const exec = await createUser(Role.EXECUTIVE);
    const rep = await createUser(Role.PREMIUM_REP);
    const budget = await makeBudget(500);
    await expect(
      requestLimitChange(exec, {
        budgetId: budget.id,
        limitUsd: 600,
        reason: "Raise it a little.",
      }),
    ).rejects.toThrow(/directly in Finance & Budget/);
    await expect(listBudgetsForRequests(rep)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      requestLimitChange(rep, { budgetId: budget.id, limitUsd: 600, reason: "Raise it a little." }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("staff never see or request budgets of confidential departments", async () => {
    const staff = await createUser(Role.STAFF);
    const exec = await createUser(Role.EXECUTIVE);
    const secret = await makeBudget(900, 0, true);
    expect((await listBudgetsForRequests(staff)).some((b) => b.id === secret.id)).toBe(false);
    expect((await listBudgetsForRequests(exec)).some((b) => b.id === secret.id)).toBe(true);
    await expect(
      requestLimitChange(staff, { budgetId: secret.id, limitUsd: 1000, reason: "Need more room." }),
    ).rejects.toThrow("That budget is not available to you.");
  });

  it("refuses an approval if the limit changed after the request; nothing is applied", async () => {
    const staff = await createUser(Role.STAFF);
    const exec = await createUser(Role.EXECUTIVE);
    const budget = await makeBudget(800);
    const request = await requestLimitChange(staff, {
      budgetId: budget.id,
      limitUsd: 1200,
      reason: "Seasonal push next month.",
    });
    await setBudgetLimit(exec, { budgetId: budget.id, limitUsd: 900, note: "Adjusted directly." });
    await expect(decideApproval(exec, request.id, { decision: "APPROVE" })).rejects.toBeInstanceOf(
      ApprovalConflictError,
    );
    expect(await limitOf(budget.id)).toBe(900);
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe(
      "PENDING",
    );

    await decideApproval(exec, request.id, { decision: "REJECT", note: "Superseded." });
    expect(await limitOf(budget.id)).toBe(900);
    expect(
      await db.notification.count({
        where: { userId: staff.id, title: { startsWith: "Rejected: Budget:" } },
      }),
    ).toBe(1);
  });

  it("raising the limit of a paused budget lets spending continue", async () => {
    const staff = await createUser(Role.STAFF);
    const exec = await createUser(Role.EXECUTIVE);
    const budget = await makeBudget(100, 80);
    expect((await db.budget.findUniqueOrThrow({ where: { id: budget.id } })).status).toBe("LOCKED");
    const request = await requestLimitChange(staff, {
      budgetId: budget.id,
      limitUsd: 200,
      reason: "The tool we rely on raised its price.",
    });
    await decideApproval(exec, request.id, { decision: "APPROVE" });
    expect((await db.budget.findUniqueOrThrow({ where: { id: budget.id } })).status).not.toBe(
      "LOCKED",
    );
  });

  it("refuses a request for the current limit", async () => {
    const staff = await createUser(Role.STAFF);
    const budget = await makeBudget(300);
    await expect(
      requestLimitChange(staff, {
        budgetId: budget.id,
        limitUsd: 300,
        reason: "Keep it the same.",
      }),
    ).rejects.toThrow("That is already the limit.");
  });
});

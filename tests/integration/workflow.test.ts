import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@/generated/prisma/enums";
import { runContentWorkflow, startContentRequest } from "@/server/agents/content-workflow";
import {
  ApprovalConflictError,
  assertDispatchable,
  decideApproval,
  DispatchBlockedError,
  editApproval,
} from "@/server/approvals/service";
import { ForbiddenError } from "@/server/authz/permissions";
import { ensureWorkflowFixtures, setAgentStatus } from "./fixtures";
import { createUser, db } from "./helpers";

beforeAll(ensureWorkflowFixtures);
afterAll(() => db.$disconnect());

async function runRequest(
  actor: { id: string; role: Role; name?: string | null },
  brief: string,
  channel: "INSTAGRAM" | "FACEBOOK" | "TIKTOK" | "YOUTUBE" = "INSTAGRAM",
) {
  const started = await startContentRequest(actor, { brief, channel });
  const result = await runContentWorkflow(started.taskId, started.channel);
  return { started, result };
}

async function auditActions(correlationId: string) {
  const rows = await db.auditLog.findMany({
    where: { correlationId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => r.action);
}

describe("Phase 2 milestone: request -> draft -> compliance -> queue -> approved", () => {
  it("runs end to end with every step in the AuditLog", async () => {
    const staff = await createUser(Role.STAFF);
    const reviewer = await createUser(Role.STAFF);
    const { result } = await runRequest(
      staff,
      "An educational post about building a consistent Recovery Stack routine.",
    );

    expect(result.status).toBe("submitted");
    expect(result.compliance?.outcome).toBe("PASS");

    const approval = await db.approvalRequest.findUniqueOrThrow({
      where: { id: result.approvalId! },
      include: { contentItem: true, complianceChecks: true },
    });
    expect(approval.status).toBe("PENDING");
    expect(approval.requiredRole).toBe(Role.STAFF);
    expect(approval.reasoning.length).toBeGreaterThan(20);
    expect(Array.isArray(approval.sources) && approval.sources.length).toBeGreaterThan(0);
    expect(approval.contentItem?.status).toBe("IN_REVIEW");
    expect(approval.complianceChecks).toHaveLength(1);

    // Three agents ran; each model call was costed.
    const spend = await db.spendEvent.findMany({
      where: { description: { startsWith: "Workflow:" } },
    });
    expect(spend.length).toBeGreaterThanOrEqual(3);

    // Handoffs: Brain -> Operations -> Content Specialist.
    const subtasks = await db.task.findMany({
      where: { parentId: result.taskId },
      orderBy: { createdAt: "asc" },
    });
    expect(subtasks.map((t) => t.status)).toEqual(["DONE", "IN_REVIEW"]);

    await decideApproval(reviewer, approval.id, { decision: "APPROVE" });

    const after = await db.approvalRequest.findUniqueOrThrow({
      where: { id: approval.id },
      include: { contentItem: true },
    });
    expect(after.status).toBe("APPROVED");
    expect(after.decidedById).toBe(reviewer.id);
    expect(after.contentItem?.status).toBe("APPROVED"); // ready to schedule
    expect((await db.task.findUniqueOrThrow({ where: { id: result.taskId } })).status).toBe("DONE");

    expect(await auditActions(result.correlationId)).toEqual([
      "workflow.requested",
      "brain.planned",
      "task.delegated",
      "task.assigned",
      "content.drafted",
      "compliance.checked",
      "approval.requested",
      "approval.approved",
      "content.ready_to_schedule",
    ]);

    // The requester is told.
    expect(
      await db.notification.count({ where: { userId: staff.id, kind: "APPROVAL_DECIDED" } }),
    ).toBe(1);

    // The outbound gate accepts exactly the approved payload, and nothing else.
    await expect(assertDispatchable(db, approval.id, approval.payload)).resolves.toBeTruthy();
    await expect(
      assertDispatchable(db, approval.id, { ...(approval.payload as object), caption: "changed" }),
    ).rejects.toThrow(DispatchBlockedError);
  });

  it("refuses to decide twice", async () => {
    const staff = await createUser(Role.STAFF);
    const { result } = await runRequest(
      staff,
      "An educational post about consistent sleep routines for our community.",
    );
    const a = await createUser(Role.STAFF);
    const b = await createUser(Role.EXECUTIVE);
    await decideApproval(a, result.approvalId!, { decision: "APPROVE" });
    await expect(
      decideApproval(b, result.approvalId!, { decision: "REJECT", note: "too late" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("blocks dispatch of anything not yet approved", async () => {
    const staff = await createUser(Role.STAFF);
    const { result } = await runRequest(
      staff,
      "A short post inviting members to this week's live Q&A session.",
    );
    const approval = await db.approvalRequest.findUniqueOrThrow({
      where: { id: result.approvalId! },
    });
    await expect(assertDispatchable(db, approval.id, approval.payload)).rejects.toThrow(/pending/);
    await expect(assertDispatchable(db, "does-not-exist", {})).rejects.toThrow(
      DispatchBlockedError,
    );
  });
});

describe("compliance routing", () => {
  it("sends rule-breaking drafts to executive review and requires an acknowledgement to approve", async () => {
    const staff = await createUser(Role.STAFF);
    const exec = await createUser(Role.EXECUTIVE);
    const { result } = await runRequest(
      staff,
      "Tell people BPC-157 cures soreness after workouts.",
    );

    expect(result.status).toBe("submitted");
    expect(result.compliance).toMatchObject({ outcome: "FAIL", risk: "CRITICAL" });
    const approval = await db.approvalRequest.findUniqueOrThrow({
      where: { id: result.approvalId! },
    });
    expect(approval.requiredRole).toBe(Role.EXECUTIVE);

    await expect(decideApproval(staff, approval.id, { decision: "APPROVE" })).rejects.toThrow(
      /executive/,
    );
    await expect(decideApproval(exec, approval.id, { decision: "APPROVE" })).rejects.toThrow(
      /acknowledging/,
    );

    await decideApproval(exec, approval.id, {
      decision: "APPROVE",
      note: "Reviewed with legal; publishing as an internal test only.",
    });
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityId: approval.id, action: "approval.approved" },
    });
    expect(audit.metadata).toMatchObject({ overrodeCompliance: true, complianceOutcome: "FAIL" });
  });

  it("re-runs compliance after an edit, bumps the revision and invalidates the old payload", async () => {
    const staff = await createUser(Role.STAFF);
    const editor = await createUser(Role.STAFF);
    const { result } = await runRequest(
      staff,
      "Explain how this miracle routine treats joint pain.",
      "FACEBOOK",
    );
    const before = await db.approvalRequest.findUniqueOrThrow({
      where: { id: result.approvalId! },
    });
    expect(before.requiredRole).toBe(Role.EXECUTIVE);

    const check = await editApproval(editor, before.id, {
      title: "Facebook: building a recovery routine",
      caption:
        "Recovery is a routine, not a moment. Here is how our community builds consistent habits.",
      hashtags: ["#AACTIVATED", "#Routine"],
    });
    expect(check.outcome).toBe("PASS");
    expect(check.requiredRole).toBe(Role.STAFF);

    const after = await db.approvalRequest.findUniqueOrThrow({
      where: { id: before.id },
      include: { contentItem: true },
    });
    expect(after.revision).toBe(2);
    expect(after.risk).toBe("LOW");
    expect(after.payloadHash).not.toBe(before.payloadHash);
    expect(after.editedById).toBe(editor.id);
    expect(after.contentItem?.body).toContain("consistent habits");

    // Staff can now decide the cleaned-up revision.
    await decideApproval(editor, before.id, { decision: "APPROVE" });
    await expect(assertDispatchable(db, before.id, before.payload)).rejects.toThrow(/changed/);
    await expect(assertDispatchable(db, before.id, after.payload)).resolves.toBeTruthy();

    const actions = await auditActions(result.correlationId);
    expect(actions).toContain("approval.edited");
    expect(actions.filter((a) => a === "compliance.checked")).toHaveLength(2);
  });

  it("requires a note to reject", async () => {
    const staff = await createUser(Role.STAFF);
    const { result } = await runRequest(
      staff,
      "A friendly post welcoming new members to the community.",
    );
    await expect(decideApproval(staff, result.approvalId!, { decision: "REJECT" })).rejects.toThrow(
      /note/,
    );
    await decideApproval(staff, result.approvalId!, {
      decision: "REJECT",
      note: "Off-brand tone.",
    });
    const content = await db.contentItem.findUniqueOrThrow({
      where: { id: result.contentItemId! },
    });
    expect(content.status).toBe("REJECTED");
  });
});

describe("guard rails", () => {
  it("stops reps and admins from starting workflows", async () => {
    for (const role of [Role.FREE_REP, Role.PREMIUM_REP, Role.SYSTEM_ADMIN]) {
      const user = await createUser(role);
      await expect(
        startContentRequest(user, {
          brief: "A post about our community events.",
          channel: "INSTAGRAM",
        }),
      ).rejects.toThrow(ForbiddenError);
    }
  });

  it("validates the request", async () => {
    const staff = await createUser(Role.STAFF);
    await expect(
      startContentRequest(staff, { brief: "too short", channel: "INSTAGRAM" }),
    ).rejects.toThrow();
    await expect(
      startContentRequest(staff, { brief: "A valid brief for a post.", channel: "EMAIL" as never }),
    ).rejects.toThrow();
  });

  it("blocks the workflow (and sends nothing) when an agent is paused", async () => {
    const staff = await createUser(Role.STAFF);
    await setAgentStatus("content-specialist", "PAUSED");
    try {
      const { result } = await runRequest(
        staff,
        "An educational post about routine and consistency.",
      );
      expect(result.status).toBe("blocked");
      expect(result.error).toMatch(/paused/);
      expect(result.approvalId).toBeUndefined();
      expect((await db.task.findUniqueOrThrow({ where: { id: result.taskId } })).status).toBe(
        "BLOCKED",
      );
      expect(await auditActions(result.correlationId)).toContain("workflow.blocked");
      expect(
        await db.approvalRequest.count({ where: { correlationId: result.correlationId } }),
      ).toBe(0);
    } finally {
      await setAgentStatus("content-specialist", "ACTIVE");
    }
  });

  it("reports a conflict for unknown approvals", async () => {
    const exec = await createUser(Role.EXECUTIVE);
    await expect(decideApproval(exec, "missing", { decision: "APPROVE" })).rejects.toThrow(
      ApprovalConflictError,
    );
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@/generated/prisma/enums";
import { decideApproval, DispatchBlockedError } from "@/server/approvals/service";
import { ForbiddenError } from "@/server/authz/permissions";
import { createDraft, scheduleContent, submitDraft } from "@/server/content/studio";
import { IntegrationUnavailableError } from "@/server/integrations/types";
import { completeOnboarding } from "@/server/reps/onboarding";
import {
  addContact,
  completeRepTask,
  draftFollowUp,
  planWeek,
  requestRepContent,
  sendFollowUp,
  setContactStatus,
} from "@/server/reps/service";
import { changeUserRole } from "@/server/users/admin";
import { ensureRepFixtures } from "./fixtures";
import { createUser, db } from "./helpers";

beforeAll(ensureRepFixtures);
afterEach(() => {
  delete process.env.MOCK_INTEGRATIONS_DOWN;
});
afterAll(() => db.$disconnect());

const accept = { acceptContentRules: true, acceptLeadPolicy: true } as const;

async function onboardedRep(role: Role = Role.PREMIUM_REP) {
  const rep = await createUser(role);
  await completeOnboarding(rep, accept);
  return rep;
}

const consent = {
  preferredChannel: "EMAIL" as const,
  consentSource: "WEB_FORM" as const,
  consentAt: new Date(Date.now() - 86_400_000),
  consentEvidence: "Requested the guide on the website",
};

describe("onboarding and rep pods", () => {
  it("gives a premium rep four agents copied from the current template versions", async () => {
    const rep = await createUser(Role.PREMIUM_REP);
    const { pod, profile } = await completeOnboarding(rep, accept);
    expect(pod.created.sort()).toEqual([
      "BUSINESS_COACH",
      "CONTENT_CREATOR",
      "LEAD_FOLLOWUP",
      "SOCIAL_MEDIA_MANAGER",
    ]);
    expect(profile.ghlSubAccountId).toBeTruthy();
    const agents = await db.agent.findMany({
      where: { repPod: { repId: rep.id } },
      include: { templateVersion: true },
    });
    expect(agents.every((a) => a.templateVersion?.version === 1 && a.ownerId === rep.id)).toBe(
      true,
    );
    expect((await db.user.findUniqueOrThrow({ where: { id: rep.id } })).onboardedAt).toBeTruthy();
    expect(await db.auditLog.count({ where: { entityId: rep.id, action: "rep.onboarded" } })).toBe(
      1,
    );
  });

  it("gives a free rep only the Business Coach", async () => {
    const rep = await createUser(Role.FREE_REP);
    const { pod } = await completeOnboarding(rep, accept);
    expect(pod.created).toEqual(["BUSINESS_COACH"]);
  });

  it("requires both agreements and a rep role", async () => {
    const rep = await createUser(Role.PREMIUM_REP);
    await expect(
      completeOnboarding(rep, { acceptContentRules: true, acceptLeadPolicy: false as true }),
    ).rejects.toThrow();
    const staff = await createUser(Role.STAFF);
    await expect(completeOnboarding(staff, accept)).rejects.toThrow(ForbiddenError);
  });

  it("carries forward the latest template version to new pods", async () => {
    const template = await db.agentTemplate.findUniqueOrThrow({
      where: { key: "rep.business_coach" },
    });
    const v2 = await db.agentTemplateVersion.upsert({
      where: { templateId_version: { templateId: template.id, version: 2 } },
      create: {
        templateId: template.id,
        version: 2,
        role: "Coach v2: learned from top reps.",
        context: "v2",
        dailyRoutine: "v2",
        toolsAllowed: ["report.write"],
      },
      update: {},
    });
    await db.agentTemplate.update({ where: { id: template.id }, data: { currentVersion: 2 } });
    try {
      const rep = await onboardedRep(Role.FREE_REP);
      const coach = await db.agent.findFirstOrThrow({ where: { repPod: { repId: rep.id } } });
      expect(coach.templateVersionId).toBe(v2.id);
      expect(coach.config).toMatchObject({ role: "Coach v2: learned from top reps." });
    } finally {
      await db.agentTemplate.update({ where: { id: template.id }, data: { currentVersion: 1 } });
    }
  });

  it("upgrading a free rep adds the premium agents; downgrading pauses them", async () => {
    const exec = await createUser(Role.EXECUTIVE);
    const rep = await onboardedRep(Role.FREE_REP);
    await changeUserRole(exec, rep.id, Role.PREMIUM_REP);
    const active = () => db.agent.count({ where: { repPod: { repId: rep.id }, status: "ACTIVE" } });
    expect(await active()).toBe(4);
    expect(
      (await db.repProfile.findUniqueOrThrow({ where: { userId: rep.id } })).ghlSubAccountId,
    ).toBeTruthy();
    await changeUserRole(exec, rep.id, Role.FREE_REP);
    expect(await active()).toBe(1);
    expect(await db.agent.count({ where: { repPod: { repId: rep.id } } })).toBe(4); // history kept
  });
});

describe("rep content -> approval -> schedule through the gate", () => {
  it("runs end to end and blocks every unsafe path", async () => {
    const rep = await onboardedRep();
    const staff = await createUser(Role.STAFF);
    const result = await requestRepContent(rep, {
      brief: "An educational post about my weekly routine and consistency.",
      channel: "INSTAGRAM",
    });
    expect(result.status).toBe("submitted");
    const item = await db.contentItem.findUniqueOrThrow({ where: { id: result.contentItemId! } });
    expect(item.repId).toBe(rep.id);
    expect(item.status).toBe("IN_REVIEW");

    // Not approved yet: cannot schedule.
    await expect(
      scheduleContent(rep, item.id, { at: new Date(Date.now() + 86_400_000) }),
    ).rejects.toThrow(DispatchBlockedError);

    await decideApproval(staff, result.approvalId!, { decision: "APPROVE" });
    const note = await db.notification.findFirstOrThrow({
      where: { userId: rep.id, kind: "APPROVAL_DECIDED" },
    });
    expect(note.href).toBe(`/content/${item.id}`);

    // Another rep cannot touch it.
    const other = await onboardedRep();
    await expect(
      scheduleContent(other, item.id, { at: new Date(Date.now() + 86_400_000) }),
    ).rejects.toThrow(ForbiddenError);

    // Graceful degradation: integration down, nothing changes, failure audited.
    process.env.MOCK_INTEGRATIONS_DOWN = "GOHIGHLEVEL";
    await expect(
      scheduleContent(rep, item.id, { at: new Date(Date.now() + 86_400_000) }),
    ).rejects.toThrow(IntegrationUnavailableError);
    expect((await db.contentItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(
      "APPROVED",
    );
    expect(
      await db.auditLog.count({ where: { entityId: item.id, action: "content.schedule_failed" } }),
    ).toBe(1);
    delete process.env.MOCK_INTEGRATIONS_DOWN;

    await expect(
      scheduleContent(rep, item.id, { at: new Date(Date.now() + 60_000) }),
    ).rejects.toThrow(/5 minutes/);
    const at = new Date(Date.now() + 2 * 86_400_000);
    const scheduled = await scheduleContent(rep, item.id, { at });
    expect(scheduled.status).toBe("SCHEDULED");
    expect(scheduled.externalPostId).toMatch(/^mock-post-/);
    expect(
      (await db.approvalRequest.findUniqueOrThrow({ where: { id: result.approvalId! } }))
        .dispatchedAt,
    ).toBeTruthy();

    // Exactly once.
    await expect(scheduleContent(rep, item.id, { at })).rejects.toThrow(DispatchBlockedError);
    const actions = (
      await db.auditLog.findMany({
        where: { correlationId: result.correlationId },
        orderBy: { createdAt: "asc" },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "workflow.requested",
        "content.drafted",
        "compliance.checked",
        "approval.requested",
        "approval.approved",
        "content.ready_to_schedule",
        "content.scheduled",
      ]),
    );
  });

  it("free reps cannot request content", async () => {
    const rep = await onboardedRep(Role.FREE_REP);
    await expect(
      requestRepContent(rep, {
        brief: "A post about routines and consistency.",
        channel: "INSTAGRAM",
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("human drafts go through review and the author cannot approve their own post", async () => {
    const author = await createUser(Role.STAFF);
    const reviewer = await createUser(Role.STAFF);
    const draft = await createDraft(author, {
      title: "Weekly Q&A",
      caption: "Join our weekly Q&A to learn about routines.",
      hashtags: ["#AACTIVATED"],
      channel: "FACEBOOK",
    });
    const { approval } = await submitDraft(author, draft.id, {
      why: "Promotes the community Q&A session.",
    });
    expect(approval.requestedByUserId).toBe(author.id);
    await expect(decideApproval(author, approval.id, { decision: "APPROVE" })).rejects.toThrow(
      /own request/,
    );
    await decideApproval(reviewer, approval.id, { decision: "APPROVE" });
    expect((await db.contentItem.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe(
      "APPROVED",
    );
    // Already submitted: cannot resubmit.
    await expect(submitDraft(author, draft.id)).rejects.toThrow(ForbiddenError);
  });
});

describe("consented contacts and follow-ups", () => {
  it("requires a consent record (in code and in the database)", async () => {
    const rep = await onboardedRep();
    await expect(
      addContact(rep, {
        ...consent,
        name: "No Consent",
        email: "a@example.test",
        consentEvidence: "",
      }),
    ).rejects.toThrow();
    await expect(
      addContact(rep, {
        ...consent,
        name: "Future",
        email: "b@example.test",
        consentAt: new Date(Date.now() + 7 * 86_400_000),
      }),
    ).rejects.toThrow(/future/);
    await expect(
      db.contact.create({
        data: {
          repId: rep.id,
          name: "Bypass",
          consentSource: "WEB_FORM",
          consentAt: new Date(),
          consentEvidence: " ",
        },
      }),
    ).rejects.toThrow();
    const free = await onboardedRep(Role.FREE_REP);
    await expect(
      addContact(free, { ...consent, name: "X", email: "x@example.test" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("drafts, approves and sends exactly once; opted-out contacts are never messaged", async () => {
    const rep = await onboardedRep();
    const staff = await createUser(Role.STAFF);
    const contact = await addContact(rep, {
      ...consent,
      name: "Alex Morgan",
      email: "alex@example.test",
    });

    const draft = await draftFollowUp(rep, contact.id, undefined);
    expect(draft.status).toBe("submitted");
    const approval = await db.approvalRequest.findUniqueOrThrow({
      where: { id: draft.approvalId! },
    });
    expect(approval.type).toBe("EMAIL");
    expect(approval.contactId).toBe(contact.id);
    expect((approval.payload as { message: string }).message).toMatch(/STOP/);

    await expect(draftFollowUp(rep, contact.id, undefined)).rejects.toThrow(/already waiting/);
    await expect(sendFollowUp(rep, approval.id)).rejects.toThrow(DispatchBlockedError);

    await decideApproval(staff, approval.id, { decision: "APPROVE" });
    expect(await db.notification.count({ where: { userId: rep.id, href: "/my-team" } })).toBe(1);

    const other = await onboardedRep();
    await expect(sendFollowUp(other, approval.id)).rejects.toThrow(ForbiddenError);

    await sendFollowUp(rep, approval.id);
    const after = await db.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(after.status).toBe("FOLLOWING_UP");
    expect(after.lastContactedAt).toBeTruthy();
    await expect(sendFollowUp(rep, approval.id)).rejects.toThrow(/Already sent/);

    // Opt-out after approval still blocks the send.
    const second = await addContact(rep, {
      ...consent,
      name: "Jamie",
      email: "jamie@example.test",
    });
    const d2 = await draftFollowUp(rep, second.id, "Asked about events");
    await decideApproval(staff, d2.approvalId!, { decision: "APPROVE" });
    await setContactStatus(rep, second.id, "OPTED_OUT");
    await expect(sendFollowUp(rep, d2.approvalId!)).rejects.toThrow(/opted out/);
    await expect(draftFollowUp(rep, second.id, undefined)).rejects.toThrow(/opted out/);
  });

  it("reps cannot see or act on other reps' contacts", async () => {
    const a = await onboardedRep();
    const b = await onboardedRep();
    const contact = await addContact(a, { ...consent, name: "Private", email: "p@example.test" });
    await expect(draftFollowUp(b, contact.id, undefined)).rejects.toThrow(ForbiddenError);
    await expect(setContactStatus(b, contact.id, "OPTED_OUT")).rejects.toThrow(ForbiddenError);
  });
});

describe("weekly plan", () => {
  it("creates this week's actions for the pod and re-planning replaces open ones", async () => {
    const rep = await onboardedRep();
    const first = await planWeek(rep, { goal: "Finish the onboarding training" });
    expect(first.actions).toBeGreaterThanOrEqual(5);
    expect(first.focus).toContain("onboarding training");
    const owners = await db.task.findMany({
      where: { parentId: first.taskId },
      select: { agent: { select: { repRole: true } } },
    });
    expect(new Set(owners.map((o) => o.agent?.repRole)).size).toBeGreaterThan(1);

    const second = await planWeek(rep, {});
    expect((await db.task.findUniqueOrThrow({ where: { id: first.taskId } })).status).toBe(
      "CANCELLED",
    );
    expect(await db.task.count({ where: { parentId: first.taskId, status: "TODO" } })).toBe(0);
    expect(await db.task.count({ where: { parentId: second.taskId } })).toBe(second.actions);
  });

  it("free reps' plans use only the Business Coach", async () => {
    const rep = await onboardedRep(Role.FREE_REP);
    const plan = await planWeek(rep);
    const roles = await db.task.findMany({
      where: { parentId: plan.taskId },
      select: { agent: { select: { repRole: true } } },
    });
    expect(new Set(roles.map((r) => r.agent?.repRole))).toEqual(new Set(["BUSINESS_COACH"]));
  });

  it("reps can only tick off their own tasks", async () => {
    const a = await onboardedRep();
    const b = await onboardedRep();
    const plan = await planWeek(a);
    const task = await db.task.findFirstOrThrow({ where: { parentId: plan.taskId } });
    await completeRepTask(a, task.id, true);
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("DONE");
    await expect(completeRepTask(b, task.id, true)).rejects.toThrow(ForbiddenError);
  });
});

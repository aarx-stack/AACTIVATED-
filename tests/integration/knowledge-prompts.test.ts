import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@/generated/prisma/enums";
import { ForbiddenError } from "@/server/authz/permissions";
import {
  createDocument,
  getDocument,
  listDocuments,
  summarizeDocument,
} from "@/server/knowledge/service";
import {
  assignableAgents,
  chatWithBrain,
  getTemplate,
  listTemplates,
  restoreVersion,
  saveTemplate,
  sendToAgent,
} from "@/server/prompts/service";
import { ensureWorkflowFixtures } from "./fixtures";
import { createUser, db } from "./helpers";

beforeAll(ensureWorkflowFixtures);
afterAll(() => db.$disconnect());

async function seedDocs(tag: string) {
  const exec = await db.document.create({
    data: {
      title: `Board memo ${tag}`,
      category: "LEGAL_RESEARCH",
      accessLevel: "EXECUTIVE_ONLY",
      body: `Confidential board notes ${tag}. Do not share.`,
    },
  });
  const staff = await db.document.create({
    data: {
      title: `Staff handbook ${tag}`,
      category: "POLICIES",
      accessLevel: "ALL_STAFF",
      body: `How we work ${tag}. Be kind. Ask for help.\n- Use the approval queue.\n- Keep data safe.`,
    },
  });
  const everyone = await db.document.create({
    data: {
      title: `Posting rules ${tag}`,
      category: "POLICIES",
      accessLevel: "ALL_USERS",
      body: `Rules for everyone ${tag}. No claims.\n- Branded names only.\n- Consent first.`,
    },
  });
  return { exec, staff, everyone };
}

describe("Knowledge Library access is enforced in the query", () => {
  it("each role only ever receives the documents it may read", async () => {
    const tag = randomUUID().slice(0, 8);
    const docs = await seedDocs(tag);
    const exec = await createUser(Role.EXECUTIVE);
    const staff = await createUser(Role.STAFF);
    const rep = await createUser(Role.PREMIUM_REP);

    const titles = async (actor: { id: string; role: Role }) =>
      (await listDocuments(actor, { q: tag })).documents.map((d) => d.title).sort();

    expect(await titles(exec)).toEqual(
      [docs.exec.title, docs.staff.title, docs.everyone.title].sort(),
    );
    expect(await titles(staff)).toEqual([docs.staff.title, docs.everyone.title].sort());
    expect(await titles(rep)).toEqual([docs.everyone.title]);

    // Direct lookups and counts follow the same rule.
    expect(await getDocument(staff, docs.exec.id)).toBeNull();
    expect(await getDocument(rep, docs.staff.id)).toBeNull();
    expect((await getDocument(exec, docs.exec.id))?.title).toBe(docs.exec.title);
    const repCounts = await listDocuments(rep, {});
    expect(repCounts.counts.LEGAL_RESEARCH ?? 0).toBe(0);
  });

  it("search ranks title matches first and filters by category", async () => {
    const tag = randomUUID().slice(0, 8);
    await seedDocs(tag);
    const staff = await createUser(Role.STAFF);
    const result = await listDocuments(staff, { q: tag, category: "POLICIES" });
    expect(result.documents.every((d) => d.category === "POLICIES")).toBe(true);
    expect(result.documents.length).toBe(2);
  });

  it("the Brain summarizes a readable document, logs the cost and audits it", async () => {
    const tag = randomUUID().slice(0, 8);
    const docs = await seedDocs(tag);
    const staff = await createUser(Role.STAFF);
    const updated = await summarizeDocument(staff, docs.staff.id);
    expect(updated.summary).toContain("How we work");
    expect(updated.keyPoints).toEqual(["Use the approval queue.", "Keep data safe."]);
    expect(updated.summarizedAt).not.toBeNull();
    expect(
      await db.spendEvent.count({
        where: { description: `Knowledge summary: ${docs.staff.title}` },
      }),
    ).toBe(1);
    expect(
      await db.auditLog.count({
        where: { action: "document.summarized", entityId: docs.staff.id },
      }),
    ).toBe(1);

    // Staff cannot summarize what they cannot read; reps cannot summarize at all.
    await expect(summarizeDocument(staff, docs.exec.id)).rejects.toBeInstanceOf(ForbiddenError);
    const rep = await createUser(Role.PREMIUM_REP);
    await expect(summarizeDocument(rep, docs.everyone.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("only executives add executive-only documents, and legal research is always executive-only", async () => {
    const exec = await createUser(Role.EXECUTIVE);
    const staff = await createUser(Role.STAFF);
    const body = "A long enough document body for the library, with two sentences.";
    await expect(
      createDocument(staff, {
        title: "Secret",
        category: "POLICIES",
        accessLevel: "EXECUTIVE_ONLY",
        body,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createDocument(staff, {
        title: "Case law",
        category: "LEGAL_RESEARCH",
        accessLevel: "ALL_STAFF",
        body,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const legal = await createDocument(exec, {
      title: "Case law notes",
      category: "LEGAL_RESEARCH",
      accessLevel: "ALL_USERS",
      body,
    });
    expect(legal.accessLevel).toBe("EXECUTIVE_ONLY");
    const ok = await createDocument(staff, {
      title: "Huddle notes",
      category: "TRAINING",
      accessLevel: "ALL_STAFF",
      body,
      tags: "Huddle, Weekly",
    });
    expect(ok.tags).toEqual(["huddle", "weekly"]);
    expect(
      await db.auditLog.count({ where: { action: "document.created", entityId: ok.id } }),
    ).toBe(1);
  });
});

describe("Prompt Generator", () => {
  it("saving adds versions; nothing is overwritten; restoring copies forward", async () => {
    const staff = await createUser(Role.STAFF);
    const created = await saveTemplate(staff, {
      name: "Test prompt",
      description: "For tests",
      body: "Write about {{topic}} for {{audience}}.",
    });
    expect(created.version).toBe(1);
    const id = created.template.id;
    expect(created.template.variables).toEqual(["topic", "audience"]);

    const v2 = await saveTemplate(staff, {
      templateId: id,
      name: "Test prompt",
      description: "For tests",
      body: "Write about {{topic}} for {{audience}} in a {{tone}} tone.",
      changeNote: "Added tone",
    });
    expect(v2.version).toBe(2);
    const restored = await restoreVersion(staff, id, 1);
    expect(restored.version).toBe(3);

    const template = await getTemplate(staff, id);
    expect(template?.versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(template?.body).toBe("Write about {{topic}} for {{audience}}.");
    expect(template?.variables).toEqual(["topic", "audience"]);
    expect(template?.versions[0]?.changeNote).toBe("Restored v1");
    const actions = await db.auditLog.findMany({
      where: { entityId: id },
      orderBy: { createdAt: "asc" },
    });
    expect(actions.map((a) => a.action)).toEqual([
      "prompt.created",
      "prompt.versioned",
      "prompt.versioned",
      "prompt.restored",
    ]);
  });

  it("send to agent fills the variables and creates a task for that agent", async () => {
    const staff = await createUser(Role.STAFF);
    const { template } = await saveTemplate(staff, {
      name: "Send test",
      description: "For tests",
      body: "Draft a post about {{topic}}.",
    });
    const agent = await db.agent.findUniqueOrThrow({ where: { slug: "content-specialist" } });

    await expect(
      sendToAgent(staff, { templateId: template.id, agentId: agent.id, values: {} }),
    ).rejects.toThrow("Fill in {{topic}}");

    const { task } = await sendToAgent(staff, {
      templateId: template.id,
      agentId: agent.id,
      values: { topic: "morning routines" },
    });
    expect(task.agentId).toBe(agent.id);
    expect(task.description).toBe("Draft a post about morning routines.");
    expect(task.status).toBe("TODO");
    expect(
      await db.auditLog.count({ where: { action: "prompt.sent_to_agent", entityId: task.id } }),
    ).toBe(1);
  });

  it("refuses paused agents, rep pod agents and confidential agents for staff", async () => {
    const staff = await createUser(Role.STAFF);
    const { template } = await saveTemplate(staff, {
      name: "Guard test",
      description: "For tests",
      body: "Check {{thing}} please.",
    });
    const tag = randomUUID().slice(0, 8);
    const legal = await db.department.create({
      data: { slug: `legal-${tag}`, name: `Legal ${tag}`, description: "x", isConfidential: true },
    });
    const confidential = await db.agent.create({
      data: {
        slug: `counsel-${tag}`,
        name: "Counsel",
        title: "Compliance Officer",
        kind: "DEPARTMENT",
        status: "ACTIVE",
        departmentId: legal.id,
        config: { role: "r", context: "c", dailyRoutine: "d", toolsAllowed: ["tasks.work"] },
        ownerId: staff.id,
      },
    });
    const paused = await db.agent.create({
      data: {
        slug: `paused-${tag}`,
        name: "Snooze",
        title: "Paused Agent",
        kind: "DEPARTMENT",
        status: "PAUSED",
        config: {},
        ownerId: staff.id,
      },
    });
    const values = { thing: "the calendar" };
    await expect(
      sendToAgent(staff, { templateId: template.id, agentId: confidential.id, values }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      sendToAgent(staff, { templateId: template.id, agentId: paused.id, values }),
    ).rejects.toThrow(/paused and cannot take work/);
    expect((await assignableAgents(staff)).some((a) => a.id === confidential.id)).toBe(false);
    const exec = await createUser(Role.EXECUTIVE);
    expect((await assignableAgents(exec)).some((a) => a.id === confidential.id)).toBe(true);
  });

  it("reps cannot use the Prompt Generator", async () => {
    const rep = await createUser(Role.PREMIUM_REP);
    await expect(listTemplates(rep)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      chatWithBrain(rep, { message: "hello there", history: [] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("chat with the Brain returns a reply and, when asked, a template with variables", async () => {
    const staff = await createUser(Role.STAFF);
    const result = await chatWithBrain(staff, {
      message: "Create a prompt for a short welcome email",
      history: [],
    });
    expect(result.reply.length).toBeGreaterThan(5);
    expect(result.template?.variables).toEqual(
      expect.arrayContaining(["role", "audience", "tone", "call_to_action"]),
    );
  });
});

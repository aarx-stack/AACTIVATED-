/**
 * Prompt Generator: a library of reusable prompt templates with {{variables}}, an append-only
 * version history, chat with the Brain, and "Send to Agent", which turns a filled-in template
 * into a task for a company agent. Nothing here leaves the company.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { ActivityKind, AgentKind, Role, TaskPriority, TaskStatus } from "@/generated/prisma/enums";
import { db, type Db } from "@/lib/db";
import { recordAudit } from "@/server/audit/audit";
import { AgentUnavailableError, runSkill, WORKING_STATUSES } from "@/server/agents/runner";
import { promptChatSkill, templateVariables } from "@/server/agents/skills";
import { authorize, ForbiddenError, type Actor } from "@/server/authz/permissions";
import { canOpenAgentWorkspace } from "@/server/authz/policies";

export { templateVariables } from "@/server/agents/skills";

/** Templates owned by confidential departments are for executives only. */
function visibleWhere(role: Role): Prisma.PromptTemplateWhereInput {
  return role === Role.EXECUTIVE
    ? {}
    : { OR: [{ departmentId: null }, { department: { isConfidential: false } }] };
}

export async function listTemplates(actor: Actor, q?: string, client: Db = db) {
  authorize(actor, "prompts.use");
  const term = q?.trim();
  return client.promptTemplate.findMany({
    where: {
      AND: [
        visibleWhere(actor.role),
        term
          ? {
              OR: [
                { name: { contains: term, mode: "insensitive" } },
                { description: { contains: term, mode: "insensitive" } },
              ],
            }
          : {},
      ],
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      description: true,
      currentVersion: true,
      department: { select: { name: true } },
    },
  });
}

export async function getTemplate(actor: Actor, id: string, client: Db = db) {
  authorize(actor, "prompts.use");
  const template = await client.promptTemplate.findFirst({
    where: { AND: [{ id }, visibleWhere(actor.role)] },
    include: {
      department: { select: { name: true } },
      versions: {
        orderBy: { version: "desc" },
        include: { createdBy: { select: { name: true } } },
      },
    },
  });
  if (!template) return null;
  const current = template.versions.find((v) => v.version === template.currentVersion);
  return { ...template, body: current?.body ?? "" };
}

// ------------------------------------------------------------------ editing --

export const saveSchema = z.object({
  templateId: z.string().optional(),
  name: z.string().trim().min(3, "Name the template.").max(80),
  description: z.string().trim().min(3, "Describe what it is for.").max(200),
  body: z
    .string()
    .trim()
    .min(20, "The prompt is too short.")
    .max(6000)
    .refine((b) => !/\{\{\s*\}\}/.test(b), "Every {{ }} needs a variable name."),
  changeNote: z.string().trim().max(200).optional(),
});

/** Creates a template (version 1) or adds a new version. Versions are never edited in place. */
export async function saveTemplate(
  actor: Actor,
  input: z.input<typeof saveSchema>,
  client: Db = db,
) {
  authorize(actor, "prompts.use");
  const data = saveSchema.parse(input);
  const variables = templateVariables(data.body);

  return client.$transaction(async (tx) => {
    if (!data.templateId) {
      const key = `custom.${data.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .slice(0, 40)}_${randomUUID().slice(0, 6)}`;
      const created = await tx.promptTemplate.create({
        data: {
          key,
          name: data.name,
          description: data.description,
          variables,
          currentVersion: 1,
          versions: {
            create: {
              version: 1,
              body: data.body,
              changeNote: data.changeNote || "Initial template",
              createdById: actor.id,
            },
          },
        },
      });
      await recordAudit(tx, {
        actor: { type: "USER", userId: actor.id },
        action: "prompt.created",
        entityType: "PromptTemplate",
        entityId: created.id,
        after: { name: created.name, version: 1, variables },
      });
      return { template: created, version: 1 };
    }

    const existing = await tx.promptTemplate.findFirst({
      where: { AND: [{ id: data.templateId }, visibleWhere(actor.role)] },
    });
    if (!existing) throw new ForbiddenError("That template is not available to you.");
    const version = existing.currentVersion + 1;
    // Guarded update: two people saving at once cannot both claim the same version.
    const claimed = await tx.promptTemplate.updateMany({
      where: { id: existing.id, currentVersion: existing.currentVersion },
      data: {
        name: data.name,
        description: data.description,
        variables,
        currentVersion: version,
      },
    });
    if (claimed.count !== 1)
      throw new ForbiddenError("Someone saved this template just now. Reload and try again.");
    await tx.promptTemplateVersion.create({
      data: {
        templateId: existing.id,
        version,
        body: data.body,
        changeNote: data.changeNote || "Updated",
        createdById: actor.id,
      },
    });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "prompt.versioned",
      entityType: "PromptTemplate",
      entityId: existing.id,
      before: { version: existing.currentVersion },
      after: { version, variables },
    });
    return { template: existing, version };
  });
}

/** Restoring copies an old version forward as the newest one; history is kept. */
export async function restoreVersion(
  actor: Actor,
  templateId: string,
  version: number,
  client: Db = db,
) {
  authorize(actor, "prompts.use");
  const template = await getTemplate(actor, templateId, client);
  if (!template) throw new ForbiddenError("That template is not available to you.");
  const old = template.versions.find((v) => v.version === version);
  if (!old) throw new ForbiddenError("That version does not exist.");
  if (version === template.currentVersion)
    throw new ForbiddenError("That version is already the current one.");
  const result = await saveTemplate(
    actor,
    {
      templateId,
      name: template.name,
      description: template.description,
      body: old.body,
      changeNote: `Restored v${version}`,
    },
    client,
  );
  await recordAudit(client, {
    actor: { type: "USER", userId: actor.id },
    action: "prompt.restored",
    entityType: "PromptTemplate",
    entityId: templateId,
    metadata: { restoredVersion: version, newVersion: result.version },
  });
  return result;
}

// ---------------------------------------------------------------- rendering --

export class MissingVariablesError extends ForbiddenError {}

export function renderTemplate(body: string, values: Record<string, string>) {
  const missing = templateVariables(body).filter((v) => !values[v]?.trim());
  if (missing.length > 0) {
    throw new MissingVariablesError(
      `Fill in ${missing.map((m) => `{{${m}}}`).join(", ")} before sending.`,
    );
  }
  return body.replace(/\{\{\s*([a-z][a-z0-9_]{0,39})\s*\}\}/gi, (_, name: string) =>
    values[name.toLowerCase()]!.trim(),
  );
}

// ------------------------------------------------------------ send to agent --

export const sendSchema = z.object({
  templateId: z.string().min(1),
  agentId: z.string().min(1, "Choose an agent."),
  values: z.record(z.string(), z.string().max(500)),
});

/** Agents a person may hand work to: company agents they can open. */
export async function assignableAgents(actor: Actor, client: Db = db) {
  authorize(actor, "prompts.use");
  const agents = await client.agent.findMany({
    where: { kind: { in: [AgentKind.BRAIN, AgentKind.DEPARTMENT] } },
    orderBy: [{ kind: "asc" }, { title: "asc" }],
    select: {
      id: true,
      name: true,
      title: true,
      kind: true,
      status: true,
      department: { select: { name: true, isConfidential: true } },
    },
  });
  return agents.filter((a) => canOpenAgentWorkspace(actor.role, a));
}

export async function sendToAgent(
  actor: Actor,
  input: z.input<typeof sendSchema>,
  client: Db = db,
) {
  authorize(actor, "prompts.use");
  const data = sendSchema.parse(input);
  const template = await getTemplate(actor, data.templateId, client);
  if (!template) throw new ForbiddenError("That template is not available to you.");
  const prompt = renderTemplate(template.body, data.values);

  const agent = await client.agent.findUnique({
    where: { id: data.agentId },
    include: { department: { select: { isConfidential: true } } },
  });
  if (!agent || agent.kind === AgentKind.REP_POD || !canOpenAgentWorkspace(actor.role, agent)) {
    throw new ForbiddenError("You cannot assign work to that agent.");
  }
  if (!WORKING_STATUSES.includes(agent.status)) {
    throw new AgentUnavailableError(
      `${agent.title} (${agent.name}) is ${agent.status.toLowerCase()} and cannot take work.`,
    );
  }

  const correlationId = randomUUID();
  return client.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        title: `${template.name} (prompt v${template.currentVersion})`,
        description: prompt,
        status: TaskStatus.TODO,
        priority: TaskPriority.MEDIUM,
        agentId: agent.id,
        createdById: actor.id,
        correlationId,
      },
    });
    await tx.agentActivity.create({
      data: {
        agentId: agent.id,
        kind: ActivityKind.DELEGATED,
        message: `Received a prompt: "${template.name}".`,
        taskId: task.id,
      },
    });
    await recordAudit(tx, {
      actor: { type: "USER", userId: actor.id },
      action: "prompt.sent_to_agent",
      entityType: "Task",
      entityId: task.id,
      correlationId,
      after: { templateId: template.id, version: template.currentVersion, agentId: agent.id },
    });
    return { task, agent };
  });
}

// --------------------------------------------------------------------- chat --

export const chatSchema = z.object({
  message: z.string().trim().min(2, "Type a message.").max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "brain"]), text: z.string().max(4000) }))
    .max(20),
  template: z
    .object({ name: z.string().max(80), body: z.string().max(6000) })
    .nullable()
    .optional(),
});

export async function chatWithBrain(
  actor: Actor,
  input: z.input<typeof chatSchema>,
  client: Db = db,
) {
  authorize(actor, "prompts.use");
  const data = chatSchema.parse(input);
  const brain = await client.agent.findFirst({
    where: { kind: AgentKind.BRAIN },
    select: { id: true, name: true, title: true, status: true, config: true, departmentId: true },
  });
  if (!brain) throw new AgentUnavailableError("The Brain is not configured.");
  const { output } = await runSkill(
    promptChatSkill,
    brain,
    {
      message: data.message,
      history: data.history.slice(-10),
      template: data.template
        ? { ...data.template, variables: templateVariables(data.template.body) }
        : null,
    },
    { purpose: "Prompt Generator chat", client },
  );
  return {
    reply: output.reply,
    template: output.template
      ? { ...output.template, variables: templateVariables(output.template.body) }
      : null,
  };
}
